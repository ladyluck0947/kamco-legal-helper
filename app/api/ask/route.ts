// 서버 API: POST /api/ask (PLAN 6번, DESIGN.md 3장 데이터 흐름 ⑤)
// 화면이 보낸 대화를 받아 AI에 묻고 답을 돌려준다.
// API 키는 이 서버 코드에서만 읽으며, 브라우저로는 절대 보내지 않는다 (PRD 7장).
//
// 이후 작업에서 이어 붙일 것:
//   PLAN 13~16번  AI 규칙 안내문, 답변 형식 검사
import OpenAI from "openai";
import { findPersonalInfo } from "@/lib/pii";
import { ERROR_MESSAGES, SERVER_TIMEOUT_MS, type ErrorCode } from "@/lib/errors";
import { AI_MODEL } from "@/lib/ai";
import { formatMaterials, makeSearchTerms, searchMaterials } from "@/lib/search";
import { formatLookup, lookupLawCenter, type LookupResult } from "@/lib/law-api";

// 국가법령정보센터 조회가 실패했을 때 답변 아래에 붙일 안내 (DESIGN.md 2장 "자료 조회 실패")
const LOOKUP_FAILED_NOTICE = "국가법령정보센터 조회에 실패해 일부 자료만 참고했어요.";

// 한 번에 받을 대화 양의 상한 (너무 긴 요청으로 비용이 커지는 것을 막는다)
const MAX_MESSAGES = 20;
const MAX_TEXT_LENGTH = 2000;

// 임시 안내문. PRD 5장의 AI 규칙 전체는 PLAN 13번 작업에서 lib/prompt.ts로 옮겨 완성한다.
const INSTRUCTIONS =
  "너는 한국자산관리공사(캠코) 직원의 국유재산 관련 법률 질문에 답하는 도우미다. 한국어로 답한다. " +
  "아래 참고 자료를 근거로 답하고, 근거로 쓴 조문은 법령명과 조문 번호를, 판례는 사건번호를 밝힌다.";

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

    // PLAN 11번: 질문을 법률 용어 검색어로 바꿔 관련 조문·판례를 고른다 (DESIGN.md 3장 ④).
    // 검색어 만들기가 실패하면(시간 초과 제외) 질문 글을 그대로 검색어로 쓴다.
    let terms: string[];
    try {
      terms = await makeSearchTerms(client, messages, deadline);
    } catch (error) {
      if (deadline.aborted) throw error;
      console.error("[api/ask] 검색어 만들기 실패, 질문 글로 대신 검색:", error instanceof Error ? error.message : error);
      terms = messages[messages.length - 1].text.split(/\s+/);
    }
    const found = searchMaterials(terms);

    // PLAN 12번: 넣어 둔 자료에 맞는 조문이나 판례가 하나도 없으면 국가법령정보센터를 조회해 보완한다.
    // 조회가 실패해도 오류를 띄우지 않고, 넣어 둔 자료만으로 답한 뒤 안내 문구를 붙인다.
    let lookup: LookupResult | null = null;
    if (found.lawsInsufficient || found.casesInsufficient) {
      lookup = await lookupLawCenter(terms, deadline);
    }
    const lookupItems = lookup?.status === "ok" ? lookup.items : [];

    const materials = [formatMaterials(found), formatLookup(lookupItems)].filter(Boolean).join("\n\n");

    const response = await client.responses.create(
      {
        model: AI_MODEL,
        instructions: `${INSTRUCTIONS}\n\n${materials}`,
        input: messages.map((m) => ({ role: m.role, content: m.text })),
      },
      { signal: deadline },
    );
    return Response.json({
      answer: response.output_text,
      notice: lookup?.status === "failed" ? LOOKUP_FAILED_NOTICE : null,
      // 어떤 자료를 찾아 AI에 넘겼는지 (PLAN 16번 작업과 확인용)
      sources: {
        terms: found.terms,
        laws: found.laws.map((l) => l.id),
        cases: found.cases.map((c) => c.id),
        lawsInsufficient: found.lawsInsufficient,
        casesInsufficient: found.casesInsufficient,
        lookup: lookup?.status ?? "not-needed",
        lookupItems: lookupItems.map((i) => `${i.kind} ${i.number}`),
      },
    });
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
