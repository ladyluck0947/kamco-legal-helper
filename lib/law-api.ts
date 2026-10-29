// 국가법령정보센터 조회 (PLAN 12번, DESIGN.md 3장 "자료 찾는 방법" 4)
// 질문마다 국가법령정보센터 Open API로 판례·법령해석례(유권해석)를 실시간으로 찾아, 넣어 둔 자료(data 폴더)를 보완한다.
// 새로 공개되는 판례·해석례도 따로 저장하지 않고 바로 반영된다 (PRD 6장 "자료 확보 방식").
// API 안내: https://open.law.go.kr (판례 target=prec, 법령해석례 target=expc)
//
// 인증값(OC)은 .env의 LAW_API_OC에서 읽는다.
// 개발 중(npm run dev)에 LAW_API_OC가 없으면, API 안내 문서에 공개된 시험용 값("test")으로 동작을 확인한다.
// 배포(Vercel)에서는 반드시 직접 신청한 인증값을 LAW_API_OC로 넣어야 하며, 없으면 조회를 건너뛴다.

export const BASE = "https://www.law.go.kr/DRF";
const MAX_RESULTS = 3; // DESIGN.md: 결과 중 상위 3건을 추가
const CANDIDATES = 20; // 해석례 목록에서 먼저 받아 볼 개수
const PRECEDENT_LIST = 40; // 판례 본문 검색 목록에서 받아 볼 개수
const PRECEDENT_DETAILS = 8; // 그중 본문을 열어 확인할 판례 수
const EXTRA_PRECEDENT_DETAILS = 6; // 국유재산법 외 법령의 판례는 요청을 아끼려고 본문을 6건만 연다

// 조회로 찾은 자료 한 건 (판례 또는 법령해석례)
export type LookupItem = {
  id: string;
  kind: "판례" | "법령해석례";
  title: string;
  number: string; // 사건번호 또는 안건번호
  date: string; // 선고일자 또는 회신(해석)일자
  org: string; // 법원명 또는 회신기관명
  text: string; // 판시사항+판결요지 또는 질의요지+회답
  link: string;
};

export function getOC(): string | null {
  const oc = process.env.LAW_API_OC?.trim();
  if (oc) return oc;
  return process.env.NODE_ENV === "development" ? "test" : null;
}

// 거의 모든 질문에 들어가 검색에 도움이 안 되는 말
const STOP_WORDS = new Set(["국유재산", "국유재산법", "시행령", "국유지", "요건", "기준", "사유", "방법", "여부", "관련"]);

// 검색어들에서 가장 자주 나온 핵심 낱말 2개를 고른다. (예: "국유재산 대부료 감면" → "대부료", "감면")
export function pickCoreWords(terms: string[]): string[] {
  const count = new Map<string, number>();
  for (const term of terms) {
    for (const word of term.split(/\s+/)) {
      if (word.length < 2 || STOP_WORDS.has(word) || /^제\d+조/.test(word)) continue;
      count.set(word, (count.get(word) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([word]) => word);
}

// HTML 태그·줄바꿈 정리 (API 본문에 <br/> 등이 섞여 온다)
function clean(text: unknown): string {
  return String(text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// 국가법령정보센터에 동시에 보내는 요청 수를 제한한다.
// 법령·판례를 폭넓게 조회하다 보면 요청이 수십 개가 되는데, 한꺼번에 보내면 일시 오류(404)가 늘어난다.
const MAX_CONCURRENT = 8;
let activeRequests = 0;
const waitingForSlot: Array<() => void> = [];

async function acquireSlot() {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  await new Promise<void>((resolve) => waitingForSlot.push(resolve));
}

function releaseSlot() {
  const next = waitingForSlot.shift();
  if (next) next(); // 기다리던 요청에 자리를 넘긴다
  else activeRequests--;
}

// 국가법령정보센터는 가끔 일시적으로 404·5xx를 돌려주므로, 실패하면 1번 다시 시도한다.
export async function getJson(url: string, signal: AbortSignal) {
  await acquireSlot();
  try {
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url, { signal });
      if (response.ok) return await response.json();
      status = response.status;
    }
    throw new Error(`국가법령정보센터 응답 오류 ${status}`);
  } finally {
    releaseSlot();
  }
}

// 여러 요청 중 성공한 것만 모은다 (자료 한 건이 실패해도 나머지는 살린다).
// 30초 시간 초과는 위로 넘겨 전체 요청을 멈추게 한다.
export async function settled<T>(promises: Promise<T>[], signal: AbortSignal): Promise<{ values: T[]; failed: number }> {
  const results = await Promise.allSettled(promises);
  if (signal.aborted) throw signal.reason;
  const values = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[law-api] 일부 조회 실패:", r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }
  return { values, failed: results.length - values.length };
}

// 목록 응답에서 항목 배열을 꺼낸다 (결과가 1건이면 배열이 아닌 객체로 오는 경우 대비)
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

type PrecListItem = { 판례일련번호: string; 사건명: string; 사건번호: string; 선고일자: string; 법원명: string; 데이터출처명: string };
type ExpcListItem = { 법령해석례일련번호: string; 안건명: string; 안건번호: string; 회신일자: string; 회신기관명: string };

// 판례는 제목에 "국유재산"이 드물어 제목 검색으로는 거의 찾지 못한다.
// 그래서 "법령명 ○○"로 본문을 검색한 뒤, 본문을 열어 참조조문에 그 법령이 있는 판례만 쓴다.
// 기본은 국유재산법이고, 민법 등 함께 보는 법령을 인용한 판례도 같은 방식으로 찾는다.
async function searchPrecedents(
  oc: string,
  lawName: string,
  word: string,
  signal: AbortSignal,
  exclude: Set<string>,
  details: number,
  limit: number,
): Promise<LookupItem[]> {
  const list = await getJson(
    `${BASE}/lawSearch.do?OC=${oc}&target=prec&type=JSON&search=2&display=${PRECEDENT_LIST}&query=${encodeURIComponent(`${lawName} ${word}`)}`,
    signal,
  );
  // 대법원 데이터만 (국세청 판례는 본문을 JSON으로 주지 않는다), 이미 가진 판례는 빼고,
  // 대법원 판결을 앞에 둔다.
  const picked = asArray<PrecListItem>(list?.PrecSearch?.prec)
    .filter((p) => p.데이터출처명 === "대법원" && !exclude.has(p.사건번호))
    .sort((a, b) => Number(b.법원명 === "대법원") - Number(a.법원명 === "대법원"))
    .slice(0, details);
  const wanted = lawName.replace(/\s+/g, "");

  const { values: items } = await settled(
    picked.map(async (p): Promise<LookupItem | null> => {
      const detail = (
        await getJson(`${BASE}/lawService.do?OC=${oc}&target=prec&type=JSON&ID=${p.판례일련번호}`, signal)
      )?.PrecService;
      const holdings = clean(detail?.판시사항);
      const summary = clean(detail?.판결요지);
      // 그 법령을 참조조문으로 인용하지 않은 판례, 판결요지가 비어 있는 판례는 근거로 쓰지 않는다.
      if (!String(detail?.참조조문 ?? "").replace(/\s+/g, "").includes(wanted) || !summary) return null;
      return {
        id: `lookup-prec-${p.판례일련번호}`,
        kind: "판례",
        title: p.사건명,
        number: p.사건번호,
        date: p.선고일자,
        org: p.법원명,
        text: `판시사항: ${holdings}\n판결요지: ${summary}`,
        link: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${p.판례일련번호}`,
      };
    }),
    signal,
  );
  return items.filter((i): i is LookupItem => i !== null).slice(0, limit);
}

async function searchInterpretations(oc: string, word: string, signal: AbortSignal): Promise<LookupItem[]> {
  const list = await getJson(
    `${BASE}/lawSearch.do?OC=${oc}&target=expc&type=JSON&search=1&display=${CANDIDATES}&query=${encodeURIComponent(word)}`,
    signal,
  );
  // 안건명에 "국유재산"이 들어간 것만 (공유재산 등 지방 재산 해석례 제외)
  const picked = asArray<ExpcListItem>(list?.Expc?.expc)
    .filter((e) => e.안건명?.includes("국유재산"))
    .slice(0, MAX_RESULTS);

  const { values: items } = await settled(
    picked.map(async (e): Promise<LookupItem | null> => {
      const detail = (
        await getJson(`${BASE}/lawService.do?OC=${oc}&target=expc&type=JSON&ID=${e.법령해석례일련번호}`, signal)
      )?.ExpcService;
      const question = clean(detail?.질의요지);
      const answer = clean(detail?.회답);
      // 회답이 비어 있는 해석례는 근거로 쓸 수 없으므로 뺀다.
      if (!answer) return null;
      return {
        id: `lookup-expc-${e.법령해석례일련번호}`,
        kind: "법령해석례",
        title: e.안건명,
        number: e.안건번호,
        date: e.회신일자,
        org: e.회신기관명,
        text: `질의요지: ${question}\n회답: ${answer}`,
        link: `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=${e.법령해석례일련번호}`,
      };
    }),
    signal,
  );
  return items.filter((i): i is LookupItem => i !== null);
}

export type LookupResult =
  | { status: "ok"; items: LookupItem[] }
  | { status: "skipped" } // 인증값이 없어 조회하지 않음
  | { status: "failed" }; // 조회 중 오류 (DESIGN.md 2장 "자료 조회 실패")

// 무엇을 조회할지: 판례, 법령해석례(유권해석)
export type LookupTargets = {
  precedents: boolean;
  interpretations: boolean;
  excludeCaseNumbers?: string[]; // 이미 넣어 둔 판례 (중복 조회 방지)
  // 국유재산법 외에 함께 보는 법령(민법 등)을 인용한 판례도 찾는다. word는 그 법령에서 찾을 핵심 낱말.
  extraPrecedentLaws?: { law: string; word: string }[];
};

const EXTRA_PRECEDENT_LAWS = 2; // 국유재산법 외에 판례를 따로 찾아볼 법령 수
const EXTRA_PRECEDENTS_PER_LAW = 2; // 그 법령마다 추가할 판례 수

// 핵심 낱말로 판례·법령해석례를 조회해 최대 3건씩 돌려준다.
export async function lookupLawCenter(
  terms: string[],
  signal: AbortSignal,
  targets: LookupTargets = { precedents: true, interpretations: true },
): Promise<LookupResult> {
  const oc = getOC();
  if (!oc) return { status: "skipped" };

  const [word] = pickCoreWords(terms);
  if (!word) return { status: "ok", items: [] };

  // 판례 조회와 해석례 조회는 서로 영향을 주지 않는다. 한쪽이 실패해도 다른 쪽 결과는 쓴다.
  const exclude = new Set(targets.excludeCaseNumbers ?? []);
  const searches: Promise<LookupItem[]>[] = [];
  if (targets.precedents) {
    searches.push(searchPrecedents(oc, "국유재산법", word, signal, exclude, PRECEDENT_DETAILS, MAX_RESULTS));
    for (const extra of (targets.extraPrecedentLaws ?? []).slice(0, EXTRA_PRECEDENT_LAWS)) {
      if (!extra.word) continue;
      searches.push(
        searchPrecedents(oc, extra.law, extra.word, signal, exclude, EXTRA_PRECEDENT_DETAILS, EXTRA_PRECEDENTS_PER_LAW),
      );
    }
  }
  if (targets.interpretations) searches.push(searchInterpretations(oc, word, signal));
  if (searches.length === 0) return { status: "ok", items: [] };

  const { values, failed } = await settled(searches, signal);
  // 요청한 조회가 모두 실패했을 때만 "조회 실패"로 본다 (DESIGN.md 2장 "자료 조회 실패").
  if (failed === searches.length) return { status: "failed" };

  // 같은 판례가 여러 조회에서 나오면 한 번만 쓴다.
  const seen = new Set<string>();
  const items = values.flat().filter((i) => !seen.has(i.id) && seen.add(i.id));
  return { status: "ok", items };
}

// AI에 넘길 조회 자료 글
export function formatLookup(items: LookupItem[]): string {
  if (items.length === 0) return "";
  return [
    "## 국가법령정보센터 조회 자료",
    items
      .map((i) => `[${i.id}] ${i.kind} ${i.org} ${i.date} ${i.number} — ${i.title}\n${i.text}`)
      .join("\n\n"),
  ].join("\n\n");
}
