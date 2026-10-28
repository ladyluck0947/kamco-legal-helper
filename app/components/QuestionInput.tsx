"use client";

// 입력 영역 (DESIGN.md 2장): 개인정보 안내 문구, 질문 입력창, 보내기 버튼
// 입력한 글자를 화면이 기억해야 하므로 브라우저에서 동작하는 컴포넌트로 만든다.
import { useState, type FormEvent } from "react";

export default function QuestionInput({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const isEmpty = question.trim() === "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 페이지가 새로고침되지 않도록 막는다.
    event.preventDefault();
    if (isEmpty) return;
    // 질문을 대화 목록으로 넘기고 입력창을 비운다.
    onSend(question.trim());
    setQuestion("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-0 border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="mx-auto w-full max-w-3xl">
        {/* PRD 7장: 개인정보 안내 문구는 항상 보여 준다 */}
        <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠ 개인정보·내부 정보는 입력하지 마세요
        </p>
        <div className="flex items-end gap-2">
          <label htmlFor="question" className="sr-only">
            질문 입력
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            placeholder="국유재산 법률 질문을 입력하세요"
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={isEmpty}
            className="h-11 rounded-lg bg-blue-600 px-5 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            보내기
          </button>
        </div>
      </div>
    </form>
  );
}
