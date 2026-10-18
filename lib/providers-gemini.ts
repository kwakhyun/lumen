import { env } from 'cloudflare:workers';
import type { ProviderResult } from './providers';
import { ProductError } from './product-validation';
import { readProviderJson } from './providers-http';

// Verified 2026-10-18: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
// REST schema: https://ai.google.dev/api/generate-content
// Search is deliberately disabled: https://ai.google.dev/gemini-api/terms#grounding-with-google-search
// Ordinary generated text supports mention analysis; it is NOT a Google Search citation measurement.
export const GEMINI_MODEL = 'gemini-3.8-flash';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Parse only a completed answer. Thought parts and generated URLs never become measured citations. */
export function parseGeminiResponse(value: unknown): ProviderResult {
  const data = object(value);
  const candidate = object(Array.isArray(data.candidates) ? data.candidates[0] : undefined);
  if (data.error || object(data.promptFeedback).blockReason || candidate.finishReason !== 'STOP') {
    throw new ProductError(502, 'Gemini did not complete this response. Partial or blocked output is excluded from visibility metrics.', 'incomplete_provider_response');
  }
  // A future request change must not silently collect Google Search output into the analytics database.
  const grounding = object(candidate.groundingMetadata);
  if (Array.isArray(grounding.groundingChunks) && grounding.groundingChunks.length || Array.isArray(grounding.webSearchQueries) && grounding.webSearchQueries.length || grounding.searchEntryPoint) {
    throw new ProductError(502, 'Gemini unexpectedly returned search grounding. This response was not stored.', 'unexpected_grounding_response');
  }
  const content = object(candidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts.map(object).filter(part => part.thought !== true && typeof part.text === 'string').map(part => part.text as string).join('');
  if (!text.trim()) throw new ProductError(502, 'Gemini returned no answer text.', 'empty_provider_response');
  const usage = object(data.usageMetadata);
  return {
    text,
    citations: [],
    inputTokens: count(usage.promptTokenCount) + count(usage.toolUsePromptTokenCount),
    outputTokens: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
    providerResponseId: typeof data.responseId === 'string' ? data.responseId : null,
  };
}

export async function askGemini(input: string, options: { instructions?: string; json?: boolean; maxTokens?: number } = {}): Promise<ProviderResult> {
  const key = (env as typeof env & { GEMINI_API_KEY?: string }).GEMINI_API_KEY?.trim();
  if (!key) throw new ProductError(503, 'Gemini API is not configured on this deployment.', 'provider_unavailable');
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input }] }],
        systemInstruction: { parts: [{ text: `${options.instructions || 'Answer clearly and accurately. Do not invent facts.'}\nWeb search is unavailable. Do not imply that you searched or verified current sources. Answer the question directly and acknowledge uncertainty.` }] },
        generationConfig: { candidateCount: 1, maxOutputTokens: Number.isSafeInteger(options.maxTokens)?Math.max(256,Math.min(4096,options.maxTokens!)):4096, ...(options.json?{responseMimeType:'application/json'}:{}), thinkingConfig: { thinkingLevel: 'low', includeThoughts: false } },
      }),
      signal: AbortSignal.timeout(45000),
      redirect: 'manual', // workerd-compatible; non-2xx responses, including redirects, are rejected below.
    });
  } catch (error) {
    throw new ProductError(502, error instanceof Error && /timeout|abort/i.test(error.name) ? 'Gemini request timed out. This answer was not collected.' : 'Gemini could not be reached. This answer was not collected.', 'provider_network_error');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProductError(response.status === 429 ? 429 : 502, response.status === 429 ? 'Gemini rate or billing limit reached. Check the API project.' : `Gemini rejected the request (HTTP ${response.status}). Check the key, model access and billing.`, 'provider_error');
  }
  const payload = await readProviderJson(response, 'Gemini');
  return parseGeminiResponse(payload);
}
