"use client";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

export type RequestError = Error & { code?: string };
const errorCopy: Record<string, string> = {
  eligibility_required: "AI 이용 조건을 먼저 확인해 주세요. 페이지를 새로고침하면 확인 안내를 볼 수 있어요.",
  schedule_expired: "종료 시각이 지난 일정이에요. 앞으로의 시각으로 변경하거나 종료 시각을 지워 주세요.",
  ai_usage_exhausted: "무료 AI 사용량을 모두 사용했어요. 사용량 화면에서 다음 초기화 시간을 확인해 주세요.",
  provider_not_configured: "이 AI 모델은 아직 연결되지 않았어요. 연결 화면에서 상태를 확인해 주세요.",
  integration_unconfigured: "연결에 필요한 서버 설정이 아직 준비되지 않았어요.",
  ga4_not_connected: "Google Analytics를 먼저 연결해 주세요.",
  integration_busy: "다른 연결 작업을 처리하고 있어요. 잠시 후 다시 시도해 주세요.",
  unauthenticated: "로그인이 만료됐어요. 다시 로그인해 주세요.",
};
export async function requestJson<T>(path: string, method = "GET", body?: unknown, options: { signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", signal: options.signal, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let payload: { error?: string; code?: string };
  try { payload = await response.json() as typeof payload; } catch { throw new Error("서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요."); }
  if (!response.ok) { const error = new Error(errorCopy[payload.code || ""] || payload.error || "요청을 처리하지 못했어요.") as RequestError; error.code = payload.code; throw error; }
  return payload as T;
}
export function useResource<T>(path: string) {
  const [resource, setResource] = useState<{ path: string; data: T | null; loading: boolean; error: string }>({ path, data: null, loading: true, error: "" });
  const inFlight = useRef<AbortController | null>(null);
  const activePath = useRef<string | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const data = await requestJson<T>(path, "GET", undefined, { signal: controller.signal });
      if (controller.signal.aborted || inFlight.current !== controller || activePath.current !== path) return null;
      setResource({ path, data, loading: false, error: "" });
      return data;
    } catch (error) {
      if (controller.signal.aborted || inFlight.current !== controller || activePath.current !== path) return null;
      setResource(previous => ({ path, data: previous.path === path ? previous.data : null, loading: false, error: error instanceof Error ? error.message : "데이터를 불러오지 못했어요." }));
      return null;
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [path]);

  useEffect(() => {
    activePath.current = path;
    void load();
    return () => { activePath.current = null; inFlight.current?.abort(); inFlight.current = null; };
  }, [path, load]);

  const refresh = useCallback(() => {
    if (activePath.current !== path) return Promise.resolve(null);
    setResource(previous => ({ path, data: previous.path === path ? previous.data : null, loading: true, error: "" }));
    return load();
  }, [path, load]);

  const setData = useCallback((value: SetStateAction<T | null>) => {
    if (activePath.current !== path) return;
    // A completed mutation is newer than any previously started GET.
    inFlight.current?.abort();
    inFlight.current = null;
    setResource(previous => ({ path, data: typeof value === "function" ? (value as (previous: T | null) => T | null)(previous.path === path ? previous.data : null) : value, loading: false, error: "" }));
  }, [path]);

  const isCurrentPath = resource.path === path;
  return { data: isCurrentPath ? resource.data : null, loading: !isCurrentPath || resource.loading, error: isCurrentPath ? resource.error : "", refresh, setData };
}
export function localDateTime(iso: string | null | undefined) { return iso ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "기록 없음"; }
export function modelLabel(id: string) { return ({ "gpt-4.1-mini": "GPT-4.1 mini", "gemini-2.5-flash": "Gemini 2.5 Flash", "gemini-3.8-flash": "Gemini 3.8 Flash", "perplexity/sonar": "Perplexity Sonar", "sonar": "Perplexity Sonar", "demo-gemini": "Gemini 샘플", "demo-perplexity": "Perplexity 샘플" } as Record<string,string>)[id] || id; }
