import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Bundle the actual adapters into workerd. Only the outbound network is replaced;
// native Request/fetch construction must run, which Node fetch mocks do not test.
// No environment files or real credentials are read, and no external requests escape.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let mf, redirect = false, calls = [];
before(async () => {
  const bundled = await build({
    absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers'],
    stdin: { resolveDir: root, sourcefile: 'workerd-provider-fixture.ts', loader: 'ts', contents: `
      import { askOpenAI } from './lib/providers';
      import { askGemini } from './lib/providers-gemini';
      import { askPerplexity } from './lib/providers-perplexity';
      import { remoteJson } from './lib/integration-security';
      export default {async fetch(request) {
        try {
          const name = new URL(request.url).pathname.slice(1);
          if (name === 'openai') await askOpenAI('Fixture question');
          else if (name === 'gemini') await askGemini('Fixture question');
          else if (name === 'perplexity') await askPerplexity('Fixture question');
          else if (name === 'oauth') await remoteJson('https://oauth2.googleapis.com/token', {method:'POST',body:'fixture'}, 'Google OAuth');
          else return new Response(null, {status:404});
          return Response.json({ok:true});
        } catch (error) {return Response.json({ok:false,status:error.status,code:error.code,message:error.message});}
      }};
    ` },
  });
  mf = new Miniflare({
    modules: true, compatibilityDate: '2026-05-15', script: bundled.outputFiles[0].text,
    bindings: { LUMEN_PROVIDER_MODE: 'paid_enabled', OPENAI_API_KEY: 'fixture-only', GEMINI_API_KEY: 'fixture-only', PERPLEXITY_API_KEY: 'fixture-only' },
    outboundService: async request => {
      const url = new URL(request.url); calls.push(url.hostname);
      assert.ok(['api.openai.com', 'generativelanguage.googleapis.com', 'api.perplexity.ai', 'oauth2.googleapis.com'].includes(url.hostname), 'Unexpected destination: no redirect or external network is allowed');
      if (redirect) return new Response('Do not forward fixture credentials', { status: 302, headers: { Location: 'https://untrusted.invalid/credential-sink' } });
      if (url.hostname === 'api.openai.com') return Response.json({ id: 'fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fixture answer', annotations: [] }] }] });
      if (url.hostname === 'generativelanguage.googleapis.com') return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Fixture answer' }] } }] });
      if (url.hostname === 'api.perplexity.ai') return Response.json({ id: 'fixture', model: 'perplexity/sonar', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Fixture answer', annotations: [] }] }] });
      return Response.json({ fixture: 'oauth-response' });
    },
  });
});
after(async () => { await mf?.dispose(); });
test('actual provider and OAuth code reaches outbound transport in workerd without redirect-constructor errors', async () => {
  redirect = false; calls = [];
  for (const provider of ['openai', 'gemini', 'perplexity', 'oauth']) {
    const result = await (await mf.dispatchFetch(`http://localhost/${provider}`)).json(); assert.deepEqual(result, { ok: true }, `${provider} failed: ${JSON.stringify(result)}`);
  }
  assert.equal(calls.length, 4);
});
test('workerd adapter fetches reject every redirect without forwarding credentials to its Location', async () => {
  redirect = true; calls = [];
  for (const provider of ['openai', 'gemini', 'perplexity', 'oauth']) {
    const result = await (await mf.dispatchFetch(`http://localhost/${provider}`)).json(); assert.equal(result.ok, false); assert.equal(result.status, 502); assert.equal(result.code, provider === 'oauth' ? 'integration_upstream_error' : 'provider_error'); assert.equal(result.message.includes('credential-sink'), false);
  }
  assert.equal(calls.length, 4);
});
