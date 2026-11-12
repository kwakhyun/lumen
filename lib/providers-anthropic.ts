import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/runtime-env';
import type { Citation } from './product-types';
import type { ProviderResult } from './providers';
import { safeHttpUrl } from './metrics';
import { ProductError } from './product-validation';
import { providerFailure, providerStatusCode, providerStatusMessage } from './providers-errors';

// Model IDs are complete as written; never append a date suffix.
export const CLAUDE_MODEL = 'claude-opus-5-5';
/** Server-side refusal fallback. Used for drafting and agents, never for measured answers. */
export const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
type ClaudeEnv = typeof env & { ANTHROPIC_API_KEY?: string };
export const claudeConfigured = () => Boolean((env as ClaudeEnv).ANTHROPIC_API_KEY?.trim());

let client: Anthropic | undefined;
export function claudeClient(): Anthropic {
  if (!claudeConfigured()) throw new ProductError(503, 'Claude API가 아직 연결되지 않았어요. 운영자가 ANTHROPIC_API_KEY를 등록해야 해요.', 'provider_unavailable');
  // The SDK reads ANTHROPIC_API_KEY itself. SDK retries stay off so that one reserved
  // unit is one request unless a caller explicitly repeats a definite rejection.
  client ??= new Anthropic({ maxRetries: 0, timeout: 100_000 });
  return client;
}

export function claudeError(error: unknown, startedAt: number): never {
  if (error instanceof ProductError) throw error;
  const fail = (status: number, code: string, message: string, upstream?: number): never => {
    providerFailure('Claude', CLAUDE_MODEL, startedAt, code, upstream);
    throw new ProductError(status, message, code);
  };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return fail(502, 'provider_timeout', 'Claude의 응답이 제한 시간 안에 오지 않았어요. 결과는 저장되지 않았으며 자동으로 다시 요청하지 않아요.');
  if (error instanceof Anthropic.APIConnectionError) return fail(502, 'provider_network_error', 'Claude에 연결하지 못했어요. 결과는 저장되지 않았어요.');
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    const status = error.status;
    return fail(status === 429 ? 429 : status >= 500 ? 503 : 502, providerStatusCode(status), providerStatusMessage('Claude', status), status);
  }
  return fail(502, 'provider_error', 'Claude가 요청을 처리하지 못했어요. 결과는 저장되지 않았어요.');
}

type TextLike = { type: string; text?: string; citations?: ReadonlyArray<{ type: string; url?: string; title?: string | null }> | null };
/** Cited text arrives as sentence fragments, so blocks are concatenated without separators. */
export function readClaudeContent(content: ReadonlyArray<TextLike>): { text: string; citations: Citation[] } {
  let text = '';
  const citations: Citation[] = [];
  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    const start = text.length;
    text += block.text;
    for (const citation of block.citations || []) {
      if (citation.type !== 'web_search_result_location' || typeof citation.url !== 'string') continue;
      const url = safeHttpUrl(citation.url);
      if (!url) continue;
      const domain = url.hostname.toLowerCase().replace(/^www\./, '');
      citations.push({ url: url.href, title: citation.title || url.hostname, domain, startIndex: start, endIndex: text.length, provenance: 'provider_annotation' });
    }
  }
  return { text: text.trim(), citations };
}

function assertFinished(stopReason: string | null) {
  if (stopReason === 'refusal') throw new ProductError(502, 'Claude가 이 요청에 답하지 않았어요. 거절된 응답은 지표에 포함하지 않아요.', 'incomplete_provider_response');
  if (stopReason !== 'end_turn') throw new ProductError(502, 'Claude가 답변을 끝까지 생성하지 못했어요. 불완전한 답변은 지표에 포함하지 않아요.', 'incomplete_provider_response');
}

/** A JSON reply may still be wrapped in a fence; keep only the outermost object. */
function jsonObjectText(text: string): string {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export type ClaudeOptions = { search?: boolean; instructions?: string; json?: boolean; maxTokens?: number; effort?: 'low' | 'medium' | 'high' };

/**
 * search=true collects a measured answer: web search is on, the answering model must be
 * Claude Opus 5.5 itself, and no fallback model may stand in for it.
 * search=false drafts text for the workspace and may use the server-side refusal fallback.
 */
export async function askClaude(input: string, options: ClaudeOptions = {}): Promise<ProviderResult> {
  const anthropic = claudeClient(), startedAt = Date.now();
  const system = `${options.instructions || 'Answer clearly and accurately. Do not invent facts or sources.'}${options.json ? '\nReturn exactly one valid JSON object and nothing else. Do not wrap it in a code fence.' : ''}`;
  // Thinking is always on for this model and shares the output budget with the answer.
  const maxTokens = Math.max(8000, Math.min(16000, (options.maxTokens || 2000) * 4));
  const effort = options.effort || (options.search ? 'low' : 'medium');
  let inputTokens = 0, outputTokens = 0, responseId: string | null = null, stopReason: string | null = null;
  const blocks: TextLike[] = [];
  try {
    if (options.search) {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input }];
      // A long server-side search can pause the turn; send it back unchanged to continue.
      for (let turn = 0; turn < 3; turn++) {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL, max_tokens: maxTokens, system, output_config: { effort },
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }], messages,
        });
        if (response.model !== CLAUDE_MODEL && !response.model.startsWith(`${CLAUDE_MODEL}-`)) throw new ProductError(502, '요청한 모델과 다른 모델이 응답해 수집하지 않았어요.', 'unexpected_provider_model');
        inputTokens += response.usage.input_tokens; outputTokens += response.usage.output_tokens;
        responseId = response.id; stopReason = response.stop_reason; blocks.push(...response.content);
        if (response.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: response.content });
      }
    } else {
      const response = await anthropic.beta.messages.create({
        model: CLAUDE_MODEL, max_tokens: maxTokens, system, output_config: { effort },
        betas: [CLAUDE_FALLBACK_BETA], fallbacks: 'default',
        messages: [{ role: 'user', content: input }],
      });
      inputTokens = response.usage.input_tokens; outputTokens = response.usage.output_tokens;
      responseId = response.id; stopReason = response.stop_reason; blocks.push(...response.content);
    }
  } catch (error) { return claudeError(error, startedAt); }
  assertFinished(stopReason);
  const parsed = readClaudeContent(blocks);
  if (!parsed.text) throw new ProductError(502, 'Claude가 답변 내용을 보내지 않았어요.', 'empty_provider_response');
  return { text: options.json ? jsonObjectText(parsed.text) : parsed.text, citations: options.search ? parsed.citations : [], inputTokens, outputTokens, providerResponseId: responseId };
}
