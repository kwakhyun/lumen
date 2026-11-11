import { ProductError } from './product-validation';

type Provider = 'OpenAI' | 'Gemini';
// Never log keys, request/response bodies, URLs, user IDs or raw upstream messages.
function failure(provider: Provider, model: string, startedAt: number, code: string, upstreamStatus?: number) {
  console.warn(JSON.stringify({ event: 'ai_provider_failure', provider, model, code, upstreamStatus: upstreamStatus ?? null, elapsedMs: Math.max(0, Date.now() - startedAt) }));
}

export async function providerHttpError(response: Response, provider: Provider, model: string, startedAt: number): Promise<never> {
  const status = response.status;
  await response.body?.cancel().catch(() => undefined);
  const code = status === 429 ? 'provider_rate_limited' : status === 401 || status === 403 ? 'provider_access_denied' : status === 404 ? 'provider_model_unavailable' : status === 400 ? 'provider_request_invalid' : status >= 500 ? 'provider_overloaded' : 'provider_error';
  failure(provider, model, startedAt, code, status);
  throw new ProductError(status === 429 ? 429 : status >= 500 ? 503 : 502, `${provider} rejected the request (HTTP ${status}). No generated result was saved.`, code);
}

export function providerNetworkError(error: unknown, provider: Provider, model: string, startedAt: number): never {
  const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
  const code = timeout ? 'provider_timeout' : 'provider_network_error';
  failure(provider, model, startedAt, code);
  throw new ProductError(502, timeout ? `${provider} request timed out. No generated result was saved.` : `${provider} could not be reached. No generated result was saved.`, code);
}
