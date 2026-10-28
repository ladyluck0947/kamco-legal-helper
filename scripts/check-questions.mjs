// 테스트 질문 검증: tests/questions.md의 모든 질문에 대해
//  1) 근거로 적은 조문·판례가 data 폴더에 실제로 있는지
//  2) 정답 기준에 쓴 숫자(120%, 5년, 3천만원 등)가 근거 원문에 실제로 있는지
// 를 확인한다. 하나라도 틀리면 실패로 끝난다.
// 사용: npm run check:questions
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, ROOT } from "./lib.mjs";

const md = readFileSync(join(ROOT, "tests", "questions.md"), "utf8");
const laws = JSON.parse(readFileSync(join(DATA, "laws.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(DATA, "cases.json"), "utf8"));

const rows = md
  .split("\n")
  .filter((l) => /^\| \d+ \|/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()));
let problems = 0;

for (const [, no, , answer, basis] of rows) {
  const texts = [];
  const missing = [];

  for (const m of basis.matchAll(/(국유재산법(?: 시행령)?) (제\d+조(?:의\d+)?)/g)) {
    const law = laws.find((l) => l.law === m[1] && l.article === m[2]);
    if (law) texts.push(law.content);
    else missing.push(`${m[1]} ${m[2]}`);
  }
  for (const m of basis.matchAll(/대법원 (\d{2,4}[가-힣]{1,3}\d+)/g)) {
    const c = cases.find((x) => x.caseNumber === m[1]);
    if (c) texts.push(`${c.holdings} ${c.summary ?? ""}`);
    else missing.push(m[1]);
  }
  if (texts.length === 0 && missing.length === 0) missing.push("근거 칸에 조문·판례가 없음");

  // 정답 속 숫자 표현이 근거 원문에 있는지 (%는 원문의 "퍼센트" 표기로 바꿔 비교)
  const all = texts.join(" ").replace(/\s+/g, "");
  const nums = [...answer.matchAll(/(100분의 ?\d+|1천분의 ?\d+|연 ?\d+%|\d+(?:만원|천만원|년|개월|퍼센트))/g)].map((m) => m[1]);
  const absent = nums.filter((n) => !all.includes(n.replace(/\s+/g, "").replace(/^연(\d+)%$/, "$1퍼센트")));

  const ok = missing.length === 0 && absent.length === 0;
  if (!ok) problems++;
  console.log(
    `${ok ? "PASS" : "FAIL"} | ${no}번 | 근거 ${texts.length}개` +
      (missing.length ? ` | 없는 근거: ${missing.join(", ")}` : "") +
      (absent.length ? ` | 원문에 없는 숫자: ${absent.join(", ")}` : ""),
  );
}

console.log(`\n질문 ${rows.length}개 중 문제 ${problems}개`);
process.exit(problems > 0 ? 1 : 0);
