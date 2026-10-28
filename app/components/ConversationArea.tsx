// 대화 영역 (DESIGN.md 2장): 질문 말풍선과 답변 카드가 쌓이는 곳
import { useEffect, useRef } from "react";
import type { Message } from "./Chat";

export default function ConversationArea({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  // 새 대화가 추가되면 가장 아래(최신 대화)로 화면을 내린다.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // 아직 대화가 없을 때의 안내
  if (messages.length === 0) {
    return (
      <section
        aria-label="대화 내용"
        className="flex flex-1 flex-col items-center justify-center text-center"
      >
        <p className="text-base text-zinc-500 dark:text-zinc-400">
          국유재산 업무 중 궁금한 법률 질문을 입력해 보세요
        </p>
        <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
          예: 무단점유자에게 변상금을 부과할 때 소멸시효는 얼마인가요?
        </p>
      </section>
    );
  }

  return (
    <section aria-label="대화 내용" className="flex flex-col gap-4">
      {messages.map((message) =>
        message.role === "user" ? (
          // 내 질문: 오른쪽 말풍선
          <div key={message.id} className="flex justify-end">
            <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-base text-white">
              {message.text}
            </p>
          </div>
        ) : (
          // 챗봇 답변: 왼쪽 카드 (답변 카드 모양은 PLAN 14번 작업에서 완성)
          <div key={message.id} className="flex justify-start">
            <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
              {message.text}
            </p>
          </div>
        ),
      )}
      <div ref={endRef} />
    </section>
  );
}
