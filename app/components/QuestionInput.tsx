"use client";

// 입력 영역 (DESIGN.md 2장): 개인정보 안내 문구, 질문 입력창, 보내기 버튼
// 입력한 글자를 화면이 기억해야 하므로 브라우저에서 동작하는 컴포넌트로 만든다.
import { useState, type FormEvent } from "react";
import { findPersonalInfo, type PiiMatch } from "@/lib/pii";

export default function QuestionInput({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const [question, setQuestion] = useState("");
  // 보내기를 눌렀을 때 발견된 개인정보 목록 (없으면 빈 배열)
  const [blocked, setBlocked] = useState<PiiMatch[]>([]);
  const isEmpty = question.trim() === "";

  function handleChange(value: string) {
    setQuestion(value);
    // 경고가 떠 있는 동안에는 고칠 때마다 다시 검사해, 다 지우면 경고를 바로 없앤다.
    if (blocked.length > 0) setBlocked(findPersonalInfo(value));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 페이지가 새로고침되지 않도록 막는다.
    event.preventDefault();
    if (isEmpty) return;

    // PLAN 5번: 개인정보가 있으면 보내지 않고, 입력 내용은 그대로 둔다 (PRD 7장).
    const found = findPersonalInfo(question);
    if (found.length > 0) {
      setBlocked(found);
      return;
    }

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

        {blocked.length > 0 && <PiiWarning text={question} matches={blocked} />}

        <div className="flex items-end gap-2">
          <label htmlFor="question" className="sr-only">
            질문 입력
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(event) => handleChange(event.target.value)}
            rows={2}
            placeholder="국유재산 법률 질문을 입력하세요"
            aria-invalid={blocked.length > 0}
            aria-describedby={blocked.length > 0 ? "pii-warning" : undefined}
            className={`flex-1 resize-none rounded-lg border bg-white px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:bg-zinc-900 dark:text-zinc-50 ${
              blocked.length > 0
                ? "border-red-500 focus:border-red-500"
                : "border-zinc-300 focus:border-blue-500 dark:border-zinc-700"
            }`}
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

// 개인정보 경고: 무엇이 문제인지 알려 주고, 질문 속 문제 부분을 빨갛게 표시한다.
function PiiWarning({ text, matches }: { text: string; matches: PiiMatch[] }) {
  const labels = [...new Set(matches.map((m) => m.label))].join(", ");

  // 질문을 "일반 글자"와 "문제 부분" 조각으로 나눈다.
  const pieces: { text: string; isPii: boolean }[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      pieces.push({ text: text.slice(cursor, match.start), isPii: false });
    }
    pieces.push({ text: text.slice(match.start, match.end), isPii: true });
    cursor = match.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), isPii: false });

  return (
    <div
      id="pii-warning"
      role="alert"
      className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p className="font-medium">
        개인정보({labels})로 보이는 내용이 있어 보내지 않았어요. 빨갛게 표시된
        부분을 지우고 다시 보내 주세요.
      </p>
      <p className="mt-1 whitespace-pre-wrap break-all text-zinc-700 dark:text-zinc-300">
        {pieces.map((piece, index) =>
          piece.isPii ? (
            <mark
              key={index}
              className="rounded bg-red-200 px-0.5 font-semibold text-red-900 dark:bg-red-800 dark:text-red-50"
            >
              {piece.text}
            </mark>
          ) : (
            <span key={index}>{piece.text}</span>
          ),
        )}
      </p>
    </div>
  );
}
