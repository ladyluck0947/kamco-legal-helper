// 캠코 법률 도우미 첫 화면 (DESIGN.md 2장 화면 구성)
// 위에서부터 머리글 → 대화 영역 → 입력 영역(화면 아래 고정) 순서로 놓는다.
import Chat from "./components/Chat";

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

      {/* 대화 영역 + 입력 영역 (대화 상태는 Chat이 관리) */}
      <Chat />
    </div>
  );
}
