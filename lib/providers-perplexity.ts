import { env } from 'cloudflare:workers';
import type { ProviderResult } from './providers';
import type { Citation } from './product-types';
import { ProductError } from './product-validation';
import { readProviderJson } from './providers-http';
import { safeHttpUrl } from './metrics';
import { assertProviderAllowed } from './provider-policy';

// Verified 2026-10-18: https://docs.perplexity.ai/docs/agent-api/models
// https://docs.perplexity.ai/api-reference/agent-post
// https://docs.perplexity.ai/docs/agent-api/tools/web-search
// The old Sonar Chat Completions API is superseded; pin the actual Agent model, not a changing preset.
export const PERPLEXITY_MODEL = 'perplexity/sonar';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Only typed annotations or marker IDs resolved against provider search metadata count as citations. */
export function parsePerplexityResponse(value: unknown): ProviderResult {
  const data = object(value);
  if (data.status !== 'completed' || data.error || data.incomplete_details) throw new ProductError(502, 'Perplexity did not complete this response. Partial output is excluded from visibility metrics.', 'incomplete_provider_response');
  if (data.model !== PERPLEXITY_MODEL) throw new ProductError(502, 'Perplexity returned a different model. This response was not collected under the requested model.', 'unexpected_provider_model');
  const output = Array.isArray(data.output) ? data.output.map(object) : [];
  const sources = new Map<number, { url: URL; title: string }>();
  const ambiguousIds = new Set<number>();
  for (const item of output) {
    if (item.type !== 'search_results' || !Array.isArray(item.results)) continue;
    for (const result of item.results.map(object)) {
      if (typeof result.id !== 'number' || !Number.isSafeInteger(result.id) || result.id < 1 || typeof result.url !== 'string') continue;
      const url = safeHttpUrl(result.url);
      if (!url) continue;
      if (sources.has(result.id) && sources.get(result.id)?.url.href !== url.href) ambiguousIds.add(result.id);
      sources.set(result.id, { url, title: typeof result.title === 'string' ? result.title : url.hostname });
    }
  }
  const texts: string[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const add = (url: URL, title: string, startIndex: number, endIndex: number) => {
    const key = `${url.href}|${startIndex}|${endIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    citations.push({ url: url.href, title, domain: url.hostname.toLowerCase().replace(/^www\./, ''), startIndex, endIndex, provenance: 'provider_annotation' });
  };
  for (const item of output) {
    if (item.type !== 'message' || item.role !== 'assistant') continue;
    if (item.status !== 'completed') throw new ProductError(502, 'Perplexity returned an incomplete answer message.', 'incomplete_provider_response');
    for (const part of Array.isArray(item.content) ? item.content.map(object) : []) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
      const text = part.text;
      for (const annotation of Array.isArray(part.annotations) ? part.annotations.map(object) : []) {
        if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') continue;
        const url = safeHttpUrl(annotation.url);
        if (!url) continue;
        // Agent docs do not define the Unicode offset unit. Keep a zero-width anchor instead of
        // inventing a highlighted span for Korean/emoji text. Marker offsets below are exact UTF-16.
        add(url, typeof annotation.title === 'string' ? annotation.title : url.hostname, offset, offset);
      }
      // The model's prose alone cannot create a source. Only cited IDs present in provider metadata resolve.
      for (const match of text.matchAll(/\[(?:web:)?([1-9]\d*)\]/g)) {
        const id = Number(match[1]);
        const source = sources.get(id);
        if (!source || ambiguousIds.has(id)) continue;
        add(source.url, source.title, offset + match.index, offset + match.index + match[0].length);
      }
      texts.push(text);
      offset += text.length + 2;
    }
  }
  const text = texts.join('\n\n');
  if (!text.trim()) throw new ProductError(502, 'Perplexity returned no answer text.', 'empty_provider_response');
  const usage = object(data.usage);
  return { text, citations, inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens), providerResponseId: typeof data.id === 'string' ? data.id : null };
}

export async function askPerplexity(input: string, options: { instructions?: string } = {}): Promise<ProviderResult> {
  assertProviderAllowed('perplexity');
  const key = (env as typeof env & { PERPLEXITY_API_KEY?: string }).PERPLEXITY_API_KEY?.trim();
  if (!key) throw new ProductError(503, 'Perplexity API is not configured on this deployment.', 'provider_unavailable');
  let response: Response;
  try {
    response = await fetch('https://api.perplexity.ai/v1/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL, input,
        instructions: `${options.instructions || 'Answer clearly and accurately. Do not invent facts or sources.'}\nUse web search to answer the question. Cite supporting search results inline, one source per bracket, such as [1][2], using the result IDs supplied by the search tool.`,
        tools: [{ type: 'web_search' }], tool_choice: 'required', max_steps: 2,
        max_output_tokens: 1800, store: false, stream: false,
      }),
      signal: AbortSignal.timeout(45000),
      redirect: 'manual', // workerd-compatible; non-2xx responses, including redirects, are rejected below.
    });
  } catch (error) {
    throw new ProductError(502, error instanceof Error && /timeout|abort/i.test(error.name) ? 'Perplexity request timed out. This answer was not collected.' : 'Perplexity could not be reached. This answer was not collected.', 'provider_network_error');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProductError(response.status === 429 ? 429 : 502, response.status === 429 ? 'Perplexity rate or billing limit reached. Check the API project.' : `Perplexity rejected the request (HTTP ${response.status}). Check the key, model access and billing.`, 'provider_error');
  }
  const payload = await readProviderJson(response, 'Perplexity');
  return parsePerplexityResponse(payload);
}
