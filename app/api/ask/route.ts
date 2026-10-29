// 서버 API: POST /api/ask (PLAN 6번, DESIGN.md 3장 데이터 흐름 ⑤)
// 화면이 보낸 대화를 받아 AI에 묻고 답을 돌려준다.
// API 키는 이 서버 코드에서만 읽으며, 브라우저로는 절대 보내지 않는다 (PRD 7장).
//
// 이후 작업에서 이어 붙일 것:
//   PLAN 17~18번  테스트 질문으로 성공 기준 확인
import OpenAI from "openai";
import { maskAnswerPersonalInfo, verifyCaseNumbers } from "@/lib/verify";
import { buildInstructions } from "@/lib/prompt";
import { ANSWER_FORMAT, parseAnswer } from "@/lib/schema";
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

    // PLAN 12번: 국가법령정보센터를 조회해 보완한다 (DESIGN.md 3장 "자료 찾는 방법" 4).
    // - 법령해석례(유권해석): data 폴더에 넣어 둔 것이 없으므로 항상 조회한다 (PRD 6장 "공개 유권해석").
    // - 판례: 넣어 둔 자료에 맞는 조문이나 판례가 하나도 없을 때만 조회한다.
    // 조회가 실패해도 오류를 띄우지 않고, 넣어 둔 자료만으로 답한 뒤 안내 문구를 붙인다.
    const lookup: LookupResult = await lookupLawCenter(terms, deadline, {
      precedents: found.lawsInsufficient || found.casesInsufficient,
      interpretations: true,
    });
    const lookupItems = lookup.status === "ok" ? lookup.items : [];

    const materials = [formatMaterials(found), formatLookup(lookupItems)].filter(Boolean).join("\n\n");

    // PLAN 14번: 답을 정해진 형식(ANSWER_FORMAT)으로 받고 검사한다.
    // 형식이 틀리면 1번 다시 요청하고, 그래도 틀리면 "답변 형식 오류"로 알린다 (DESIGN.md 2장).
    let answer = null;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      const response = await client.responses.create(
        {
          model: AI_MODEL,
          // PLAN 13번: PRD 5장의 AI 규칙 + 찾은 참고 자료
          instructions: buildInstructions(materials),
          input: messages.map((m) => ({ role: m.role, content: m.text })),
          text: { format: ANSWER_FORMAT },
        },
        { signal: deadline },
      );
      answer = parseAnswer(response.output_text);
    }
    if (!answer) return errorResponse("FORMAT_ERROR", 502);

    // PLAN 16번: 답변 속 사건번호가 이번에 넘긴 자료에 실제로 있는지 대조하고, 없는 번호는 내보내지 않는다.
    const allowedNumbers = [
      ...found.cases.map((c) => c.caseNumber),
      ...lookupItems.map((i) => i.number),
    ];
    const verified = verifyCaseNumbers(answer, allowedNumbers);
    if (verified.removed.length > 0) {
      console.error("[api/ask] 자료에 없는 사건번호를 걸러냄:", verified.removed.join(", "));
    }

    // PRD 7장: 답변에도 개인정보를 넣지 않는다. 숫자형 개인정보가 있으면 가린다 (내용은 기록하지 않음).
    const safe = maskAnswerPersonalInfo(verified.answer);
    if (safe.masked > 0) {
      console.error(`[api/ask] 답변 속 개인정보 ${safe.masked}건을 가림`);
    }

    return Response.json({
      answer: safe.answer,
      notice: lookup.status === "failed" ? LOOKUP_FAILED_NOTICE : null,
      // 어떤 자료를 찾아 AI에 넘겼는지 (PLAN 16번 작업과 확인용)
      sources: {
        terms: found.terms,
        laws: found.laws.map((l) => l.id),
        cases: found.cases.map((c) => c.id),
        lawsInsufficient: found.lawsInsufficient,
        casesInsufficient: found.casesInsufficient,
        lookup: lookup.status,
        lookupItems: lookupItems.map((i) => `${i.kind} ${i.number}`),
        removedCaseNumbers: verified.removed,
        maskedPersonalInfo: safe.masked,
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
