"use client";

// 대화 상태 관리 (PLAN 3번, DESIGN.md 3장)
// 질문·답변 목록은 브라우저 화면 안에서만 기억한다.
// 서버나 DB에 저장하지 않으므로, 창을 닫거나 새로고침하면 모두 사라진다 (PRD 7장).
import { useState } from "react";
import ConversationArea from "./ConversationArea";
import QuestionInput from "./QuestionInput";

// 대화 한 건: 누가(직원/챗봇) 무엇을 말했는지
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);

  function handleSend(text: string) {
    // 지금은 내 질문만 목록에 쌓는다. 챗봇 답변은 PLAN 9번 작업에서 서버와 연결해 추가한다.
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
    ]);
  }

  return (
    <>
      {/* 대화 영역 */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <ConversationArea messages={messages} />
      </main>

      {/* 입력 영역 */}
      <QuestionInput onSend={handleSend} />
    </>
  );
}
