// 사건번호 확인 (PLAN 16번, DESIGN.md 3장 ⑥ 답변 검사)
// AI가 쓴 사건번호·안건번호가 이번 질문에서 찾아 넘긴 자료에 실제로 있는지 서버가 직접 대조한다.
// - 사례 목록: 자료에 없는 사건번호의 사례는 빼 버린다.
// - 결론·설명 글: 자료에 없는 사건번호는 "(확인되지 않은 사건번호)"로 바꾼다.
// AI에게 "지어내지 말라"고 부탁하는 것(lib/prompt.ts)에 더해, 혹시 지어내도 화면에 나가지 않게 하는 마지막 안전장치다.
import type { StructuredAnswer } from "./answer";
import { maskPersonalInfo } from "./pii";

const UNVERIFIED = "(확인되지 않은 사건번호)";

// 판례 사건번호 모양: 연도(2~4자리) + 사건 종류 글자 + 번호. 예: 2011다76402, 99두2239, 2009구합3357, 2015헌마123
// 사건 종류 글자를 정해 두어 "2000년10월" 같은 날짜를 사건번호로 오해하지 않게 한다.
const CASE_TYPES = "가합|가단|가소|구합|구단|다|두|누|나|도|마|므|후|허|카|재|헌[가-힣]";
const CASE_NUMBER = new RegExp(String.raw`(?<![\d가-힣])\d{2,4}\s?(?:${CASE_TYPES})\s?\d{2,7}(?!\d)`, "g");
// 법령해석례 안건번호 모양: 13-0217
const ITEM_NUMBER = /(?<![\d-])\d{2}-\d{4}(?![\d-])/g;

function normalize(number: string) {
  return number.replace(/\s+/g, "");
}

export type VerifyResult = {
  answer: StructuredAnswer;
  removed: string[]; // 자료에 없어서 빼거나 바꾼 번호 (서버 확인용)
};

// allowedNumbers: 이번 질문에서 AI에 넘긴 판례·해석례의 사건번호·안건번호
export function verifyCaseNumbers(answer: StructuredAnswer, allowedNumbers: string[]): VerifyResult {
  const allowed = new Set(allowedNumbers.map(normalize));
  const removed = new Set<string>();

  // AI가 사건번호 칸에 "2014. 7. 16. 선고 2011다76402"처럼 날짜·법원을 붙여 쓰는 경우가 있어,
  // 칸 안에서 사건번호 모양만 뽑아 대조하고, 맞으면 사건번호만 남긴다.
  const cases = answer.cases.flatMap((c) => {
    const numbers = [...c.caseNumber.matchAll(CASE_NUMBER), ...c.caseNumber.matchAll(ITEM_NUMBER)].map((m) => m[0]);
    const match = numbers.find((n) => allowed.has(normalize(n)));
    if (!match) {
      removed.add(c.caseNumber);
      return [];
    }
    return [{ ...c, caseNumber: normalize(match) }];
  });

  const fix = (text: string) =>
    text.replace(CASE_NUMBER, mask).replace(ITEM_NUMBER, mask);
  function mask(found: string) {
    if (allowed.has(normalize(found))) return found;
    removed.add(found);
    return UNVERIFIED;
  }

  return {
    answer: {
      ...answer,
      summary: answer.summary.map(fix),
      detail: fix(answer.detail),
      cases: cases.map((c) => ({ ...c, gist: fix(c.gist) })),
      notice: fix(answer.notice),
    },
    removed: [...removed],
  };
}

// ---------- 근거 조문 확인 ----------
// AI가 근거로 적은 조문(법령명 + 조 번호)이 이번에 넘긴 자료에 실제로 있는지 대조한다.
// - 자료에 없는 조문은 근거 목록에서 뺀다. (지어낸 조문이 화면에 나가지 않게)
// - 시행일이 자료와 다르게 적혔으면 자료의 시행일로 고친다.
// - 일반 답변인데 근거가 하나도 남지 않으면, 근거 없는 답을 내보내지 않고 "근거 없음" 안내로 바꾼다.
export type ProvidedArticle = { law: string; article: string; effectiveDate: string };

const NO_BASIS_NOTICE =
  "확인된 근거가 없습니다. 이번에 찾은 자료에서 질문에 맞는 조문을 확인하지 못했으니 법무 부서에 문의하세요.";

const compact = (text: string) => text.replace(/\s+/g, "");
// "제73조의3 제1항" → "제73조의3" (항·호는 떼고 조 번호까지만 비교한다)
const articleKey = (article: string) => compact(article).match(/^제\d+조(?:의\d+)?/)?.[0] ?? "";
const dateKey = (date: string) => (date.match(/\d+/g) ?? []).join("-");

export function verifyLegalBasis(
  answer: StructuredAnswer,
  provided: ProvidedArticle[],
): { answer: StructuredAnswer; removed: string[] } {
  const removed: string[] = [];
  const legalBasis = answer.legalBasis.flatMap((b) => {
    const key = articleKey(b.article);
    const hit = key && provided.find((p) => compact(p.law) === compact(b.law) && articleKey(p.article) === key);
    if (!hit) {
      removed.push(`${b.law} ${b.article}`);
      return [];
    }
    const sameDate = dateKey(b.effectiveDate) === dateKey(hit.effectiveDate);
    const fixed = hit.effectiveDate.trim().replace(/\.?$/, ".");
    return [sameDate ? b : { ...b, effectiveDate: fixed }];
  });

  if (answer.type === "answer" && legalBasis.length === 0) {
    return {
      answer: { ...answer, type: "no_basis", summary: [], detail: "", legalBasis: [], cases: [], notice: NO_BASIS_NOTICE },
      removed,
    };
  }
  return { answer: { ...answer, legalBasis }, removed };
}

// 답변 속 개인정보 가리기 (PRD 7장 "답변에도 개인정보를 넣지 않는다")
// 질문은 보내기 전에 막지만, AI가 판례 내용 등을 옮기면서 숫자형 개인정보를 쓸 수 있어 답변도 한 번 더 검사한다.
export function maskAnswerPersonalInfo(answer: StructuredAnswer): { answer: StructuredAnswer; masked: number } {
  let masked = 0;
  const fix = (text: string) => {
    const result = maskPersonalInfo(text);
    masked += result.count;
    return result.text;
  };

  return {
    answer: {
      ...answer,
      summary: answer.summary.map(fix),
      detail: fix(answer.detail),
      cases: answer.cases.map((c) => ({ ...c, gist: fix(c.gist) })),
      clarifyQuestions: answer.clarifyQuestions.map(fix),
      notice: fix(answer.notice),
    },
    masked,
  };
}
