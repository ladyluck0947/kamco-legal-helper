// 숫자 형태의 개인정보 찾기 (PLAN 4번, PRD 7장)
// 화면(PLAN 5번)과 서버(PLAN 7번)가 같은 기준으로 검사하도록 이 파일 하나를 함께 쓴다.
// 이름·주소처럼 모양이 일정하지 않은 개인정보는 여기서 찾지 않고, 화면의 안내 문구로 주의를 준다.

export type PiiType = "resident" | "phone" | "account";

// 찾아낸 개인정보 한 건: 종류와 질문 속 위치(문제 부분 표시에 사용)
export type PiiMatch = {
  type: PiiType;
  label: string;
  text: string;
  start: number;
  end: number;
};

// 앞뒤에 다른 숫자가 붙어 있으면 더 긴 숫자의 일부이므로 찾지 않는다.
const NOT_DIGIT_BEFORE = String.raw`(?<!\d)`;
const NOT_DIGIT_AFTER = String.raw`(?!\d)`;

// 먼저 적은 규칙이 우선한다. (예: 01012345678은 계좌번호가 아니라 전화번호로 본다)
const RULES: { type: PiiType; label: string; pattern: string }[] = [
  {
    // 주민등록번호·외국인등록번호: 생년월일 6자리 + 뒤 7자리 (뒷자리 첫 숫자 1~8)
    type: "resident",
    label: "주민등록번호",
    pattern: String.raw`\d{6}[-\s]?[1-8]\d{6}`,
  },
  {
    // 휴대전화: 010·011·016·017·018·019
    type: "phone",
    label: "전화번호",
    pattern: String.raw`01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}`,
  },
  {
    // 일반전화: 02, 031~064 지역번호, 070 인터넷전화
    type: "phone",
    label: "전화번호",
    pattern: String.raw`0(?:2|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}`,
  },
  {
    // 계좌번호(하이픈 구분): 숫자 묶음 3~4개, 숫자 합계 10~14자리
    // 날짜(2024-01-01, 8자리)는 자리 수가 모자라 걸리지 않는다.
    type: "account",
    label: "계좌번호",
    pattern: String.raw`\d{2,6}-\d{2,6}-\d{2,6}(?:-\d{1,3})?`,
  },
  {
    // 계좌번호(붙여 쓴 숫자): 11~14자리. 바로 뒤에 "원"이 오면 금액으로 보고 제외한다.
    type: "account",
    label: "계좌번호",
    pattern: String.raw`\d{11,14}(?!\s*원)`,
  },
];

function countDigits(text: string) {
  return text.replace(/\D/g, "").length;
}

// 질문에서 숫자 형태의 개인정보를 모두 찾아 앞에서부터 순서대로 돌려준다.
export function findPersonalInfo(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];

  for (const rule of RULES) {
    const regex = new RegExp(
      NOT_DIGIT_BEFORE + rule.pattern + NOT_DIGIT_AFTER,
      "g",
    );
    for (const match of text.matchAll(regex)) {
      const start = match.index;
      const end = start + match[0].length;

      // 하이픈으로 나눈 계좌번호는 숫자 합계가 10~14자리일 때만 인정한다.
      if (rule.type === "account") {
        const digits = countDigits(match[0]);
        if (digits < 10 || digits > 14) continue;
      }

      // 이미 앞선 규칙으로 찾은 부분과 겹치면 건너뛴다.
      const overlaps = found.some((f) => start < f.end && end > f.start);
      if (overlaps) continue;

      found.push({ type: rule.type, label: rule.label, text: match[0], start, end });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

// 개인정보가 하나라도 있으면 true
export function hasPersonalInfo(text: string): boolean {
  return findPersonalInfo(text).length > 0;
}

// 글 속 개인정보를 "[개인정보 가림]"으로 바꾸고, 가린 개수를 함께 돌려준다 (답변 검사에 사용).
export function maskPersonalInfo(text: string): { text: string; count: number } {
  const found = findPersonalInfo(text);
  let masked = text;
  // 뒤에서부터 바꿔야 앞쪽 위치가 어긋나지 않는다.
  for (const match of [...found].reverse()) {
    masked = masked.slice(0, match.start) + "[개인정보 가림]" + masked.slice(match.end);
  }
  return { text: masked, count: found.length };
}
