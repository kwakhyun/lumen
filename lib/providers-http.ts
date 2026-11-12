import { ProductError } from './product-validation';

/** Bound received bytes before JSON parsing. The request's deadline signal also aborts body reads. */
export async function readProviderJson(response: Response, provider: string): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProductError(502, `${provider}의 응답을 읽을 수 없어요.`, 'invalid_provider_response');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1048576) {
        await reader.cancel();
        throw new ProductError(502, `${provider}의 응답이 지원하는 크기(1 MB)를 넘어 수집하지 않았어요.`, 'provider_response_too_large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ProductError) throw error;
    if (error instanceof Error && /timeout|abort/i.test(error.name)) throw new ProductError(502, `${provider}의 응답이 끝나기 전에 제한 시간이 지났어요. 결과는 저장되지 않았어요.`, 'provider_timeout');
    throw new ProductError(502, `${provider}의 응답이 올바르지 않거나 중간에 끊겼어요.`, 'invalid_provider_response');
  } finally { reader.releaseLock(); }
}
