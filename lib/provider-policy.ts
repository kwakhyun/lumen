import { env } from 'cloudflare:workers';
import { ProductError } from './product-validation';

// A missing or misspelled setting must never enable a billable adapter.
export const freeOnlyMode = () => env.LUMEN_PROVIDER_MODE !== 'paid_enabled';
export function assertProviderAllowed(provider: 'openai' | 'gemini' | 'perplexity') {
  if (freeOnlyMode() && provider !== 'gemini') throw new ProductError(403, '무료 서비스에서는 Gemini만 제공합니다. 유료 API 호출은 차단되어 있습니다.', 'paid_provider_disabled');
}
