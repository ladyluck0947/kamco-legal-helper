// AI 서비스 공통 설정
import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

// 사용할 AI 모델. 응답 속도(30초 제한)와 품질을 함께 고려해 고른 기본값이다.
export const AI_MODEL = "gpt-5.4-mini";

// 이 앱의 모든 AI 요청은 이 함수 하나로 보낸다.
// 모델과 "저장 안 함(store: false)"을 여기서 고정해, 요청을 새로 만들 때 빠뜨리는 일이 없게 한다.
// PRD 7장: 질문·답변을 OpenAI 쪽에도 저장하지 않는다.
export function askAI(
  client: OpenAI,
  params: Omit<ResponseCreateParamsNonStreaming, "model" | "store">,
  signal: AbortSignal,
) {
  return client.responses.create({ ...params, model: AI_MODEL, store: false }, { signal });
}
