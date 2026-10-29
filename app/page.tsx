// 캠코 법률 도우미 첫 화면 (DESIGN.md 2장 화면 구성)
// 위에서부터 머리글 → 대화 영역 → 입력 영역(화면 아래 고정) 순서로 놓는다.
import Chat from "./components/Chat";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      {/* 머리글 + 대화 영역 + 입력 영역 (머리글의 "새 대화" 버튼이 대화 상태를 지우므로 Chat 안에 있다) */}
      <Chat />
    </div>
  );
}
