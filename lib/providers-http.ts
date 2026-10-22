import { ProductError } from './product-validation';

/** Bound received bytes before JSON parsing. Fetch's 45-second signal also aborts body reads. */
export async function readProviderJson(response: Response, provider: string): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProductError(502, `${provider} returned an invalid response.`, 'invalid_provider_response');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1048576) {
        await reader.cancel();
        throw new ProductError(502, `${provider} returned a response larger than the supported 1 MB limit. This answer was not collected.`, 'provider_response_too_large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ProductError) throw error;
    throw new ProductError(502, `${provider} returned an invalid or interrupted response.`, 'invalid_provider_response');
  } finally { reader.releaseLock(); }
}
