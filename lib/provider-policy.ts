import { env } from '@/lib/runtime-env';
import { ProductError } from './product-validation';

// A missing or misspelled setting must never enable a billable adapter.
export const freeOnlyMode = () => env.LUMEN_PROVIDER_MODE !== 'paid_enabled';
export type ProviderId = 'openai' | 'gemini' | 'perplexity' | 'anthropic';
export function assertProviderAllowed(provider: ProviderId) {
  if (freeOnlyMode() && provider !== 'gemini') throw new ProductError(403, '무료 서비스에서는 Gemini만 제공해요. 유료 API 호출은 차단되어 있어요.', 'paid_provider_disabled');
}
