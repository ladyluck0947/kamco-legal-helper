// 자료 찾기 (PLAN 11번, DESIGN.md 3장 "자료 찾는 방법")
// 1) AI가 질문을 법률 용어 검색어 3~5개로 바꾼다.
// 2) data 폴더의 조문·판례에 검색어별 점수를 매겨 조문 최대 5개, 판례 최대 5건을 고른다.
// 3) 맞는 조문이나 판례가 1건도 없으면 "부족"으로 표시한다 (PLAN 12번 국가법령정보센터 조회에 사용).
import type OpenAI from "openai";
import lawsData from "../data/laws.json";
import casesData from "../data/cases.json";
import { AI_MODEL } from "./ai";

export type LawItem = (typeof lawsData)[number];
export type CaseItem = (typeof casesData)[number];

export type SearchResult = {
  terms: string[];
  laws: LawItem[];
  cases: CaseItem[];
  // 부족 판단: 맞는 조문/판례가 하나도 없을 때 true
  lawsInsufficient: boolean;
  casesInsufficient: boolean;
};

const MAX_LAWS = 5;
const MAX_CASES = 5;
// 이 점수 미만은 관련 없는 자료로 본다 (본문에 흔한 낱말 하나만 겹친 경우를 걸러냄)
const MIN_SCORE = 3;

// 거의 모든 자료에 들어 있어 고르는 데 도움이 안 되는 말
const STOP_WORDS = new Set(["국유재산", "국유재산법", "시행령", "법", "조문", "규정", "판례"]);

// 화면 대화 중 검색어 만들기에 참고할 최근 대화 수 (이어지는 질문의 맥락을 알기 위해)
const RECENT_MESSAGES = 4;

type ChatMessage = { role: "user" | "assistant"; text: string };

// 1) 질문 → 법률 용어 검색어 (AI에 짧게 요청)
export async function makeSearchTerms(
  client: OpenAI,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<string[]> {
  const recent = messages
    .slice(-RECENT_MESSAGES)
    .map((m) => `${m.role === "user" ? "직원" : "챗봇"}: ${m.text}`)
    .join("\n");

  const response = await client.responses.create(
    {
      model: AI_MODEL,
      instructions:
        "너는 국유재산 법률 자료 검색을 돕는다. 대화의 마지막 직원 질문을 국유재산법령·판례에서 찾기 좋은 법률 용어 검색어 3~5개로 바꿔라. " +
        "일상어는 법률 용어로 바꾸고(예: 허락 없이 사용 → 무단점유, 임대료 → 대부료), 관련 조문 번호를 알면 '제72조'처럼 넣어라. " +
        "앞 대화에 이어지는 질문이면 앞 대화의 주제를 반영하라.",
      input: recent,
      text: {
        format: {
          type: "json_schema",
          name: "search_terms",
          strict: true,
          schema: {
            type: "object",
            properties: {
              terms: { type: "array", items: { type: "string" } },
            },
            required: ["terms"],
            additionalProperties: false,
          },
        },
      },
    },
    { signal },
  );

  const parsed = JSON.parse(response.output_text) as { terms: string[] };
  return parsed.terms.map((t) => t.trim()).filter(Boolean).slice(0, 5);
}

// 검색어를 비교하기 좋게 다듬는다 (띄어쓰기 차이 무시)
function normalize(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

// "제72조", "제73조의3" 같은 조문 번호 검색어인지
const ARTICLE_PATTERN = /^제\d+조(의\d+)?$/;

type ScoreTarget = { title: string; keywords: string[]; body: string; article?: string };

// 글자 하나(검색어 또는 낱말)가 자료와 맞는 정도: 제목 3점, 핵심어 2점, 본문 1점
function scoreText(t: string, item: ScoreTarget) {
  if (!t || STOP_WORDS.has(t)) return 0;

  // 조문 번호가 정확히 일치하면 가장 높은 점수
  if (ARTICLE_PATTERN.test(t)) {
    return item.article && normalize(item.article) === t ? 5 : 0;
  }

  let score = 0;
  if (normalize(item.title).includes(t)) score += 3;
  if (item.keywords.some((k) => normalize(k).includes(t) || t.includes(normalize(k)))) score += 2;
  if (normalize(item.body).includes(t)) score += 1;
  return score;
}

// 검색어 하나의 점수 = 검색어 전체로 비교한 점수 + 낱말마다 비교한 점수
// ("국유재산 수의계약 매각 사유"처럼 긴 검색어도 "수의계약", "매각"으로 나눠 찾을 수 있게)
function scoreTerm(term: string, item: ScoreTarget) {
  const words = term
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length >= 2);
  const phrase = normalize(term);
  const wordScore = words.length > 1 ? words.reduce((sum, w) => sum + scoreText(w, item), 0) : 0;
  return scoreText(phrase, item) + wordScore;
}

function rank<T>(items: T[], terms: string[], view: (item: T) => Parameters<typeof scoreTerm>[1], limit: number) {
  return items
    .map((item) => ({ item, score: terms.reduce((sum, term) => sum + scoreTerm(term, view(item)), 0) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}

// 2)·3) 검색어로 자료를 고르고 부족 여부를 판단한다.
export function searchMaterials(terms: string[]): SearchResult {
  const laws = rank(
    lawsData,
    terms,
    (l) => ({ title: l.title, keywords: l.keywords, body: l.content, article: l.article }),
    MAX_LAWS,
  );
  const cases = rank(
    casesData,
    terms,
    // 판례 이름("…부과처분취소")은 대부분 비슷해 구분에 도움이 적으므로 제목 점수 대신 본문 점수로만 친다.
    (c) => ({
      title: "",
      keywords: c.keywords,
      body: `${c.caseName ?? ""} ${c.holdings ?? ""} ${c.summary ?? ""}`,
    }),
    MAX_CASES,
  );

  return {
    terms,
    laws,
    cases,
    lawsInsufficient: laws.length === 0,
    casesInsufficient: cases.length === 0,
  };
}

// AI에 넘길 참고 자료 글. 각 자료 앞에 [자료 번호]를 붙여, 어떤 자료를 근거로 썼는지 확인할 수 있게 한다.
export function formatMaterials(result: SearchResult): string {
  const lawText = result.laws.map(
    (l) =>
      `[${l.id}] ${l.law} ${l.article}(${l.title}) — 시행 ${l.effectiveDate}\n${l.content}`,
  );
  const caseText = result.cases.map(
    (c) =>
      `[${c.id}] ${c.court} ${c.decisionDate}. 선고 ${c.caseNumber} ${c.judgmentType}` +
      `\n판시사항: ${c.holdings}` +
      // 원문에 판결요지가 없는 판례는 판시사항만 넘긴다.
      (c.summary ? `\n판결요지: ${c.summary}` : "") +
      `\n(참고: ${c.note})`,
  );

  return [
    "## 참고 조문",
    lawText.length ? lawText.join("\n\n") : "(찾은 조문 없음)",
    "## 참고 판례",
    caseText.length ? caseText.join("\n\n") : "(찾은 판례 없음)",
  ].join("\n\n");
}
