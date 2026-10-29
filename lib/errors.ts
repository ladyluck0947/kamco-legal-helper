// 오류 종류와 화면 안내 문구 (DESIGN.md 2장 "오류 종류별 안내 문구")
// 서버는 오류 종류(code)와 문구를 함께 돌려주고, 화면은 code를 보고 [다시 시도] 버튼 표시 여부를 정한다.

export type ErrorCode =
  | "PII_BLOCKED"
  | "TIMEOUT"
  | "AI_ERROR"
  | "BAD_REQUEST"
  | "FORMAT_ERROR"
  | "NETWORK";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  PII_BLOCKED:
    "개인정보로 보이는 내용이 있어 보내지 않았어요. 해당 부분을 지우고 다시 질문해 주세요.",
  TIMEOUT: "답변이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.",
  AI_ERROR: "지금은 답변을 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
  BAD_REQUEST: "질문을 처리할 수 없어요. 새로고침 후 다시 질문해 주세요.",
  FORMAT_ERROR: "답변을 정리하지 못했어요. 질문을 조금 바꿔서 다시 시도해 주세요.",
  NETWORK: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
};

// [다시 시도] 버튼을 보여 줄 오류 (개인정보 차단은 질문을 고쳐야 하므로 제외)
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  "TIMEOUT",
  "AI_ERROR",
  "FORMAT_ERROR",
  "NETWORK",
]);

// 30초 시간 제한 (DESIGN.md 3장 "30초 시간 제한의 기준")
// 서버는 요청을 받은 순간부터 30초를 재고, 화면은 인터넷 문제에 대비해 5초 여유를 더 기다린다.
export const SERVER_TIMEOUT_MS = 30_000;
export const CLIENT_TIMEOUT_MS = SERVER_TIMEOUT_MS + 5_000;

// 한 대화에서 서버가 받는 메시지 수(질문+답변). 화면도 이 수를 넘기기 전에 "새 대화"를 안내한다.
export const MAX_MESSAGES = 20;
