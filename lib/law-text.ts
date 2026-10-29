// 관련 법령 조문 실시간 조회 (DESIGN.md 3장 "자료 찾는 방법" 4, PRD 6장)
// 질문에 답하려면 국유재산법 외에 어떤 법령을 함께 봐야 하는지를 AI가 정하고(이름만),
// 서버가 국가법령정보센터에서 그 법령들의 조문을 가져온다. 조문 내용은 항상 공식 원문이므로 지어낸 조문이 들어가지 않는다.
//
// 종합 검토를 위해 이렇게 한다.
// 1) 법률마다 그 시행령을 자동으로 함께 본다. (세부 내용은 시행령에 위임되는 경우가 많다)
// 2) 가져온 조문이 다른 조문·법령을 인용하면("「국세징수법」 제25조", "제73조제2항") 그 조문까지 따라가서 후보에 넣는다.
// 3) 법령별로 조문을 고르게 나눠 담아, 한 법령이 자리를 독차지하지 않게 한다.
// 여기서 돌려주는 것은 "후보"다. 낱말 점수만으로는 관계없는 인용 조문이 섞이므로,
// 질문에 정말 필요한 조문만 고르는 일은 AI가 한다 (lib/search.ts의 selectArticles).
//
// 가져온 법령 원문은 메모리에 잠시 보관한다. 법령 원문만 보관하며, 질문·답변은 저장하지 않는다 (PRD 7장).
import { BASE, asArray, getJson, getOC, settled } from "./law-api";

// AI가 고른 관련 법령 한 건
export type RelatedLawRequest = {
  name: string; // 정식 법령명 (예: 급경사지 재해예방에 관한 법률)
  keywords: string[]; // 그 법에서 찾을 법률 용어
  articles: string[]; // 조문 번호를 확실히 아는 경우만 (예: 제162조)
};

// 이미 AI에 넘기기로 한 조문 (data 폴더). 다시 가져오지 않고, 그 안의 인용을 따라가는 데 쓴다.
export type KnownArticle = { law: string; article: string; text: string };

// 조회로 찾은 조문 한 건
export type LawArticle = {
  id: string;
  law: string; // 법령명
  article: string; // 제162조, 제73조의3
  title: string;
  text: string; // 제목과 항·호를 포함한 본문
  effectiveDate: string; // 2026. 3. 17.
  link: string;
  via?: string; // 다른 조문에서 인용되어 따라온 경우: "국유재산법 제73조"
};

export type LawLookupResult =
  | { status: "ok"; articles: LawArticle[]; laws: string[]; notFound: string[] }
  | { status: "skipped" } // 인증값이 없어 조회하지 않음
  | { status: "failed" }; // 조회 중 오류

const MAX_LAWS = 6; // AI가 고르는 법령 수 (시행령은 따로 자동으로 붙는다)
const MAX_ARTICLES_PER_LAW = 8; // 법령마다 후보로 올릴 조문 수
const MAX_ARTICLES = 40; // 이름을 대서 고른 후보 조문의 전체 상한
const MAX_REF_ARTICLES = 16; // 인용을 따라가서 후보에 더하는 조문의 상한
const MAX_REF_PER_LAW = 6;
const MAX_REF_LAWS = 5; // 인용을 따라갈 때 새로 열어 볼 법령 수
const MAX_EXTERNAL_LAWS_PER_ARTICLE = 3; // 한 조문이 다른 법령을 이 개수보다 많이 인용하면 "나열형 조문"으로 본다
const MAX_TEXT_LENGTH = 1000; // 조문 하나의 최대 글자 수 (너무 긴 조문은 잘라서 AI에 넘긴다)
const MIN_SCORE = 3; // 이 점수 미만은 관련 없는 조문으로 본다
const SMALL_LAW_ARTICLES = 12; // 조문이 이 개수 이하인 법은 점수와 상관없이 후보로 삼는다

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
const MISS_TTL_MS = 10 * 60 * 1000; // 찾지 못한 이름은 10분만 기억
const MAX_CACHED_LAWS = 16; // 메모리 사용을 제한한다 (민법 하나가 약 0.7MB)

// ---------- 법령 이름 → 법령 일련번호 ----------

type ResolvedLaw = { mst: string; name: string; effectiveDate: string };
type LawSearchItem = {
  법령일련번호: string;
  법령명한글: string;
  법령약칭명?: string;
  현행연혁코드?: string;
  시행일자: string;
};

const resolveCache = new Map<string, { at: number; value: ResolvedLaw | null }>();

const norm = (text: string) => text.replace(/\s+/g, "").toLowerCase();
const isDecree = (name: string) => /(시행령|시행규칙)$/.test(name.trim());
const parentLawName = (name: string) => name.replace(/\s*(시행령|시행규칙)$/, "").trim();

// 20260317 → "2026. 3. 17."
function formatDate(yyyymmdd: string | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd ?? "");
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : "";
}

// 법령명(또는 약칭)이 정확히 같은 현행 법령만 쓴다. ("민법"을 검색하면 "난민법"이 먼저 나오기 때문)
async function resolveLaw(oc: string, name: string, signal: AbortSignal): Promise<ResolvedLaw | null> {
  const key = norm(name);
  const cached = resolveCache.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? CACHE_TTL_MS : MISS_TTL_MS)) return cached.value;

  const data = await getJson(
    `${BASE}/lawSearch.do?OC=${oc}&target=law&type=JSON&display=20&query=${encodeURIComponent(name)}`,
    signal,
  );
  const hit = asArray<LawSearchItem>(data?.LawSearch?.law).find(
    (l) =>
      (!l.현행연혁코드 || l.현행연혁코드 === "현행") &&
      (norm(l.법령명한글) === key || (l.법령약칭명 && norm(l.법령약칭명) === key)),
  );
  const value = hit
    ? { mst: hit.법령일련번호, name: hit.법령명한글, effectiveDate: formatDate(hit.시행일자) }
    : null;
  resolveCache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- 법령 일련번호 → 조문 목록 ----------

type ParsedArticle = { no: string; title: string; text: string; effectiveDate: string };
const lawCache = new Map<string, { at: number; articles: ParsedArticle[] }>();

type Raw = Record<string, unknown>;

// 글자 또는 글자 배열을 한 덩어리 글로 합친다 (API가 줄마다 배열로 줄 때가 있다)
function flat(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(flat).filter(Boolean).join("\n");
  return "";
}

// 항·호·목을 줄 단위 글로 풀어 쓴다.
function paragraphs(unit: Raw): string[] {
  const lines: string[] = [];
  for (const hang of asArray<Raw>(unit["항"] as Raw | Raw[] | undefined)) {
    const content = flat(hang["항내용"]);
    if (content) lines.push(content);
    for (const ho of asArray<Raw>(hang["호"] as Raw | Raw[] | undefined)) {
      const hoContent = flat(ho["호내용"]);
      if (hoContent) lines.push(`  ${hoContent}`);
      for (const mok of asArray<Raw>(ho["목"] as Raw | Raw[] | undefined)) {
        const mokContent = flat(mok["목내용"]);
        if (mokContent) lines.push(`    ${mokContent}`);
      }
    }
  }
  return lines;
}

function parseArticles(response: unknown): ParsedArticle[] {
  const law = (response as Raw | null)?.["법령"] as Raw | undefined;
  const units = asArray<Raw>((law?.["조문"] as Raw | undefined)?.["조문단위"] as Raw | Raw[] | undefined);
  const lawDate = formatDate(String((law?.["기본정보"] as Raw | undefined)?.["시행일자"] ?? ""));

  const result: ParsedArticle[] = [];
  for (const unit of units) {
    if (unit["조문여부"] === "전문") continue; // 장·절 제목
    const heading = flat(unit["조문내용"]).replace(/\s+/g, " ");
    const m = /^(제\d+조(?:의\d+)?)\s*(?:\(([^)]*)\))?/.exec(heading);
    if (!m) continue;

    const text = [heading, ...paragraphs(unit)].join("\n");
    // "삭제"된 조문은 내용이 없으므로 쓰지 않는다.
    if (/^제\d+조(?:의\d+)?\s*삭제/.test(heading) || text.length < 15) continue;

    result.push({
      no: m[1],
      title: m[2] ?? "",
      text: text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…(이하 생략)` : text,
      effectiveDate: formatDate(String(unit["조문시행일자"] ?? "")) || lawDate,
    });
  }
  return result;
}

async function loadArticles(oc: string, mst: string, signal: AbortSignal): Promise<ParsedArticle[]> {
  const cached = lawCache.get(mst);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.articles;

  const body = await getJson(`${BASE}/lawService.do?OC=${oc}&target=law&type=JSON&MST=${mst}`, signal);
  const articles = parseArticles(body);

  // 오래된 것부터 지워 보관량을 제한한다.
  if (lawCache.size >= MAX_CACHED_LAWS) {
    const oldest = [...lawCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) lawCache.delete(oldest[0]);
  }
  lawCache.set(mst, { at: Date.now(), articles });
  return articles;
}

// ---------- 조문 고르기 ----------

// 조문 번호 표기를 맞춘다. ("제 73조의 3", "73조의3" → "제73조의3")
function normalizeArticleNo(text: string): string {
  const m = /(\d+)\s*조\s*(?:의\s*(\d+))?/.exec(text);
  return m ? `제${m[1]}조${m[2] ? `의${m[2]}` : ""}` : "";
}

// 본문에 낱말이 몇 번 나오는지 (최대 3번까지만 센다)
function countUpTo3(text: string, word: string): number {
  let count = 0;
  for (let i = text.indexOf(word); i >= 0 && count < 3; i = text.indexOf(word, i + word.length)) count++;
  return count;
}

// 점수:
// - 조문 번호를 정확히 짚었으면 10점
// - 핵심 낱말이 제목에 있으면 3점, 본문에 있으면 나온 횟수만큼(최대 3점)
// - "정의" 조문은 핵심 낱말이 본문에 있으면 4점 추가 (낱말의 뜻을 정하는 조문이라 답변에 꼭 필요한 경우가 많다)
// 법령 이름에 들어 있는 낱말(예: 급경사지 재해예방에 관한 법률의 "급경사지")은 거의 모든 조문에 나와
// 구분에 도움이 안 되므로 점수에서 뺀다.
function pickArticles(
  articles: ParsedArticle[],
  keywords: string[],
  articleNos: string[],
  lawName: string,
  skip: (a: ParsedArticle) => boolean,
): ParsedArticle[] {
  const wanted = new Set(articleNos.map(normalizeArticleNo).filter(Boolean));
  const nameNorm = norm(lawName);
  const words = keywords.map(norm).filter((w) => w.length >= 2 && !nameNorm.includes(w));

  return articles
    .filter((a) => !skip(a))
    .map((a) => {
      let score = wanted.has(a.no) ? 10 : 0;
      const title = norm(a.title);
      const text = norm(a.text);
      let textHits = 0;
      for (const w of words) {
        if (title.includes(w)) score += 3;
        const n = countUpTo3(text, w);
        if (!title.includes(w)) score += n;
        if (n > 0) textHits++;
      }
      if (title === "정의" && textHits > 0) score += 4;
      return { a, score };
    })
    // 조문이 12개 이하인 작은 법은 대부분의 조문이 서로 이어져 있으므로 점수와 상관없이 후보로 삼는다.
    .filter((r) => r.score >= (articles.length <= SMALL_LAW_ARTICLES ? 0 : MIN_SCORE))
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_ARTICLES_PER_LAW)
    .map((r) => r.a);
}

// 법령마다 순위가 높은 조문부터 한 개씩 번갈아 담는다. (한 법령이 자리를 독차지하지 않게)
function roundRobin<T>(groups: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let rank = 0; out.length < limit; rank++) {
    let added = false;
    for (const group of groups) {
      if (rank < group.length && out.length < limit) {
        out.push(group[rank]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

// ---------- 조문 속 인용 따라가기 ----------

type Ref = { law: string; no: string; external: boolean; from: string };

// 조문 본문에서 다른 조문 인용을 찾는다.
// - 「국세징수법」 제25조  → 다른 법령의 조문
// - 제73조제2항           → 같은 법령의 조문
// - (시행령에서) 법 제72조 → 그 시행령의 법률 조문
// "같은 법 제N조", "이 법 제N조"처럼 무엇을 가리키는지 글만으로 알 수 없는 것은 따라가지 않는다.
function findRefs(source: KnownArticle): Ref[] {
  const refs: Ref[] = [];
  const from = `${source.law} ${source.article}`;
  const own = normalizeArticleNo(source.article);
  const articleNo = (n: string, sub?: string) => `제${n}조${sub ? `의${sub}` : ""}`;

  // 1) 다른 법령의 조문. 찾은 부분은 지워서, 아래 "같은 법령" 찾기에서 중복으로 잡히지 않게 한다.
  const rest = source.text.replace(
    /「([^」]{2,60})」\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g,
    (_m, name: string, n: string, sub?: string) => {
      refs.push({ law: name.trim(), no: articleNo(n, sub), external: true, from });
      return " ";
    },
  );

  // 2) 같은 법령의 조문, 그리고 시행령 속 "법 제N조"
  const decree = isDecree(source.law);
  for (const m of rest.matchAll(/(법\s*)?제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)) {
    const no = articleNo(m[2], m[3]);
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 4), m.index ?? 0);
    if (/(같은|이|영)\s*$/.test(before)) continue; // 무엇을 가리키는지 알 수 없다
    if (m[1]) {
      if (decree) refs.push({ law: parentLawName(source.law), no, external: true, from });
      continue;
    }
    if (no !== own) refs.push({ law: source.law, no, external: false, from });
  }
  // 다른 법령을 줄줄이 나열한 조문(예: 용어의 뜻을 정하면서 여러 법령을 인용하는 "정의" 조문)은
  // 하나하나가 질문과 관련 있는 경우가 드물어, 다른 법령으로의 인용은 따라가지 않는다. (같은 법령 안의 인용은 따라간다)
  const externalLaws = new Set(refs.filter((r) => r.external).map((r) => norm(r.law)));
  return externalLaws.size > MAX_EXTERNAL_LAWS_PER_ARTICLE ? refs.filter((r) => !r.external) : refs;
}

// ---------- 바깥에서 쓰는 함수 ----------

// 이미 data 폴더에 있는 조문을 다시 가져오지 않기 위한 표시: "법령명|제72조"
export const articleKey = (law: string, article: string) => `${norm(law)}|${article}`;

type Target = RelatedLawRequest & { optional?: boolean };
type FirstWave = { requested: string; optional: boolean; law: ResolvedLaw | null; picked: ParsedArticle[] };

function toLawArticle(law: ResolvedLaw, a: ParsedArticle, via?: string): LawArticle {
  return {
    id: `lookup-law-${law.mst}-${a.no}`,
    law: law.name,
    article: a.no,
    title: a.title,
    text: a.text,
    effectiveDate: a.effectiveDate || law.effectiveDate,
    link: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${law.mst}`,
    ...(via ? { via } : {}),
  };
}

export async function lookupRelatedLaws(
  requests: RelatedLawRequest[],
  signal: AbortSignal,
  known: KnownArticle[] = [],
): Promise<LawLookupResult> {
  const oc = getOC();
  if (!oc) return { status: "skipped" };

  // 같은 법을 두 번 요청한 경우 하나로 합치고, 최대 MAX_LAWS개만 본다.
  const unique = new Map<string, Target>();
  for (const r of requests) {
    const key = norm(r.name);
    if (key && !unique.has(key)) unique.set(key, r);
  }
  const named = [...unique.values()].slice(0, MAX_LAWS);
  if (named.length === 0) return { status: "ok", articles: [], laws: [], notFound: [] };

  // 법률마다 그 시행령을 자동으로 함께 본다. 시행령이 없으면 조용히 건너뛴다.
  const targets: Target[] = [...named];
  for (const r of named) {
    if (isDecree(r.name)) continue;
    const decreeName = `${r.name.trim()} 시행령`;
    if (!unique.has(norm(decreeName))) {
      unique.set(norm(decreeName), { name: decreeName, keywords: r.keywords, articles: [] });
      targets.push({ name: decreeName, keywords: r.keywords, articles: [], optional: true });
    }
  }

  const skip = new Set(known.map((k) => articleKey(k.law, k.article)));
  const taken = new Set<string>(); // 이번에 담은 조문 (중복 방지)

  // ----- 1차: 이름을 댄 법령에서 조문 고르기 -----
  const { values: first, failed } = await settled(
    targets.map(async (t): Promise<FirstWave> => {
      try {
        const law = await resolveLaw(oc, t.name, signal);
        if (!law) return { requested: t.name, optional: !!t.optional, law: null, picked: [] };
        const parsed = await loadArticles(oc, law.mst, signal);
        const picked = pickArticles(parsed, t.keywords, t.articles, law.name, (a) =>
          skip.has(articleKey(law.name, a.no)),
        );
        return { requested: t.name, optional: !!t.optional, law, picked };
      } catch (error) {
        // 자동으로 붙인 시행령의 조회 실패는 전체 실패로 보지 않는다.
        if (t.optional && !signal.aborted) return { requested: t.name, optional: true, law: null, picked: [] };
        throw error;
      }
    }),
    signal,
  );

  // 이름을 댄 법령이 모두 실패했을 때만 "조회 실패"로 본다.
  if (failed > 0 && first.filter((f) => !f.optional).length === 0) return { status: "failed" };

  const groups = first.map((f) =>
    f.law ? f.picked.map((a) => toLawArticle(f.law!, a)) : ([] as LawArticle[]),
  );
  const articles = roundRobin(groups, MAX_ARTICLES);
  for (const a of articles) taken.add(articleKey(a.law, a.article));

  // ----- 2차: 담은 조문과 data 폴더 조문이 인용하는 조문 따라가기 -----
  const sources: KnownArticle[] = [
    ...known,
    ...articles.map((a) => ({ law: a.law, article: a.article, text: a.text })),
  ];
  const refMap = new Map<string, Ref>();
  for (const s of sources) {
    for (const ref of findRefs(s)) {
      const key = articleKey(ref.law, ref.no);
      if (!skip.has(key) && !taken.has(key) && !refMap.has(key)) refMap.set(key, ref);
    }
  }
  // 다른 법령의 인용을 먼저, 그 안에서는 먼저 나온 순서대로. 법령마다 상한을 둔다.
  const byLaw = new Map<string, Ref[]>();
  for (const ref of [...refMap.values()].sort((a, b) => Number(b.external) - Number(a.external))) {
    const list = byLaw.get(norm(ref.law)) ?? [];
    if (list.length < MAX_REF_PER_LAW) byLaw.set(norm(ref.law), [...list, ref]);
  }
  const refLaws = [...byLaw.values()].slice(0, MAX_REF_LAWS);

  const { values: followed } = await settled(
    refLaws.map(async (refs) => {
      const law = await resolveLaw(oc, refs[0].law, signal);
      if (!law) return [] as LawArticle[];
      const parsed = await loadArticles(oc, law.mst, signal);
      return refs.flatMap((ref) => {
        const a = parsed.find((p) => p.no === ref.no);
        return a ? [toLawArticle(law, a, `${ref.from}에서 인용`)] : [];
      });
    }),
    signal,
  );
  const followedArticles = followed.flat().slice(0, MAX_REF_ARTICLES);

  const all = [...articles, ...followedArticles];
  return {
    status: "ok",
    articles: all,
    laws: [...new Set(all.map((a) => a.law))],
    notFound: first.filter((f) => !f.law && !f.optional).map((f) => f.requested),
  };
}

// AI에 넘길 관련 법령 조문 글
export function formatLawArticles(articles: LawArticle[]): string {
  if (articles.length === 0) return "";
  return [
    "## 관련 법령 조문 (국가법령정보센터 실시간 조회)",
    articles
      .map(
        (a) =>
          `[${a.id}] ${a.law} ${a.article}${a.title ? `(${a.title})` : ""} — 시행 ${a.effectiveDate}` +
          `${a.via ? ` (${a.via}된 조문)` : ""}\n${a.text}`,
      )
      .join("\n\n"),
  ].join("\n\n");
}
