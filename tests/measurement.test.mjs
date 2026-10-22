import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../../lib/metrics') return { url: new URL('../lib/metrics.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { hasOnlyUngroundedAnswers, providerLabel } = await import('../components/dashboard/measurement.ts');

const answer = (model, status = 'completed', mode = 'live') => ({ model, status, mode });

test('ungrounded completed Gemini responses make citations unavailable, not a measured zero', () => {
  assert.equal(hasOnlyUngroundedAnswers([answer('gemini-3.8-flash')]), true);
  assert.equal(hasOnlyUngroundedAnswers([answer('gemini-3.8-flash'), answer('gpt-4.1-mini', 'failed')]), true);
  assert.equal(hasOnlyUngroundedAnswers([]), false);
  assert.equal(hasOnlyUngroundedAnswers([answer('gemini-3.8-flash', 'pending')]), false);
});

test('historical grounded or synthetic answers retain their separate citation semantics', () => {
  assert.equal(hasOnlyUngroundedAnswers([answer('gemini-3.8-flash'), answer('gpt-4.1-mini')]), false);
  assert.equal(hasOnlyUngroundedAnswers([answer('gemini-3.8-flash', 'completed', 'demo')]), false);
  assert.equal(hasOnlyUngroundedAnswers([answer('demo-gemini', 'completed', 'demo')]), false);
  assert.equal(hasOnlyUngroundedAnswers([answer('perplexity/sonar')]), false);
});

test('configured credentials do not imply a provider is available under the access policy', () => {
  assert.equal(providerLabel({ configured: true, available: true }), '사용 가능');
  assert.equal(providerLabel({ configured: true, available: false }), '현재 제공하지 않음');
  assert.equal(providerLabel({ configured: false, available: false }), '미연결');
  assert.equal(providerLabel({ configured: false, available: true }), '미연결');
});

test('unknown model capabilities are unavailable even when response text contains URLs', () => {
  assert.equal(hasOnlyUngroundedAnswers([{ ...answer('future-model'), text: 'https://acme.example', citations: [] }]), true);
});
