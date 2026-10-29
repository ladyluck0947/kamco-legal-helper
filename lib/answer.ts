// 서버가 화면에 돌려주는 답변 형식 (DESIGN.md 3장 "서버가 화면에 돌려주는 답변 형식")
// 화면과 서버가 함께 쓰므로, 무거운 검사 도구(Zod)는 이 파일에 넣지 않는다 (검사는 lib/schema.ts).

export type AnswerType = "answer" | "clarify" | "out_of_scope" | "no_basis";

export type LegalBasis = {
  law: string; // 법령명 (예: 국유재산법)
  article: string; // 조·항·호 (예: 제73조의3 제1항)
  effectiveDate: string; // 그 법령의 시행일 (예: 2026. 8. 20.)
};

export type CaseRef = {
  caseNumber: string; // 사건번호 또는 안건번호
  date: string; // 선고·재결·회신일
  court: string; // 법원 또는 기관명
  gist: string; // 요지 (2줄 이내)
  partiallyPublic: boolean; // 일부만 공개된 자료인지
};

// 이번 답변을 만들면서 AI가 받아 본 자료의 요약 (서버가 채워서 화면에 "검토한 자료"로 보여 준다)
export type ReviewedSummary = {
  laws: string[]; // 검토한 법령 이름
  articleCount: number; // 법령 조문 수
  caseCount: number; // 판례·유권해석 수
};

export type StructuredAnswer = {
  type: AnswerType;
  reviewed?: ReviewedSummary;
  summary: string[]; // 결론 요약 (3문장 이내)
  detail: string; // 상세 설명
  legalBasis: LegalBasis[]; // 근거 조문 (일반 답변은 1개 이상)
  cases: CaseRef[]; // 관련 사례 (최대 3건)
  clarifyQuestions: string[]; // 되묻기일 때만: 확인할 질문 1~3개
  notice: string; // 범위 밖·근거 없음일 때만: 안내 문구
};

// 법령해석례(유권해석) 안건번호 모양인지 (예: 11-0503). 판례 사건번호와 이름표를 다르게 보여 주는 데 쓴다.
export function isInterpretationNumber(number: string): boolean {
  return /^\d{2}-\d{4}$/.test(number.trim());
}

// 앞의 대화로 AI에 다시 보낼 때 쓰는 글 버전 (화면이 열려 있는 동안의 대화 맥락용)
export function answerToText(a: StructuredAnswer): string {
  if (a.type === "clarify") return a.clarifyQuestions.join("\n");
  if (a.type !== "answer") return a.notice;
  const basis = a.legalBasis.map((b) => `${b.law} ${b.article}`).join(", ");
  return [a.summary.join(" "), a.detail, basis && `근거: ${basis}`].filter(Boolean).join("\n");
}
