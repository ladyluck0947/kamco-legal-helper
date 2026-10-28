// 판례 추가: cases:fetch로 가져온 원문에 검색용 핵심어를 붙여 data/cases.json 뒤에 추가한다.
// 사용: npm run cases:add -- <핵심어 파일>
//   핵심어 파일(JSON) 예: { "2011다76402": ["변상금", "부당이득", "민사소송"] }
//   핵심어 파일에 적은 사건번호만 추가한다. 이미 data에 있는 사건번호는 건너뛴다.
// 판시사항·판결요지 등 원문 필드는 손대지 않고 그대로 옮긴다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, WORK } from "./lib.mjs";

const keywordFile = process.argv[2];
if (!keywordFile) {
  console.log('핵심어 파일을 적어 주세요. 예: npm run cases:add -- keywords.json');
  process.exit(1);
}

// 윈도우 메모장·PowerShell이 파일 맨 앞에 붙이는 보이지 않는 표시(BOM)는 지우고 읽는다.
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

const raw = readJson(join(WORK, "cases-raw.json"));
const keywords = readJson(keywordFile);
const file = join(DATA, "cases.json");
const cases = JSON.parse(readFileSync(file, "utf8"));

// 판결이 구법 조문 기준인지 (구 국유재산법 또는 개정 전 조문 번호를 쓰는지)
const usesOldLaw = (c) => /구 국유재산법|국유재산법 제51조|국유재산법 제5조/.test(`${c.holdings} ${c.summary ?? ""}`);
const today = new Date().toISOString().slice(0, 10);

let next = cases.length + 1;
for (const [number, kw] of Object.entries(keywords)) {
  if (cases.some((c) => c.caseNumber === number)) {
    console.log(`건너뜀: ${number} (이미 있음)`);
    continue;
  }
  const c = raw.find((x) => x.caseNumber === number);
  if (!c) throw new Error(`가져온 원문에 없는 사건번호: ${number} (cases:fetch를 먼저 실행하세요)`);
  if (!Array.isArray(kw) || kw.length === 0) throw new Error(`핵심어가 비어 있음: ${number}`);

  cases.push({
    id: `case-${String(next++).padStart(2, "0")}`,
    ...c,
    partiallyPublic: false,
    note: usesOldLaw(c)
      ? "판결 당시의 구 국유재산법 조문 번호 기준이므로, 현행 조문과 번호·내용이 다를 수 있음"
      : "현행 국유재산법 조문 번호 기준 판결",
    keywords: kw,
    collectedAt: today,
  });
  console.log(`추가: ${cases.at(-1).id} ${number} (${c.decisionDate})`);
}

writeFileSync(file, JSON.stringify(cases, null, 2) + "\n", "utf8");
console.log(`data/cases.json 총 ${cases.length}건`);
