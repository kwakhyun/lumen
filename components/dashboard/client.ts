"use client";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

export type RequestError = Error & { code?: string };
const errorCopy: Record<string, string> = {
  eligibility_required: "AI 이용 조건을 먼저 확인해 주세요. 페이지를 새로고침하면 확인 안내를 볼 수 있어요.",
  schedule_expired: "종료 시각이 지난 일정이에요. 종료 시각을 현재보다 나중으로 바꾸거나 삭제해 주세요.",
  ai_usage_exhausted: "무료 AI 사용 한도에 도달했어요. 사용량 화면에서 한도가 초기화되는 시간을 확인하세요.",
  provider_not_configured: "이 AI 모델은 아직 연결되지 않았어요. 연결 관리에서 상태를 확인하세요.",
  integration_unconfigured: "연결에 필요한 서버 설정이 아직 준비되지 않았어요.",
  ga4_not_connected: "Google Analytics를 먼저 연결해 주세요.",
  integration_busy: "다른 연결 작업을 처리하고 있어요. 잠시 후 다시 시도해 주세요.",
  unauthenticated: "로그인이 필요해요. 로그인한 뒤 다시 시도하세요.",
  provider_unavailable: "현재 이 AI 모델을 사용할 수 없어요. 연결 관리에서 사용 가능한 모델을 확인하세요.",
  paid_provider_disabled: "현재 무료 서비스에서는 Gemini만 사용할 수 있어요. 유료 AI 모델의 호출은 차단돼요.",
  provider_network_error: "AI 제공자와 연결하지 못했거나 응답 시간이 초과됐어요. 이 답변은 수집되지 않았어요.",
  provider_error: "AI 제공자가 요청을 처리하지 못했어요. 연결 상태와 사용 한도를 확인하세요.",
  invalid_provider_response: "AI 제공자의 응답을 읽을 수 없어 결과를 저장하지 못했어요.",
  incomplete_provider_response: "AI 답변이 끝까지 생성되지 않았어요. 불완전한 답변은 지표에 포함하지 않아요.",
  empty_provider_response: "AI 제공자가 답변 내용을 보내지 않았어요. 이 답변은 수집되지 않았어요.",
  provider_response_too_large: "AI 응답이 지원하는 크기를 넘어 수집하지 못했어요.",
  unexpected_provider_model: "요청한 모델과 다른 모델의 응답이 와서 수집하지 않았어요.",
  unexpected_grounding_response: "일반 응답으로 요청했지만 검색 기반 답변이 와서 저장하지 않았어요.",
  demo_integration_unavailable: "샘플 워크스페이스에는 GA4를 연결할 수 없어요. 실제 워크스페이스를 선택하세요.",
  oauth_state_invalid: "연결 요청이 만료됐거나 유효하지 않아요. 연결 관리에서 Google 연결을 다시 시작하세요.",
  oauth_denied: "Google 접근 권한 승인이 완료되지 않았어요. 연결하려면 Google 동의 화면에서 권한을 승인하세요.",
  oauth_scope_missing: "GA4 읽기 권한이나 연결 유지에 필요한 정보를 받지 못했어요. Google 연결을 다시 진행하세요.",
  oauth_revoked: "Google 연결 권한이 만료됐거나 철회됐어요. 연결 관리에서 다시 연결하세요.",
  integration_changed: "처리 중에 연결 정보가 변경됐어요. 새로고침한 뒤 연결 상태를 확인하세요.",
  integration_credentials_invalid: "저장된 연결 정보를 읽을 수 없어요. 연결 관리에서 Google을 다시 연결하세요.",
  integration_network_error: "Google 서비스에 연결하지 못했어요. 잠시 후 다시 시도하세요.",
  integration_unauthorized: "Google이 연결 인증을 확인하지 못했어요. 연결 관리에서 Google을 다시 연결하세요.",
  integration_forbidden: "Google이 데이터 접근을 허용하지 않았어요. 계정의 GA4 접근 권한을 확인하세요. 권한이 있다면 운영자에게 문의하세요.",
  integration_rate_limited: "Google 서비스의 요청 한도에 도달했어요. 잠시 후 다시 시도하세요.",
  integration_upstream_error: "Google 서비스가 요청을 정상적으로 처리하지 못했어요. 잠시 후 다시 시도하세요.",
  integration_response_invalid: "Google이 보낸 데이터 형식을 확인할 수 없어 요청을 완료하지 못했어요.",
  payload_too_large: "연결된 서비스에서 받은 데이터가 지원하는 크기를 넘었어요. 조회 기간을 줄이거나 운영자에게 문의하세요.",
  ga4_property_required: "먼저 연결 관리에서 GA4 속성을 선택하세요.",
  ga4_property_unavailable: "선택한 GA4 속성을 사용할 수 없어요. 연결 관리에서 사용 가능한 속성을 다시 선택하세요.",
  ga4_report_changed: "가져오는 중에 GA4 데이터나 보고서 시간대가 바뀌었어요. 보고서를 다시 가져오세요.",
  ga4_report_too_large: "GA4 보고서가 지원하는 크기를 넘었어요. 더 짧은 기간을 선택하세요. 기존 보고서는 유지돼요.",
  backup_incomplete: "전체 데이터를 확인하지 못해 백업 파일을 만들지 않았어요. 잠시 후 다시 시도하고, 문제가 계속되면 운영자에게 문의하세요.",
  backup_too_large: "데이터가 백업 한도를 넘어 파일을 만들지 못했어요. 운영자에게 문의하세요.",
  backup_invalid: "백업 데이터가 잘못됐거나 일부가 빠져 있어요. 운영자에게 문의하세요.",
  backup_schema_unsupported: "현재 지원하지 않는 백업 형식이에요. 운영자에게 문의하세요.",
  not_found: "요청한 항목을 찾을 수 없어요. 현재 워크스페이스와 목록을 확인하세요.",
  invalid_input: "입력한 내용을 확인하세요. 필수 항목이 빠졌거나 형식이 맞지 않아요.",
  invalid_origin: "Lumen 화면에서 다시 시도하세요. 현재 요청을 보낸 위치를 확인할 수 없어요.",
  invalid_content_type: "요청 형식이 올바르지 않아요. 페이지를 새로고침한 뒤 다시 시도하세요.",
  invalid_json: "전송된 내용을 읽을 수 없어요. 페이지를 새로고침한 뒤 다시 시도하세요.",
  body_too_large: "전송할 내용이 너무 많아요. 내용을 줄이거나 나누어 등록하세요.",
  duplicate: "같은 항목이 이미 등록돼 있어요. 목록을 확인하세요.",
  record_limit: "이 항목의 등록 한도에 도달했어요. 사용하지 않는 항목을 삭제한 뒤 추가하세요.",
  workspace_limit: "워크스페이스는 최대 20개까지 만들 수 있어요.",
  quota_exceeded: "이번 요청이 사용 한도를 넘었어요. 요청량을 줄이거나 한도가 초기화된 뒤 다시 시도하세요.",
  database_unavailable: "현재 저장된 데이터에 접근할 수 없어요. 잠시 후 다시 시도하고, 문제가 계속되면 운영자에게 문의하세요.",
  internal_error: "요청을 완료하지 못했어요. 잠시 후 다시 시도하세요.",
  invalid_competitor: "우리 브랜드의 도메인은 경쟁사로 추가할 수 없어요. 다른 도메인을 입력하세요.",
  mode_mismatch: "실제 데이터와 샘플 데이터는 별도 워크스페이스에서 사용해야 해요. 현재 워크스페이스를 확인하세요.",
  invalid_model: "지원하지 않는 샘플 모델이에요. 모델을 다시 선택하세요.",
  invalid_prompt: "현재 워크스페이스에서 추적 중인 질문만 선택하세요.",
  run_size: "한 번에 수집할 질문은 1개에서 20개까지 선택할 수 있어요.",
  run_in_progress: "아직 끝나지 않은 수집이 있어요. 진행 중인 수집을 먼저 완료하세요.",
  run_locked: "이미 이 수집을 처리하고 있어요. 잠시 후 진행 상태를 확인하세요.",
  run_lease_changed: "수집 처리 상태가 바뀌었어요. 새로고침해 현재 상태를 확인하세요.",
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
