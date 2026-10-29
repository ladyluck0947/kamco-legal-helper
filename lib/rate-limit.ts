// 호출 횟수 제한 (CHECK.md 보안 1번: 로그인 없는 공개 API로 OpenAI 요금이 새는 것을 막는다)
// 같은 접속 주소(IP)에서 짧은 시간에 너무 많이 질문하면 막는다.
// 서버 메모리에 세므로 Vercel이 서버를 여러 개 띄우면 서버마다 따로 센다. 그래서 이것은 1차 방어이고,
// 확실한 제한은 Vercel 방화벽(Firewall)의 횟수 제한 규칙과 OpenAI 월 사용 한도가 맡는다.

const WINDOWS = [
  { ms: 60_000, max: 5 }, // 1분에 5번
  { ms: 3_600_000, max: 40 }, // 1시간에 40번
];
const MAX_TRACKED = 5_000; // 기억해 두는 접속 주소 수의 상한 (메모리가 끝없이 커지지 않게)

const hits = new Map<string, number[]>();

// 이 접속 주소의 이번 요청을 세고, 허용되면 true를 돌려준다.
export function allowRequest(key: string, now = Date.now()): boolean {
  const longest = WINDOWS[WINDOWS.length - 1].ms;
  const times = (hits.get(key) ?? []).filter((t) => now - t < longest);

  const blocked = WINDOWS.some((w) => times.filter((t) => now - t < w.ms).length >= w.max);
  if (blocked) {
    hits.set(key, times);
    return false;
  }

  times.push(now);
  hits.set(key, times);

  // 너무 많이 쌓이면 가장 오래된 주소부터 잊는다.
  if (hits.size > MAX_TRACKED) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return true;
}

// 요청 헤더에서 접속 주소를 읽는다. Vercel은 x-forwarded-for를 직접 채워 준다.
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
