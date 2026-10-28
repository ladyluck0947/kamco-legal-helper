// 성공 기준 측정 (PLAN 18번, PRD 3장)
// tests/questions.md의 질문을 하나씩 /api/ask에 보내, 걸린 시간·답변·인용한 근거를 기록하고
// 근거가 정답 기준과 맞는지 자동으로 비교한다. 결과는 tests/results.json에 저장한다.
// 결론이 맞는지는 사람이 판단해야 하므로, 판정은 tests/results.md에 따로 적는다.
// 사용: npm run dev 로 서버를 띄운 뒤 → npm run measure -- [서버 주소]
//   예: npm run measure -- http://localhost:3001  (생략하면 http://localhost:3000)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const base = process.argv[2] ?? "http://localhost:3000";

const rows = readFileSync(join(ROOT, "tests", "questions.md"), "utf8")
  .split("\n")
  .filter((l) => /^\| \d+ \|/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()))
  .map(([, no, question, expected, basis]) => ({ no: Number(no), question, expected, basis }));

const norm = (s) => s.replace(/\s+/g, "");

// 정답 기준의 근거 목록: 조문(법령명+조 번호)과 판례(사건번호)
function expectedSources(basis) {
  const laws = [...basis.matchAll(/(국유재산법(?: 시행령)?) (제\d+조(?:의\d+)?)/g)].map((m) => ({ law: m[1], article: m[2] }));
  const cases = [...basis.matchAll(/대법원 (\d{2,4}[가-힣]{1,3}\d+)/g)].map((m) => m[1]);
  return { laws, cases };
}

// 답변이 그 근거를 인용했는지: 조문은 법령명과 조 번호가 같으면 인정(항·호는 따지지 않음)
// 한 칸에 "제72조 제1항, 제73조 제1항"처럼 여러 조문이 있거나 법령명 칸에 조 번호가 섞여도 모두 읽는다.
function cited(answer, exp) {
  const citedSet = new Set();
  for (const b of answer.legalBasis) {
    const law = norm(b.law.replace(/제\d+조.*$/, ""));
    for (const m of `${b.law} ${b.article}`.matchAll(/제\d+조(?:의\d+)?/g)) citedSet.add(`${law}|${m[0]}`);
  }
  const all = norm(JSON.stringify(answer));
  const lawHit = exp.laws.map((e) => citedSet.has(`${norm(e.law)}|${e.article}`));
  const caseHit = exp.cases.map((n) => all.includes(n));
  const hits = [...lawHit, ...caseHit];
  return { total: hits.length, hit: hits.filter(Boolean).length };
}

const results = [];
for (const row of rows) {
  const started = Date.now();
  let data = null;
  let status = 0;
  try {
    const res = await fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: row.question }] }),
    });
    status = res.status;
    data = await res.json();
  } catch (error) {
    data = { error: String(error) };
  }
  const seconds = (Date.now() - started) / 1000;
  const answer = data?.answer ?? null;
  const exp = expectedSources(row.basis);
  const c = answer ? cited(answer, exp) : { total: 0, hit: 0 };

  const result = {
    no: row.no,
    question: row.question,
    expected: row.expected,
    expectedBasis: row.basis,
    status,
    seconds,
    type: answer?.type ?? "오류",
    summary: answer?.summary ?? [],
    legalBasis: (answer?.legalBasis ?? []).map((b) => `${b.law} ${b.article} (${b.effectiveDate} 시행)`),
    cases: (answer?.cases ?? []).map((x) => x.caseNumber),
    hasBasisWithDate: !!answer && answer.legalBasis.length > 0 && answer.legalBasis.every((b) => b.effectiveDate),
    citedAll: c.total > 0 && c.hit === c.total,
    citedAny: c.hit > 0,
    citedCount: `${c.hit}/${c.total}`,
    removedCaseNumbers: data?.sources?.removedCaseNumbers ?? [],
    error: data?.error ?? null,
    rawAnswer: answer,
  };
  results.push(result);
  console.log(
    `${String(row.no).padStart(2)}번 | ${seconds.toFixed(1)}초 | ${result.type} | 근거 인용 ${result.citedCount}` +
      ` | 근거·시행일 ${result.hasBasisWithDate ? "있음" : "없음"}` +
      (result.removedCaseNumbers.length ? ` | 걸러낸 번호 ${result.removedCaseNumbers.join(",")}` : "") +
      (result.error ? ` | 오류 ${result.error}` : ""),
  );
}

writeFileSync(join(ROOT, "tests", "results.json"), JSON.stringify({ measuredAt: new Date().toISOString(), base, results }, null, 2) + "\n", "utf8");

const basic = results.filter((r) => r.no <= 20);
const avg = (list) => list.reduce((s, r) => s + r.seconds, 0) / list.length;
console.log(`\n[기본 1~20] 평균 ${avg(basic).toFixed(1)}초, 근거·시행일 표시 ${basic.filter((r) => r.hasBasisWithDate).length}/20, 정답 근거 모두 인용 ${basic.filter((r) => r.citedAll).length}/20`);
const deep = results.filter((r) => r.no > 20);
if (deep.length) console.log(`[심화 21~] 평균 ${avg(deep).toFixed(1)}초, 정답 근거 모두 인용 ${deep.filter((r) => r.citedAll).length}/${deep.length}`);
console.log("저장 → tests/results.json");
