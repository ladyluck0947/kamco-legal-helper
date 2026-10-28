// 국가법령정보센터 조회 (PLAN 12번, DESIGN.md 3장 "자료 찾는 방법" 4)
// 넣어 둔 자료(data 폴더)가 부족할 때, 국가법령정보센터 Open API로 판례·법령해석례(유권해석)를 찾아 보완한다.
// API 안내: https://open.law.go.kr (판례 target=prec, 법령해석례 target=expc)
//
// 인증값(OC)은 .env의 LAW_API_OC에서 읽는다.
// 개발 중(npm run dev)에 LAW_API_OC가 없으면, API 안내 문서에 공개된 시험용 값("test")으로 동작을 확인한다.
// 배포(Vercel)에서는 반드시 직접 신청한 인증값을 LAW_API_OC로 넣어야 하며, 없으면 조회를 건너뛴다.

const BASE = "https://www.law.go.kr/DRF";
const MAX_RESULTS = 3; // DESIGN.md: 결과 중 상위 3건을 추가
const CANDIDATES = 20; // 목록에서 먼저 받아 볼 개수

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

function getOC(): string | null {
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

async function getJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`국가법령정보센터 응답 오류 ${response.status}`);
  return response.json();
}

// 목록 응답에서 항목 배열을 꺼낸다 (결과가 1건이면 배열이 아닌 객체로 오는 경우 대비)
function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

type PrecListItem = { 판례일련번호: string; 사건명: string; 사건번호: string; 선고일자: string; 법원명: string };
type ExpcListItem = { 법령해석례일련번호: string; 안건명: string; 안건번호: string; 회신일자: string; 회신기관명: string };

async function searchPrecedents(oc: string, word: string, signal: AbortSignal): Promise<LookupItem[]> {
  const list = await getJson(
    `${BASE}/lawSearch.do?OC=${oc}&target=prec&type=JSON&search=1&display=${CANDIDATES}&query=${encodeURIComponent(word)}`,
    signal,
  );
  // 사건명에 "국유재산"이 들어간 것만, 대법원 판례를 앞에 둔다.
  const picked = asArray<PrecListItem>(list?.PrecSearch?.prec)
    .filter((p) => p.사건명?.includes("국유재산"))
    .sort((a, b) => Number(b.법원명 === "대법원") - Number(a.법원명 === "대법원"))
    .slice(0, MAX_RESULTS);

  const items = await Promise.all(
    picked.map(async (p): Promise<LookupItem | null> => {
      const detail = (
        await getJson(`${BASE}/lawService.do?OC=${oc}&target=prec&type=JSON&ID=${p.판례일련번호}`, signal)
      )?.PrecService;
      const holdings = clean(detail?.판시사항);
      const summary = clean(detail?.판결요지);
      // 판시사항·판결요지가 모두 비어 있는 판례(주로 하급심)는 근거로 쓸 수 없으므로 뺀다.
      if (!holdings && !summary) return null;
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
  );
  return items.filter((i): i is LookupItem => i !== null);
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

  const items = await Promise.all(
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
  );
  return items.filter((i): i is LookupItem => i !== null);
}

export type LookupResult =
  | { status: "ok"; items: LookupItem[] }
  | { status: "skipped" } // 인증값이 없어 조회하지 않음
  | { status: "failed" }; // 조회 중 오류 (DESIGN.md 2장 "자료 조회 실패")

// 핵심 낱말로 판례·법령해석례를 함께 조회해 최대 3건씩 돌려준다.
export async function lookupLawCenter(terms: string[], signal: AbortSignal): Promise<LookupResult> {
  const oc = getOC();
  if (!oc) return { status: "skipped" };

  const [word] = pickCoreWords(terms);
  if (!word) return { status: "ok", items: [] };

  try {
    const [precedents, interpretations] = await Promise.all([
      searchPrecedents(oc, word, signal),
      searchInterpretations(oc, word, signal),
    ]);
    return { status: "ok", items: [...precedents, ...interpretations] };
  } catch (error) {
    // 30초 시간 초과는 위로 넘겨 전체 요청을 멈추게 한다.
    if (signal.aborted) throw error;
    console.error("[law-api] 국가법령정보센터 조회 실패:", error instanceof Error ? error.message : error);
    return { status: "failed" };
  }
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
