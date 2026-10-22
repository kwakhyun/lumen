import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_ORIGIN, KEY_LOCATION, INDEXNOW_ENDPOINT, SUBMISSION_URLS,
  parseArguments, validateKey, validateSubmissionUrls, classifySubmissionStatus, submitOnce,
} from '../scripts/submit-indexnow.mjs';

const FIXTURE_KEY = 'fixture-indexnow-key-only';

test('IndexNow is dry-run by default and rejects extra CLI arguments', () => {
  assert.deepEqual(parseArguments([]), { submit: false, help: false });
  assert.equal(parseArguments(['--submit']).submit, true);
  assert.equal(parseArguments(['--help']).help, true);
  for (const args of [['--origin', 'https://example.org'], ['--submit', '--submit'], ['--submit', '--help']]) {
    assert.throws(() => parseArguments(args), { code: 'invalid_arguments' });
  }
});

test('only a valid key and the exact three public HTTPS URLs are accepted', () => {
  assert.equal(validateKey(`${FIXTURE_KEY}\n`), FIXTURE_KEY);
  for (const key of ['', 'short', 'a'.repeat(129), '<html>key</html>', 'two keys here']) {
    assert.throws(() => validateKey(key), { code: 'invalid_local_key' });
  }
  assert.deepEqual(validateSubmissionUrls(SUBMISSION_URLS), SUBMISSION_URLS);
  for (const first of ['http://lumen-ai-visibility.khyun97.chatgpt.site/', `${SITE_ORIGIN}/dashboard`,
    `${SITE_ORIGIN}/?extra=yes`, `${SITE_ORIGIN}/#fragment`, 'https://example.org/']) {
    assert.throws(() => validateSubmissionUrls([first, ...SUBMISSION_URLS.slice(1)]), { code: 'invalid_url_list' });
  }
  assert.throws(() => validateSubmissionUrls([SUBMISSION_URLS[0], SUBMISSION_URLS[0], SUBMISSION_URLS[2]]));
  assert.throws(() => validateSubmissionUrls([...SUBMISSION_URLS, `${SITE_ORIGIN}/privacy`]));
});

test('one verified GET precedes one POST; summary contains no key and never claims indexing', async () => {
  const calls = [];
  const result = await submitOnce(FIXTURE_KEY, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(`${FIXTURE_KEY}\n`, { status: 200 });
    return new Response(null, { status: 200 });
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, KEY_LOCATION);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].url, INDEXNOW_ENDPOINT);
  assert.equal(calls[1].options.method, 'POST');
  for (const call of calls) {
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.credentials, 'omit');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.key, FIXTURE_KEY);
  assert.equal(body.keyLocation, KEY_LOCATION);
  assert.deepEqual(body.urlList, SUBMISSION_URLS);
  assert.equal(result.status, 'received');
  assert.equal(result.indexingConfirmed, false);
  assert.equal(result.retryAttempted, false);
  assert.equal(JSON.stringify(result).includes(FIXTURE_KEY), false);
});

test('key mismatch, redirects and oversized verification responses prevent submission', async () => {
  for (const response of [new Response('mismatched-fixture'), new Response(null, { status: 302 }),
    new Response('x'.repeat(257))]) {
    let calls = 0;
    await assert.rejects(submitOnce(FIXTURE_KEY, { fetchImpl: async () => { calls += 1; return response; } }),
      error => error.stage === 'key_verification' && !error.message.includes(FIXTURE_KEY));
    assert.equal(calls, 1);
  }
});

test('HTTP 202 stays pending, errors are not accepted, and uncertain delivery is never retried', async () => {
  assert.equal(classifySubmissionStatus(200), 'received');
  assert.equal(classifySubmissionStatus(202), 'key_validation_pending');
  for (const status of [204, 301, 403, 422, 429, 500]) assert.equal(classifySubmissionStatus(status), 'not_accepted');
  let calls = 0;
  await assert.rejects(submitOnce(FIXTURE_KEY, { fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return new Response(FIXTURE_KEY);
    throw new Error(`Untrusted provider error with ${FIXTURE_KEY}`);
  } }), error => error.code === 'submission_request_failed_delivery_unknown' && !error.message.includes(FIXTURE_KEY));
  assert.equal(calls, 2);
});
