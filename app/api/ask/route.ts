// 서버 API: POST /api/ask (PLAN 6번, DESIGN.md 3장 데이터 흐름 ⑤)
// 화면이 보낸 대화를 받아 AI에 묻고 답을 돌려준다.
// API 키는 이 서버 코드에서만 읽으며, 브라우저로는 절대 보내지 않는다 (PRD 7장).
//
// 이후 작업에서 이어 붙일 것:
//   PLAN 17~18번  테스트 질문으로 성공 기준 확인
import OpenAI from "openai";
import { maskAnswerPersonalInfo, verifyCaseNumbers, verifyLegalBasis } from "@/lib/verify";
import { buildInstructions } from "@/lib/prompt";
import { ANSWER_FORMAT, parseAnswer } from "@/lib/schema";
import { findPersonalInfo } from "@/lib/pii";
import { ERROR_MESSAGES, MAX_MESSAGES, SERVER_TIMEOUT_MS, type ErrorCode } from "@/lib/errors";
import { askAI } from "@/lib/ai";
import { formatMaterials, makeSearchTerms, searchMaterials, selectArticles } from "@/lib/search";
import { formatLookup, lookupLawCenter, type LookupResult } from "@/lib/law-api";
import {
  formatLawArticles,
  lookupRelatedLaws,
  type LawLookupResult,
  type RelatedLawRequest,
} from "@/lib/law-text";

// 국가법령정보센터 조회가 실패했을 때 답변 아래에 붙일 안내 (DESIGN.md 2장 "자료 조회 실패")
const LOOKUP_FAILED_NOTICE = "국가법령정보센터 조회에 실패해 일부 자료만 참고했어요.";
// 국가법령정보센터 조회에 쓸 수 있는 최대 시간. 법령·시행령·인용 조문·판례를 폭넓게 조회하므로 평소 1~3초가 걸린다.
const LOOKUP_TIMEOUT_MS = 8_000;
// 후보 조문이 이 개수 이하면 AI가 다시 고르게 하지 않고 모두 쓴다.
const SELECT_ABOVE = 6;
// 후보 조문을 AI가 고르는 데 실패했을 때 후보의 앞쪽에서 그대로 쓸 개수
const SELECT_FALLBACK = 12;

// 한 번에 받을 대화 양의 상한 (너무 긴 요청으로 비용이 커지는 것을 막는다)
const MAX_TEXT_LENGTH = 2000;

type IncomingMessage = { role: "user" | "assistant"; text: string };

// 오류 응답: 오류 종류(code)와 화면에 보여 줄 문구를 함께 보낸다.
function errorResponse(code: ErrorCode, status: number, message = ERROR_MESSAGES[code]) {
  return Response.json({ error: message, code }, { status });
}

// 화면이 보낸 대화가 올바른 모양인지 확인한다. 문제가 있으면 오류 문구를 돌려준다.
function validateMessages(value: unknown): IncomingMessage[] | string {
  if (!Array.isArray(value) || value.length === 0) return "대화 내용이 없어요.";
  if (value.length > MAX_MESSAGES) return "대화가 너무 길어요. '새 대화'를 눌러 다시 질문해 주세요.";

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
  // 앞의 대화도 함께 AI로 넘어가므로 이번 질문만이 아니라 앞 질문과 챗봇 답변 칸까지 모두 본다.
  // 개인정보 내용은 서버 기록에도 남기지 않는다.
  const hasPii = messages.some((m) => findPersonalInfo(m.text).length > 0);
  if (hasPii) {
    return errorResponse("PII_BLOCKED", 400);
  }

  try {
    // 재시도는 1번까지만 하고, 30초 시계가 다 되면 재시도 중이라도 멈춘다.
    const client = new OpenAI({ apiKey, maxRetries: 1 });

    // PLAN 11번: 질문을 법률 용어 검색어로 바꿔 관련 조문·판례를 고른다 (DESIGN.md 3장 ④).
    // 검색어 만들기가 실패하면(시간 초과 제외) 질문 글을 그대로 검색어로 쓴다.
    // 이때 AI가 함께 볼 관련 법령 이름(relatedLaws)도 고른다 (PRD 6장 "관련 법령").
    let terms: string[];
    let relatedLaws: RelatedLawRequest[] = [];
    try {
      const plan = await makeSearchTerms(client, messages, deadline);
      terms = plan.terms;
      relatedLaws = plan.relatedLaws;
    } catch (error) {
      if (deadline.aborted) throw error;
      console.error("[api/ask] 검색어 만들기 실패, 질문 글로 대신 검색:", error instanceof Error ? error.message : error);
      terms = messages[messages.length - 1].text.split(/\s+/);
    }
    const found = searchMaterials(terms);

    // PLAN 12번: 국가법령정보센터를 조회해 보완한다 (DESIGN.md 3장 "자료 찾는 방법" 4).
    // 질문마다 항상 판례·법령해석례(유권해석)를 실시간 조회한다 (PRD 6장 "자료 확보 방식").
    // 새로 공개된 판례·해석례도 바로 반영되며, 넣어 둔 판례와 같은 사건번호는 다시 가져오지 않는다.
    // 조회가 실패해도 오류를 띄우지 않고, 넣어 둔 자료만으로 답한 뒤 안내 문구를 붙인다.
    // 조회는 최대 LOOKUP_TIMEOUT_MS까지만 기다린다. 국가법령정보센터가 느려도 30초 안에 답을 만들 시간을 남기기 위해서다.
    // 이 시간을 넘기면 조회 실패로 보고, 넣어 둔 자료만으로 답한다.
    // 판례·유권해석 조회와, 질문에 필요한 다른 법령의 조문 조회를 함께 시작해 같은 시간 제한 안에서 기다린다.
    const lookupSignal = AbortSignal.any([deadline, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]);
    const guarded = async <T,>(run: () => Promise<T>): Promise<T | { status: "failed" }> => {
      try {
        return await run();
      } catch (error) {
        if (deadline.aborted) throw error;
        console.error(`[api/ask] 국가법령정보센터 조회가 실패했거나 ${LOOKUP_TIMEOUT_MS / 1000}초를 넘겨 건너뜀`);
        return { status: "failed" };
      }
    };
    // 국유재산법 외에 함께 보는 법령(민법 등)을 인용한 판례도 찾는다. 시행령·시행규칙은 판례에 따로 인용되지 않으므로 뺀다.
    const extraPrecedentLaws = relatedLaws
      .filter((l) => !/(시행령|시행규칙)$/.test(l.name) && !/^국유재산법$/.test(l.name.replace(/\s+/g, "")))
      .map((l) => ({ law: l.name, word: l.keywords[0] ?? "" }));
    const [lookup, lawLookup]: [LookupResult, LawLookupResult] = await Promise.all([
      guarded(() =>
        lookupLawCenter(terms, lookupSignal, {
          precedents: true,
          interpretations: true,
          excludeCaseNumbers: found.cases.map((c) => c.caseNumber),
          extraPrecedentLaws,
        }),
      ),
      // 이미 data 폴더에서 골라 AI에 넘기는 조문은 다시 가져오지 않고, 그 조문 속 인용은 따라간다.
      guarded(() =>
        lookupRelatedLaws(
          relatedLaws,
          lookupSignal,
          found.laws.map((l) => ({ law: l.law, article: l.article, text: l.content })),
        ),
      ),
    ]);
    const lookupItems = lookup.status === "ok" ? lookup.items : [];

    // 법령 조문은 후보를 넓게 모은 것이므로, 질문에 정말 필요한 조문만 AI가 고른다.
    // 고르기에 실패하면(시간 초과 제외) 후보의 앞쪽(법령별로 점수가 높은 순)을 그대로 쓴다.
    const candidates = lawLookup.status === "ok" ? lawLookup.articles : [];
    let lawArticles = candidates;
    if (candidates.length > SELECT_ABOVE) {
      try {
        lawArticles = (await selectArticles(client, messages, candidates, deadline)) ?? candidates.slice(0, SELECT_FALLBACK);
      } catch (error) {
        if (deadline.aborted) throw error;
        console.error("[api/ask] 후보 조문 고르기 실패, 후보 앞쪽을 그대로 사용:", error instanceof Error ? error.message : error);
        lawArticles = candidates.slice(0, SELECT_FALLBACK);
      }
    }

    const materials = [formatMaterials(found), formatLookup(lookupItems), formatLawArticles(lawArticles)]
      .filter(Boolean)
      .join("\n\n");

    // PLAN 14번: 답을 정해진 형식(ANSWER_FORMAT)으로 받고 검사한다.
    // 형식이 틀리면 1번 다시 요청하고, 그래도 틀리면 "답변 형식 오류"로 알린다 (DESIGN.md 2장).
    let answer = null;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      const response = await askAI(
        client,
        {
          // PLAN 13번: PRD 5장의 AI 규칙 + 찾은 참고 자료
          instructions: buildInstructions(materials),
          input: messages.map((m) => ({ role: m.role, content: m.text })),
          text: { format: ANSWER_FORMAT },
        },
        deadline,
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

    // 근거 조문도 같은 방식으로 대조한다. 이번에 넘긴 조문(data 폴더 + 실시간 조회)에 없는 조문은 내보내지 않는다.
    const checkedBasis = verifyLegalBasis(verified.answer, [
      ...found.laws.map((l) => ({ law: l.law, article: l.article, effectiveDate: l.effectiveDate })),
      ...lawArticles.map((a) => ({ law: a.law, article: a.article, effectiveDate: a.effectiveDate })),
    ]);
    if (checkedBasis.removed.length > 0) {
      console.error("[api/ask] 자료에 없는 근거 조문을 걸러냄:", checkedBasis.removed.join(", "));
    }

    // PRD 7장: 답변에도 개인정보를 넣지 않는다. 숫자형 개인정보가 있으면 가린다 (내용은 기록하지 않음).
    const safe = maskAnswerPersonalInfo(checkedBasis.answer);
    if (safe.masked > 0) {
      console.error(`[api/ask] 답변 속 개인정보 ${safe.masked}건을 가림`);
    }

    // 이번 답변을 만들면서 AI가 받아 본 자료의 요약. 화면에 "검토한 자료"로 보여 준다.
    const reviewed = {
      laws: [...new Set([...found.laws.map((l) => l.law), ...lawArticles.map((a) => a.law)])],
      articleCount: found.laws.length + lawArticles.length,
      caseCount: found.cases.length + lookupItems.length,
    };

    return Response.json({
      answer: { ...safe.answer, reviewed },
      notice: lookup.status === "failed" || lawLookup.status === "failed" ? LOOKUP_FAILED_NOTICE : null,
      // 어떤 자료를 찾아 AI에 넘겼는지 (PLAN 16번 작업과 확인용)
      sources: {
        terms: found.terms,
        laws: found.laws.map((l) => l.id),
        cases: found.cases.map((c) => c.id),
        lawsInsufficient: found.lawsInsufficient,
        casesInsufficient: found.casesInsufficient,
        lookup: lookup.status,
        lookupItems: lookupItems.map((i) => `${i.kind} ${i.number}`),
        // AI가 고른 관련 법령과, 실제로 가져온 조문
        relatedLawRequests: relatedLaws.map((l) => l.name),
        lawLookup: lawLookup.status,
        lawLookupLaws: lawLookup.status === "ok" ? lawLookup.laws : [],
        lawLookupNotFound: lawLookup.status === "ok" ? lawLookup.notFound : [],
        lawCandidates: candidates.length, // 후보로 모은 조문 수
        lawArticles: lawArticles.map((a) => `${a.law} ${a.article}${a.via ? " (인용)" : ""}`), // AI가 고른 조문
        removedCaseNumbers: verified.removed,
        removedLegalBasis: checkedBasis.removed,
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
