"use client";
import { useCallback, useEffect, useState } from "react";

export type RequestError = Error & { code?: string };
const errorCopy: Record<string, string> = {
  ai_usage_exhausted: "무료 AI 사용량을 모두 사용했어요. 사용량 화면에서 다음 초기화 시간을 확인해 주세요.",
  provider_not_configured: "이 AI 모델은 아직 연결되지 않았어요. 연결 화면에서 상태를 확인해 주세요.",
  integration_unconfigured: "연결에 필요한 서버 설정이 아직 준비되지 않았어요.",
  ga4_not_connected: "Google Analytics를 먼저 연결해 주세요.",
  integration_busy: "다른 연결 작업을 처리하고 있어요. 잠시 후 다시 시도해 주세요.",
  unauthenticated: "로그인이 만료됐어요. 다시 로그인해 주세요.",
};
export async function requestJson<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let payload: { error?: string; code?: string };
  try { payload = await response.json() as typeof payload; } catch { throw new Error("서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요."); }
  if (!response.ok) { const error = new Error(errorCopy[payload.code || ""] || payload.error || "요청을 처리하지 못했어요.") as RequestError; error.code = payload.code; throw error; }
  return payload as T;
}
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; requestJson<T>(path).then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [path]);
  const refresh = useCallback(async () => { setLoading(true); setError(""); try { const value = await requestJson<T>(path); setData(value); return value; } catch (e) { setError((e as Error).message); return null; } finally { setLoading(false); } }, [path]);
  return { data, loading, error, refresh, setData };
}
export function localDateTime(iso: string | null | undefined) { return iso ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "기록 없음"; }
export function modelLabel(id: string) { return ({ "gpt-4.1-mini": "GPT-4.1 mini", "gemini-3.8-flash": "Gemini 3.8 Flash", "perplexity/sonar": "Perplexity Sonar", "demo-gemini": "Gemini 샘플", "demo-perplexity": "Perplexity 샘플" } as Record<string,string>)[id] || id; }
