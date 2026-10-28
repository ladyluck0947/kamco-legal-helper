// 판례 원문 가져오기: 국가법령정보센터 판례 원문에서 판시사항·판결요지·참조조문을 그대로 잘라 저장한다.
// 사용: npm run cases:fetch -- <판례일련번호(precSeq)...>
//   예: npm run cases:fetch -- 175033 173320
// 결과: 컴퓨터 임시 폴더의 cases-raw.json (data 폴더는 바꾸지 않는다. 추가는 cases:add로 한다)
// 판례일련번호는 국가법령정보센터 판례 검색 결과의 링크(precView('175033'))에 있는 숫자다.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, htmlToText } from "./lib.mjs";

const seqs = process.argv.slice(2);
if (seqs.length === 0) {
  console.log("판례일련번호를 1개 이상 적어 주세요. 예: npm run cases:fetch -- 175033");
  process.exit(1);
}

// 【제목】 다음부터 다음 【 전까지
function section(text, name) {
  const i = text.indexOf(`【${name}】`);
  if (i < 0) return null;
  const rest = text.slice(i + name.length + 2);
  const j = rest.indexOf("【");
  return (j < 0 ? rest : rest.slice(0, j)).trim();
}

const out = [];
for (const seq of seqs) {
  const text = htmlToText(await (await fetch(`https://www.law.go.kr/LSW/precInfoR.do?precSeq=${seq}`)).text());

  // 머리말: "대법원 2014. 7. 16. 선고 2011다76402 전원합의체 판결" 형태
  const head = text.match(/([가-힣]+법원)\s+(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.)\s*선고\s+([0-9]{2,4}[가-힣]{1,3}[0-9]+)\s*([^\n[]*?판결)/);
  const title = text.match(/\n([^\n]+)\n\[[가-힣]+법원 \d{4}\./);
  if (!head) {
    console.log(`${seq}: 판례 머리말을 찾지 못했어요. 번호를 확인해 주세요.`);
    continue;
  }

  const item = {
    type: "판례",
    caseName: title ? title[1].trim() : null,
    court: head[1],
    decisionDate: head[2].replace(/\s/g, " ").replace(/\.$/, ""),
    caseNumber: head[3],
    judgmentType: head[4].trim(),
    holdings: section(text, "판시사항"),
    summary: section(text, "판결요지"),
    references: section(text, "참조조문"),
    source: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${seq}`,
  };
  out.push(item);
  console.log(`\n■ ${seq}: ${item.court} ${item.decisionDate}. ${item.caseNumber} ${item.judgmentType} | ${item.caseName}`);
  console.log(`  판시사항: ${(item.holdings ?? "없음").replace(/\s+/g, " ")}`);
  console.log(`  판결요지: ${item.summary ? `${item.summary.length}자` : "없음(판시사항만 있음)"}`);
}

mkdirSync(WORK, { recursive: true });
const file = join(WORK, "cases-raw.json");
writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
console.log(`\n${out.length}건 저장 → ${file}`);
