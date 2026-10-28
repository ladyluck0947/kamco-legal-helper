"use client";

// 대화 상태 관리 (PLAN 3·9번, DESIGN.md 3장)
// 질문·답변 목록은 브라우저 화면 안에서만 기억한다.
// 서버나 DB에 저장하지 않으므로, 창을 닫거나 새로고침하면 모두 사라진다 (PRD 7장).
import { useState } from "react";
import ConversationArea from "./ConversationArea";
import QuestionInput from "./QuestionInput";
import {
  CLIENT_TIMEOUT_MS,
  ERROR_MESSAGES,
  RETRYABLE,
  type ErrorCode,
} from "@/lib/errors";
import { answerToText, type StructuredAnswer } from "@/lib/answer";

// 대화 한 건: 누가(직원/챗봇) 무엇을 말했는지
// 챗봇 답변은 화면용 정리본(answer)과, 다음 질문 때 AI에 다시 보낼 글(text)을 함께 가진다.
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  answer?: StructuredAnswer;
  notice?: string | null; // 예: 국가법령정보센터 조회 실패 안내
};

// 화면에 띄울 오류: 문구, [다시 시도] 가능 여부, 다시 보낼 질문
export type ChatError = {
  message: string;
  canRetry: boolean;
  question: string;
};

type AskResult =
  | { ok: true; answer: StructuredAnswer; notice: string | null }
  | { ok: false; code: ErrorCode; message: string };

// 서버 API에 대화를 보내고 답을 받는다 (DESIGN.md 3장 ②).
async function ask(messages: Message[]): Promise<AskResult> {
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map(({ role, text }) => ({ role, text })),
      }),
      // 서버의 30초 제한에 여유 5초를 더해 기다린다 (DESIGN.md 3장 "30초 시간 제한의 기준").
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null);

    if (response.ok && data?.answer?.type) {
      return { ok: true, answer: data.answer, notice: data.notice ?? null };
    }
    const code: ErrorCode = data?.code ?? "AI_ERROR";
    return { ok: false, code, message: data?.error ?? ERROR_MESSAGES[code] };
  } catch (error) {
    // 35초가 지나도 답이 없으면 시간 초과, 그 밖에는 연결 문제로 본다.
    const code: ErrorCode =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "TIMEOUT"
        : "NETWORK";
    return { ok: false, code, message: ERROR_MESSAGES[code] };
  }
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);

  async function handleSend(text: string) {
    const question: Message = { id: crypto.randomUUID(), role: "user", text };
    const next = [...messages, question];

    setMessages(next);
    setDraft("");
    setError(null);
    setIsWaiting(true);

    const result = await ask(next);
    setIsWaiting(false);

    if (result.ok) {
      setMessages([
        ...next,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: answerToText(result.answer),
          answer: result.answer,
          notice: result.notice,
        },
      ]);
      return;
    }

    // 실패하면 보낸 질문을 대화에서 빼고 입력창에 다시 채워 둔다 (DESIGN.md 2장 "오류 안내").
    setMessages(messages);
    setDraft(text);
    setError({
      message: result.message,
      canRetry: RETRYABLE.has(result.code),
      question: text,
    });
  }

  return (
    <>
      {/* 대화 영역 */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <ConversationArea
          messages={messages}
          isWaiting={isWaiting}
          error={error}
          onRetry={(question) => handleSend(question)}
        />
      </main>

      {/* 입력 영역 */}
      <QuestionInput
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        disabled={isWaiting}
      />
    </>
  );
}
