// 캠코 법률 도우미 첫 화면 (DESIGN.md 2장 화면 구성)
// 지금은 머리글만 있고, 대화 영역과 입력 영역은 PLAN 2번 작업에서 만든다.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      {/* 머리글: 서비스 이름과 한 줄 소개 */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            캠코 법률 도우미
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            국유재산 법률 질문에 공개 자료를 근거로 답합니다
          </p>
        </div>
      </header>

      {/* 대화 영역 자리 (PLAN 2번 작업에서 채움) */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8" />
    </div>
  );
}
