// 대화 영역 (DESIGN.md 2장): 질문 말풍선과 답변 카드가 쌓이는 곳
// 지금은 대화가 없을 때의 안내만 보여 주고, 질문·답변 목록은 PLAN 3번 작업에서 채운다.
export default function ConversationArea() {
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
