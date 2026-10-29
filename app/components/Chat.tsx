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
  MAX_MESSAGES,
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

  // 화면의 대화·입력·오류를 모두 비운다. (서버에는 저장된 것이 없으므로 화면만 비우면 된다)
  function handleNewChat() {
    if (isWaiting) return;
    setMessages([]);
    setDraft("");
    setError(null);
  }

  const isFull = messages.length >= MAX_MESSAGES;

  return (
    <>
      {/* 머리글: 서비스 이름, 한 줄 소개, 새 대화 버튼 */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              캠코 법률 도우미
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              국유재산 법률 질문에 공개 자료를 근거로 답합니다
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={isWaiting || (messages.length === 0 && !draft && !error)}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            새 대화
          </button>
        </div>
      </header>

      {/* 대화 영역 */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <ConversationArea
          messages={messages}
          isWaiting={isWaiting}
          error={error}
          onRetry={(question) => handleSend(question)}
        />
      </main>

      {/* 입력 영역 (대화가 한도에 닿으면 "새 대화"를 안내하고 입력을 막는다) */}
      {isFull && (
        <p className="mx-auto w-full max-w-3xl px-6 pb-2 text-sm text-amber-700 dark:text-amber-400">
          대화가 길어졌어요. 위의 &quot;새 대화&quot;를 눌러 새로 질문해 주세요.
        </p>
      )}
      <QuestionInput
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        disabled={isWaiting || isFull}
      />
    </>
  );
}
