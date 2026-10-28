// 답변 형식 정의와 검사 (PLAN 14번, DESIGN.md 3장 "답변 종류별로 반드시 있어야 하는 항목")
// 1) ANSWER_FORMAT: AI에게 "이 칸에 맞춰 답하라"고 알려 주는 형식
// 2) parseAnswer: AI가 보낸 답이 그 형식과 종류별 필수 항목을 지켰는지 Zod로 확인한다.
import { z } from "zod";
import type { StructuredAnswer } from "./answer";

const MAX_SUMMARY = 3;
const MAX_CASES = 3;
const MAX_CLARIFY = 3;

// 화면에 별표 등이 그대로 보이지 않도록 마크다운 기호를 걷어 낸다.
function clean(text: string) {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

const text = z.string().transform(clean);

// PRD 5장 must ①의 안내 문구
const DEFAULT_NOTICE = {
  out_of_scope: "이 도우미는 국유재산 관련 법률 질문에 답합니다. 국유재산과 관련된 질문을 해 주세요.",
  no_basis: "확인된 근거가 없습니다. 법무 부서에 문의해 주세요.",
} as const;

// AI가 법령명 칸에 조문 번호까지 넣는 경우(예: 법령명 "국유재산법 제72조", 조문 "제1항")를 바로잡는다.
// 법령명에는 이름만 남기고, 조문 번호는 조문 칸 앞으로 옮긴다. 이미 조문 칸에 있으면 겹쳐 쓰지 않는다.
const ARTICLE_IN_LAW = /^(.*?)\s*(제\d+조(?:의\d+)?.*)$/;
function fixBasis(b: { law: string; article: string; effectiveDate: string }) {
  const m = b.law.match(ARTICLE_IN_LAW);
  if (!m) return b;
  const law = m[1].trim();
  const fromLaw = m[2].trim();
  const articleNo = fromLaw.match(/제\d+조(?:의\d+)?/)![0];
  const article = b.article.includes(articleNo) ? b.article : `${fromLaw} ${b.article}`.trim();
  return { ...b, law, article };
}
const textList = (max: number) =>
  z.array(text).transform((list) => list.filter(Boolean).slice(0, max));

const answerSchema = z
  .object({
    type: z.enum(["answer", "clarify", "out_of_scope", "no_basis"]),
    summary: textList(MAX_SUMMARY),
    detail: text,
    legalBasis: z
      .array(z.object({ law: text, article: text, effectiveDate: text }))
      .transform((list) => list.map(fixBasis)),
    cases: z
      .array(
        z.object({
          caseNumber: text,
          date: text,
          court: text,
          gist: text,
          partiallyPublic: z.boolean(),
        }),
      )
      // PLAN 15번: 사건번호·날짜·법원(기관)명 중 하나라도 빠진 사례는 보여 주지 않고, 최대 3건만 남긴다.
      .transform((list) =>
        list.filter((c) => c.caseNumber && c.date && c.court).slice(0, MAX_CASES),
      ),
    clarifyQuestions: textList(MAX_CLARIFY),
    notice: text,
  })
  // 범위 밖·근거 없음인데 AI가 안내 문구 칸을 비우고 다른 칸에 썼으면 그 글을 쓰고,
  // 그것도 없으면 PRD 5장에 정한 안내 문구로 채운다.
  .transform((a) => {
    if ((a.type !== "out_of_scope" && a.type !== "no_basis") || a.notice) return a;
    const written = [a.summary.join(" "), a.detail].find(Boolean);
    return { ...a, notice: written ?? DEFAULT_NOTICE[a.type] };
  })
  .superRefine((a, ctx) => {
    const missing = (message: string) => ctx.addIssue({ code: "custom", message });
    if (a.type === "answer") {
      if (a.summary.length === 0) missing("일반 답변에 결론 요약이 없음");
      if (!a.detail) missing("일반 답변에 상세 설명이 없음");
      if (a.legalBasis.length === 0) missing("일반 답변에 근거 조문이 없음");
      if (a.legalBasis.some((b) => !b.effectiveDate)) missing("근거 조문에 시행일이 없음");
    }
    if (a.type === "clarify" && a.clarifyQuestions.length === 0) missing("되묻기에 질문이 없음");
    if ((a.type === "out_of_scope" || a.type === "no_basis") && !a.notice) missing("안내 문구가 없음");
  });

// AI가 보낸 글(JSON)을 검사한다. 형식이 틀리면 null.
export function parseAnswer(raw: string): StructuredAnswer | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = answerSchema.safeParse(json);
  if (!result.success) {
    console.error("[schema] 답변 형식 오류:", result.error.issues.map((i) => i.message).join(", "));
    return null;
  }
  return result.data;
}

const str = { type: "string" } as const;
const strList = { type: "array", items: str } as const;

// AI에게 넘기는 답변 형식 (OpenAI 구조화 출력)
export const ANSWER_FORMAT = {
  type: "json_schema",
  name: "legal_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["type", "summary", "detail", "legalBasis", "cases", "clarifyQuestions", "notice"],
    properties: {
      type: { type: "string", enum: ["answer", "clarify", "out_of_scope", "no_basis"] },
      summary: { ...strList, description: "일반 답변의 결론 요약. 문장 하나가 항목 하나, 최대 3개. 다른 종류면 빈 배열" },
      detail: { ...str, description: "일반 답변의 상세 설명. 다른 종류면 빈 문자열" },
      legalBasis: {
        type: "array",
        description: "일반 답변의 근거 조문 1개 이상. 다른 종류면 빈 배열",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["law", "article", "effectiveDate"],
          properties: {
            law: { ...str, description: "법령명만. 예: 국유재산법, 국유재산법 시행령. 조문 번호는 넣지 않는다" },
            article: { ...str, description: "조·항·호. 예: 제73조의3 제1항" },
            effectiveDate: { ...str, description: "참고 자료에 적힌 그 법령의 시행일. 예: 2026. 8. 20." },
          },
        },
      },
      cases: {
        type: "array",
        description: "참고 자료에 있는 판례·재결례·해석례 중 관련 높은 순 최대 3건. 없으면 빈 배열",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["caseNumber", "date", "court", "gist", "partiallyPublic"],
          properties: {
            caseNumber: { ...str, description: "참고 자료에 있는 사건번호·안건번호만 그대로. 예: 2011다76402. 법원명·날짜는 넣지 않는다" },
            date: { ...str, description: "선고·재결·회신일" },
            court: { ...str, description: "법원 또는 기관명" },
            gist: { ...str, description: "이 질문과 관련된 요지만 80자 이내로" },
            partiallyPublic: { type: "boolean", description: "일부만 공개된 자료면 true" },
          },
        },
      },
      clarifyQuestions: { ...strList, description: "되묻기일 때 직원에게 확인할 질문 1~3개. 다른 종류면 빈 배열" },
      notice: { ...str, description: "범위 밖·근거 없음일 때 안내 문구. 다른 종류면 빈 문자열" },
    },
  },
} as const;
