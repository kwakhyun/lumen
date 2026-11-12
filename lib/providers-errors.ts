import { ProductError } from './product-validation';

type Provider = 'OpenAI' | 'Gemini' | 'Claude';
// Never log keys, request/response bodies, URLs, user IDs or raw upstream messages.
export function providerFailure(provider: Provider, model: string, startedAt: number, code: string, upstreamStatus?: number) {
  console.warn(JSON.stringify({ event: 'ai_provider_failure', provider, model, code, upstreamStatus: upstreamStatus ?? null, elapsedMs: Math.max(0, Date.now() - startedAt) }));
}

export function providerStatusCode(status: number): string {
  return status === 429 ? 'provider_rate_limited' : status === 401 || status === 403 ? 'provider_access_denied' : status === 404 ? 'provider_model_unavailable' : status === 400 ? 'provider_request_invalid' : status >= 500 ? 'provider_overloaded' : 'provider_error';
}

/** Stored with the failed answer and shown as-is, so these stay in the product language. */
export function providerStatusMessage(provider: Provider, status: number): string {
  if (status === 429) return `${provider}의 요청 한도에 도달해 답변을 받지 못했어요(HTTP ${status}). 잠시 후 다시 수집해 주세요.`;
  if (status >= 500) return `${provider} 서버가 혼잡해 답변을 받지 못했어요(HTTP ${status}). 잠시 후 다시 수집해 주세요.`;
  if (status === 401 || status === 403) return `${provider}가 인증을 거부했어요(HTTP ${status}). 운영자가 API 키와 권한을 확인해야 해요.`;
  if (status === 404) return `${provider}에서 설정된 모델을 찾을 수 없어요(HTTP ${status}). 운영자가 모델 설정을 확인해야 해요.`;
  return `${provider}가 요청을 처리하지 못했어요(HTTP ${status}). 결과는 저장되지 않았어요.`;
}

export async function providerHttpError(response: Response, provider: Provider, model: string, startedAt: number): Promise<never> {
  const status = response.status;
  await response.body?.cancel().catch(() => undefined);
  const code = providerStatusCode(status);
  providerFailure(provider, model, startedAt, code, status);
  throw new ProductError(status === 429 ? 429 : status >= 500 ? 503 : 502, providerStatusMessage(provider, status), code);
}

export function providerNetworkError(error: unknown, provider: Provider, model: string, startedAt: number): never {
  const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
  const code = timeout ? 'provider_timeout' : 'provider_network_error';
  providerFailure(provider, model, startedAt, code);
  throw new ProductError(502, timeout ? `${provider}의 응답이 제한 시간 안에 오지 않았어요. 결과는 저장되지 않았으며 자동으로 다시 요청하지 않아요.` : `${provider}에 연결하지 못했어요. 결과는 저장되지 않았어요.`, code);
}
