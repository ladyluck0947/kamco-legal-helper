// 서버 API: POST /api/ask (PLAN 6번, DESIGN.md 3장 데이터 흐름 ⑤)
// 화면이 보낸 대화를 받아 AI에 묻고 답을 돌려준다.
// API 키는 이 서버 코드에서만 읽으며, 브라우저로는 절대 보내지 않는다 (PRD 7장).
//
// 이후 작업에서 이어 붙일 것:
//   PLAN 10~16번  자료 찾기, AI 규칙 안내문, 답변 형식 검사
import OpenAI from "openai";
import { findPersonalInfo } from "@/lib/pii";
import { ERROR_MESSAGES, SERVER_TIMEOUT_MS, type ErrorCode } from "@/lib/errors";

// 사용할 AI 모델. 응답 속도(30초 제한)와 품질을 함께 고려해 고른 기본값이다.
const MODEL = "gpt-5.4-mini";

// 한 번에 받을 대화 양의 상한 (너무 긴 요청으로 비용이 커지는 것을 막는다)
const MAX_MESSAGES = 20;
const MAX_TEXT_LENGTH = 2000;

// 임시 안내문. PRD 5장의 AI 규칙 전체는 PLAN 13번 작업에서 lib/prompt.ts로 옮겨 완성한다.
const INSTRUCTIONS =
  "너는 한국자산관리공사(캠코) 직원의 국유재산 관련 법률 질문에 답하는 도우미다. 한국어로 답한다.";

type IncomingMessage = { role: "user" | "assistant"; text: string };

// 오류 응답: 오류 종류(code)와 화면에 보여 줄 문구를 함께 보낸다.
function errorResponse(code: ErrorCode, status: number, message = ERROR_MESSAGES[code]) {
  return Response.json({ error: message, code }, { status });
}

// 화면이 보낸 대화가 올바른 모양인지 확인한다. 문제가 있으면 오류 문구를 돌려준다.
function validateMessages(value: unknown): IncomingMessage[] | string {
  if (!Array.isArray(value) || value.length === 0) return "대화 내용이 없어요.";
  if (value.length > MAX_MESSAGES) return "대화가 너무 길어요. 새로고침 후 다시 질문해 주세요.";

  for (const item of value) {
    const ok =
      typeof item === "object" &&
      item !== null &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.text === "string" &&
      item.text.trim() !== "" &&
      item.text.length <= MAX_TEXT_LENGTH;
    if (!ok) return "대화 형식이 올바르지 않아요.";
  }

  if (value[value.length - 1].role !== "user") return "마지막 대화는 질문이어야 해요.";
  return value as IncomingMessage[];
}

export async function POST(request: Request) {
  // PLAN 8번: 요청을 받은 순간부터 30초를 잰다. 시간이 다 되면 진행 중인 AI 요청을 멈춘다.
  // (이후 자료 찾기·국가법령정보센터 조회도 이 같은 시계 안에서 진행한다)
  const deadline = AbortSignal.timeout(SERVER_TIMEOUT_MS);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 키가 없을 때는 원인을 서버 기록에만 남기고, 화면에는 일반 오류 문구만 보낸다.
    console.error("[api/ask] OPENAI_API_KEY가 설정되어 있지 않습니다.");
    return errorResponse("AI_ERROR", 500);
  }

  const body = await request.json().catch(() => null);
  const messages = validateMessages(body?.messages);
  if (typeof messages === "string") {
    return errorResponse("BAD_REQUEST", 400, messages);
  }

  // PLAN 7번: 화면 검사를 거치지 않은 요청에 대비해, AI로 보낼 질문 전부를 서버에서 다시 검사한다.
  // 앞의 대화도 함께 AI로 넘어가므로 이번 질문만이 아니라 모든 질문을 본다.
  // 개인정보 내용은 서버 기록에도 남기지 않는다.
  const hasPii = messages.some(
    (m) => m.role === "user" && findPersonalInfo(m.text).length > 0,
  );
  if (hasPii) {
    return errorResponse("PII_BLOCKED", 400);
  }

  try {
    // 재시도는 1번까지만 하고, 30초 시계가 다 되면 재시도 중이라도 멈춘다.
    const client = new OpenAI({ apiKey, maxRetries: 1 });
    const response = await client.responses.create(
      {
        model: MODEL,
        instructions: INSTRUCTIONS,
        input: messages.map((m) => ({ role: m.role, content: m.text })),
      },
      { signal: deadline },
    );
    return Response.json({ answer: response.output_text });
  } catch (error) {
    // 30초를 넘겨 멈춘 경우 (DESIGN.md 2장 "시간 초과")
    if (deadline.aborted) {
      console.error("[api/ask] 30초 시간 초과로 AI 요청을 멈췄습니다.");
      return errorResponse("TIMEOUT", 504);
    }
    // 그 밖의 AI 서비스 오류 (DESIGN.md 2장 "AI 서비스 오류")
    console.error("[api/ask] AI 요청 실패:", error instanceof Error ? error.message : error);
    return errorResponse("AI_ERROR", 502);
  }
}
