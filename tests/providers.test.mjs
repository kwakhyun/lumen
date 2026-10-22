import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Contract fixtures only. This file never loads env files, opens sockets, or calls provider APIs.
globalThis.__providerFixtureEnv = {LUMEN_PROVIDER_MODE:'paid_enabled'};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__providerFixtureEnv;', shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { askGemini, parseGeminiResponse, GEMINI_MODEL } = await import('../lib/providers-gemini.ts');
const { askPerplexity, parsePerplexityResponse, PERPLEXITY_MODEL } = await import('../lib/providers-perplexity.ts');
const { askOpenAI } = await import('../lib/providers.ts');
const { readProviderJson } = await import('../lib/providers-http.ts');
const gemini = (text = '브랜드 비교 답변') => ({ responseId: 'gemini_fixture', candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 } });
const perplexity = (text = '브랜드 답변 [1]. 본문 https://invented.test [99]') => ({ id: 'pplx_fixture', model: PERPLEXITY_MODEL, status: 'completed', error: null, output: [
  { type: 'search_results', results: [{ id: 1, url: 'https://brand.example/page', title: 'Brand source' }, { id: 2, url: 'https://uncited.example', title: 'Uncited result' }] },
  { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
], usage: { input_tokens: 15, output_tokens: 30 } });
const noNetwork = async () => { throw new Error('Unexpected external request in fixture test'); };
globalThis.fetch = noNetwork;

test('Gemini preserves answer text, removes thought parts and never promotes URLs to citations', () => {
  const fixture = gemini('https://invented.test is text, not a citation.');
  fixture.candidates[0].content.parts.unshift({ thought: true, text: 'Internal reasoning must not become an answer.' });
  fixture.candidates[0].citationMetadata = { citationSources: [{ uri: 'https://recitation.example' }] };
  const result = parseGeminiResponse(fixture);
  assert.equal(result.text, 'https://invented.test is text, not a citation.');
  assert.deepEqual(result.citations, []);
  assert.equal(result.inputTokens, 10); assert.equal(result.outputTokens, 25);
});
test('Gemini rejects blocked, truncated, blank and unexpected grounded responses', () => {
  for (const finishReason of ['MAX_TOKENS', 'SAFETY', 'RECITATION', undefined]) {
    const fixture = gemini(); fixture.candidates[0].finishReason = finishReason;
    assert.throws(() => parseGeminiResponse(fixture), { code: 'incomplete_provider_response' });
  }
  assert.throws(() => parseGeminiResponse({ ...gemini(), promptFeedback: { blockReason: 'SAFETY' } }), { code: 'incomplete_provider_response' });
  assert.throws(() => parseGeminiResponse(gemini(' ')), { code: 'empty_provider_response' });
  const grounded = gemini(); grounded.candidates[0].groundingMetadata = { groundingChunks: [{ web: { uri: 'https://example.com' } }] };
  assert.throws(() => parseGeminiResponse(grounded), { code: 'unexpected_grounding_response' });
});
test('Perplexity joins citation markers to metadata and excludes uncited sources and body URLs', () => {
  const result = parsePerplexityResponse(perplexity());
  assert.equal(result.citations.length, 1); assert.equal(result.citations[0].domain, 'brand.example');
  assert.equal(result.text.slice(result.citations[0].startIndex, result.citations[0].endIndex), '[1]');
  assert.equal(result.citations[0].provenance, 'provider_annotation');
  assert.equal(result.inputTokens, 15); assert.equal(result.outputTokens, 30);
});
test('Perplexity handles typed annotations, multiple text blocks and source-typed markers', () => {
  const fixture = perplexity('First [web:1]');
  fixture.output[1].content.push({ type: 'output_text', text: 'Second source', annotations: [{ type: 'url_citation', url: 'https://other.example', title: 'Other', start_index: 0, end_index: 6 }] });
  const result = parsePerplexityResponse(fixture);
  assert.equal(result.citations.length, 2);
  assert.equal(result.citations[1].startIndex, 'First [web:1]\n\n'.length);
  assert.equal(result.citations[1].startIndex, result.citations[1].endIndex);
});
test('Perplexity ignores unsafe citation URLs and ambiguous search IDs', () => {
  const fixture = perplexity('Sources [1][3].');
  fixture.output[0].results.push({ id: 1, url: 'https://different.example' }, { id: 3, url: 'javascript:alert(1)' });
  fixture.output[1].content[0].annotations.push({ type: 'url_citation', url: 'https://user:pass@credential.example' }, { type: 'text', url: 'https://fake.example' });
  assert.deepEqual(parsePerplexityResponse(fixture).citations, []);
});
test('Perplexity rejects unfinished, wrong-model, error and empty responses', () => {
  for (const status of ['incomplete', 'failed', 'queued', undefined]) assert.throws(() => parsePerplexityResponse({ ...perplexity(), status }), { code: 'incomplete_provider_response' });
  assert.throws(() => parsePerplexityResponse({ ...perplexity(), error: { message: 'secret upstream detail' } }), { code: 'incomplete_provider_response' });
  assert.throws(() => parsePerplexityResponse({ ...perplexity(), model: 'openai/different-model' }), { code: 'unexpected_provider_model' });
  const fixture = perplexity(); fixture.output[1].status = 'incomplete';
  assert.throws(() => parsePerplexityResponse(fixture), { code: 'incomplete_provider_response' });
  assert.throws(() => parsePerplexityResponse(perplexity('')), { code: 'empty_provider_response' });
});
test('missing keys fail before any request is attempted', async () => {
  await assert.rejects(() => askGemini('Question'), { code: 'provider_unavailable' });
  await assert.rejects(() => askPerplexity('Question'), { code: 'provider_unavailable' });
});
test('Gemini request contract keeps credentials server-side and search disabled', async () => {
  globalThis.__providerFixtureEnv.GEMINI_API_KEY = 'fixture-only-key';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    assert.equal(init.headers['x-goog-api-key'], 'fixture-only-key');
    const body = JSON.parse(init.body);
    assert.equal(body.tools, undefined); assert.equal(body.contents[0].parts[0].text, 'Original question');
    assert.match(body.systemInstruction.parts[0].text, /Use Korean/); assert.match(body.systemInstruction.parts[0].text, /Web search is unavailable/);
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.redirect, 'manual');
    return Response.json(gemini());
  };
  try { assert.equal((await askGemini('Original question', { instructions: 'Use Korean.' })).providerResponseId, 'gemini_fixture'); }
  finally { delete globalThis.__providerFixtureEnv.GEMINI_API_KEY; globalThis.fetch = noNetwork; }
});
test('Perplexity request contract uses the supported Agent endpoint with explicit Sonar model', async () => {
  globalThis.__providerFixtureEnv.PERPLEXITY_API_KEY = 'fixture-only-key';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.perplexity.ai/v1/agent');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'perplexity/sonar'); assert.equal(body.preset, undefined); assert.equal(body.input, 'Original question');
    assert.equal(body.store, false); assert.equal(body.max_steps, 2); assert.equal(body.tools[0].type, 'web_search');
    assert.match(body.instructions, /Use Korean/); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.redirect, 'manual');
    return Response.json(perplexity());
  };
  try { assert.equal((await askPerplexity('Original question', { instructions: 'Use Korean.' })).providerResponseId, 'pplx_fixture'); }
  finally { delete globalThis.__providerFixtureEnv.PERPLEXITY_API_KEY; globalThis.fetch = noNetwork; }
});
test('provider HTTP, timeout and JSON errors expose only sanitized messages', async () => {
  for (const [ask, key] of [[askGemini, 'GEMINI_API_KEY'], [askPerplexity, 'PERPLEXITY_API_KEY']]) {
    globalThis.__providerFixtureEnv[key] = 'fixture-only-key';
    try {
      globalThis.fetch = async () => new Response('private upstream error', { status: 429 });
      await assert.rejects(() => ask('Question'), error => error.status === 429 && !error.message.includes('private'));
      globalThis.fetch = async () => { throw new DOMException('private timeout detail', 'TimeoutError'); };
      await assert.rejects(() => ask('Question'), error => error.code === 'provider_network_error' && !error.message.includes('private'));
      globalThis.fetch = async () => new Response('invalid json');
      await assert.rejects(() => ask('Question'), { code: 'invalid_provider_response' });
    } finally { delete globalThis.__providerFixtureEnv[key]; globalThis.fetch = noNetwork; }
  }
});
test('all three adapters cancel oversized streamed bodies before parsing despite a false content length', async () => {
  for (const [ask, key] of [[askOpenAI, 'OPENAI_API_KEY'], [askGemini, 'GEMINI_API_KEY'], [askPerplexity, 'PERPLEXITY_API_KEY']]) {
    globalThis.__providerFixtureEnv[key] = 'fixture-only-key'; let canceled = false, emitted = 0;
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
      return new Response(new ReadableStream({ pull(controller) { emitted += 65536; controller.enqueue(new Uint8Array(65536)); }, cancel() { canceled = true; } }), { headers: { 'Content-Length': '1', 'Content-Type': 'application/json' } });
    };
    try { await assert.rejects(() => ask('Question'), { code: 'provider_response_too_large' }); assert.equal(canceled, true); assert.ok(emitted < 2 * 1048576); }
    finally { delete globalThis.__providerFixtureEnv[key]; globalThis.fetch = noNetwork; }
  }
});
test('bounded response parsing handles split Korean UTF-8 and sanitizes broken body streams', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ text: '가나다' }));
  const split = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await readProviderJson(new Response(split), 'Fixture'), { text: '가나다' });
  const broken = new ReadableStream({ start(controller) { controller.error(new Error('private credentials in upstream exception')); } });
  await assert.rejects(() => readProviderJson(new Response(broken), 'Fixture'), error => error.code === 'invalid_provider_response' && !error.message.includes('credentials'));
  await assert.rejects(() => readProviderJson(new Response(Uint8Array.of(0xff)), 'Fixture'), { code: 'invalid_provider_response' });
});

test('free mode is fail-closed even with paid keys and Gemini failure never falls back', async () => {
  const {askProvider,providerStatuses,defaultGenerationModel}=await import('../lib/providers.ts');
  const e=globalThis.__providerFixtureEnv; e.OPENAI_API_KEY='fixture';e.PERPLEXITY_API_KEY='fixture';e.GEMINI_API_KEY='fixture';
  try {
    for(const mode of [undefined,'free_only','typo']){
      e.LUMEN_PROVIDER_MODE=mode;
      assert.equal(defaultGenerationModel(),GEMINI_MODEL);
      assert.equal(providerStatuses().find(p=>p.id==='openai').available,false);
      await assert.rejects(()=>askOpenAI('test'),{code:'paid_provider_disabled'});
      await assert.rejects(()=>askPerplexity('test'),{code:'paid_provider_disabled'});
      await assert.rejects(()=>askProvider('gpt-4.1-mini','test'),{code:'paid_provider_disabled'});
    }
    let calls=0;
    globalThis.fetch=async(url,init)=>{calls++;assert.match(url,/generativelanguage.googleapis.com/);const body=JSON.parse(init.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.maxOutputTokens,1800);return new Response('limited',{status:429});};
    await assert.rejects(()=>askProvider(GEMINI_MODEL,'test',{json:true,maxTokens:1800}),{code:'provider_error'});assert.equal(calls,1);
  } finally {e.LUMEN_PROVIDER_MODE='paid_enabled';delete e.OPENAI_API_KEY;delete e.PERPLEXITY_API_KEY;delete e.GEMINI_API_KEY;globalThis.fetch=noNetwork;}
});
