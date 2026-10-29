// 자료 찾기 (PLAN 11번, DESIGN.md 3장 "자료 찾는 방법")
// 1) AI가 질문을 법률 용어 검색어 3~5개로 바꾼다.
// 2) data 폴더의 조문·판례에 검색어별 점수를 매겨 조문 최대 5개, 판례 최대 5건을 고른다.
// 3) 맞는 조문이나 판례가 1건도 없으면 "부족"으로 표시한다 (PLAN 12번 국가법령정보센터 조회에 사용).
import type OpenAI from "openai";
import lawsData from "../data/laws.json";
import casesData from "../data/cases.json";
import { AI_MODEL } from "./ai";
import type { LawArticle, RelatedLawRequest } from "./law-text";

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

// 검색 계획: 법률 용어 검색어와, 함께 봐야 할 관련 법령 (PRD 6장 "관련 법령")
export type SearchPlan = { terms: string[]; relatedLaws: RelatedLawRequest[] };

// 1) 질문 → 법률 용어 검색어 + 관련 법령 이름 (AI에 짧게 요청)
export async function makeSearchTerms(
  client: OpenAI,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<SearchPlan> {
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
        "앞 대화에 이어지는 질문이면 앞 대화의 주제를 반영하라. " +
        "또한 이 질문에 답하려면 국유재산법·시행령 외에 함께 봐야 하는 다른 현행 법령이 있으면 relatedLaws에 최대 6개 넣어라. " +
        "질문의 쟁점마다 적용될 수 있는 법령(일반법과 특별법, 절차를 정한 법, 처분에 불복하는 절차를 정한 법 등)을 빠짐없이 떠올려라. " +
        "name은 약칭이 아닌 정식 법령명이어야 한다(예: 민법, 행정절차법, 국세징수법, 급경사지 재해예방에 관한 법률). " +
        "법률이 세부 내용을 '대통령령으로 정한다'고 위임하는 경우가 많으므로, 질문이 대상·범위·기준·요율처럼 세부 내용에 걸려 있으면 그 법의 시행령(예: 급경사지 재해예방에 관한 법률 시행령)도 따로 넣어라. " +
        "keywords는 그 법에서 찾을 법률 용어 2~4개, articles는 조문 번호를 확실히 알 때만(예: 제162조) 넣고 모르면 빈 배열로 둔다. " +
        "국유재산법이나 그 시행령에서 더 필요한 조문이 있으면 그 법도 넣을 수 있다. 다른 법령이 필요 없으면 빈 배열로 둔다. " +
        "질문에 나오지 않는 법령을 억지로 넣지 않는다.",
      input: recent,
      text: {
        format: {
          type: "json_schema",
          name: "search_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              terms: { type: "array", items: { type: "string" } },
              relatedLaws: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    keywords: { type: "array", items: { type: "string" } },
                    articles: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "keywords", "articles"],
                  additionalProperties: false,
                },
              },
            },
            required: ["terms", "relatedLaws"],
            additionalProperties: false,
          },
        },
      },
    },
    { signal },
  );

  const parsed = JSON.parse(response.output_text) as {
    terms: string[];
    relatedLaws: RelatedLawRequest[];
  };
  return {
    terms: parsed.terms.map((t) => t.trim()).filter(Boolean).slice(0, 5),
    relatedLaws: parsed.relatedLaws
      .map((l) => ({
        name: l.name.trim(),
        keywords: l.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 4),
        articles: l.articles.map((a) => a.trim()).filter(Boolean).slice(0, 4),
      }))
      .filter((l) => l.name)
      .slice(0, 6),
  };
}

// ---------- 후보 조문 중 질문에 필요한 것만 고르기 ----------
// 법령·시행령·인용된 조문을 넓게 모으면(lib/law-text.ts) 관계없는 조문도 섞인다.
// 낱말 점수만으로는 그것을 걸러 내기 어려워서, 후보의 번호·제목·앞부분만 AI에게 보여 주고 질문에 필요한 것만 고르게 한다.
// (전체 조문을 읽히는 게 아니라 목록만 보여 주므로 빠르다.)
const MAX_SELECTED = 16;

// 실패하면 null을 돌려준다. 그때는 부르는 쪽이 후보의 앞쪽을 그대로 쓴다.
export async function selectArticles(
  client: OpenAI,
  messages: ChatMessage[],
  candidates: LawArticle[],
  signal: AbortSignal,
): Promise<LawArticle[] | null> {
  const recent = messages
    .slice(-RECENT_MESSAGES)
    .map((m) => `${m.role === "user" ? "직원" : "챗봇"}: ${m.text}`)
    .join("\n");

  const list = candidates
    .map((a, i) => {
      // 제목 줄을 뺀 본문 앞부분만 보여 준다.
      const lines = a.text.split("\n");
      const first = lines[0].replace(/^제\d+조(?:의\d+)?\([^)]*\)\s*/, "");
      const preview = [first, ...lines.slice(1)].join(" ").replace(/\s+/g, " ").slice(0, 110);
      return `${i + 1}. ${a.law} ${a.article}(${a.title})${a.via ? ` [${a.via}에서 인용됨]` : ""} — ${preview}`;
    })
    .join("\n");

  const response = await client.responses.create(
    {
      model: AI_MODEL,
      instructions:
        "너는 국유재산 업무 법률 질문에 답하기 위한 조문 선별을 돕는다. 아래 후보 조문 중에서 이 질문에 답하는 데 직접 필요한 조문의 번호만 골라라. " +
        "질문의 쟁점에 적용되는 조문, 그 조문이 세부 내용을 위임한 시행령 조문, 인용·준용 관계로 이어져 결론에 영향을 주는 조문을 고른다. " +
        "서로 다른 법령의 조문이 같은 쟁점을 다루면 모두 고른다(종합 검토). " +
        "이름만 비슷하거나 쟁점이 다른 조문(예: 세금 종류별 신고·납부 규정)은 고르지 않는다. 인용되어 따라온 조문은 관련성을 더 엄격하게 본다. " +
        `최대 ${MAX_SELECTED}개까지 고르고, 관련 있는 조문이 없으면 빈 배열로 둔다.`,
      input: `질문 맥락:\n${recent}\n\n후보 조문:\n${list}`,
      text: {
        format: {
          type: "json_schema",
          name: "selected_articles",
          strict: true,
          schema: {
            type: "object",
            properties: { selected: { type: "array", items: { type: "integer" } } },
            required: ["selected"],
            additionalProperties: false,
          },
        },
      },
    },
    { signal },
  );

  const { selected } = JSON.parse(response.output_text) as { selected: number[] };
  const valid = [...new Set(selected)].filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length);
  return valid.slice(0, MAX_SELECTED).map((n) => candidates[n - 1]);
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
