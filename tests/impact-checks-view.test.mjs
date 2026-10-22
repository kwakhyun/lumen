import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBaseline, checkCitation, checkContextChanged, checkMention } from '../lib/impact-checks-view.ts';

const queryId = '11111111-1111-4111-8111-111111111111';
const baselineDigest = 'a'.repeat(64);
const citation = (url, relation = 'original_citation') => ({ url, relation, title: 'Source' });
const search = (patch = {}) => ({
  queryId, repetition: 1, phase: 'before', digest: baselineDigest, voidedAt: null,
  result: 'answer', searchConfirmed: true, brandMention: 'absent',
  citationReview: 'complete', citations: [], ...patch,
});
const check = (patch = {}) => ({ ...search(), phase: undefined, baselineDigest, ...patch });

test('missing and unconfirmed search evidence stays unknown rather than becoming a negative result', () => {
  const unknown = [
    undefined,
    search({ result: 'error', searchConfirmed: false, brandMention: 'uncertain', citationReview: 'not_reviewed' }),
    search({ result: 'no_ai_answer', searchConfirmed: false, brandMention: 'uncertain', citationReview: 'not_reviewed' }),
    search({ searchConfirmed: false }),
  ];
  for (const row of unknown) {
    assert.equal(checkMention(row), null);
    assert.equal(checkCitation(row, 'lumen.example'), null);
  }
  assert.equal(checkMention(search()), false, 'a reviewed absence is a known negative');
  assert.equal(checkMention(search({ brandMention: 'present' })), true);
  assert.equal(checkCitation(search(), 'lumen.example'), false, 'reviewed empty citations are a known negative');
});

test('mention and citation certainty are independent observations', () => {
  const ownLink = citation('https://lumen.example/guide');
  const uncertainMention = search({ brandMention: 'uncertain', citations: [ownLink] });
  assert.equal(checkMention(uncertainMention), null);
  assert.equal(checkCitation(uncertainMention, 'lumen.example'), true);

  const unreviewedLinks = search({ brandMention: 'present', citationReview: 'not_reviewed', citations: [ownLink] });
  assert.equal(checkMention(unreviewedLinks), true);
  assert.equal(checkCitation(unreviewedLinks, 'lumen.example'), null);
});

test('only original citations on the brand hostname or its subdomains count', () => {
  for (const url of ['https://lumen.example/guide', 'https://www.lumen.example/', 'https://docs.lumen.example/article']) {
    assert.equal(checkCitation(search({ citations: [citation(url)] }), 'WWW.LUMEN.EXAMPLE'), true, url);
  }
  const unrelated = [
    'https://lumen.example.com/guide',
    'https://notlumen.example/',
    'https://lumen.example.evil.test/',
    'https://external.example/lumen.example?source=lumen.example',
    'https://lumen.example@external.example/guide',
    'not a URL',
  ];
  for (const url of unrelated) {
    assert.equal(checkCitation(search({ citations: [citation(url)] }), 'lumen.example'), false, url);
  }
  assert.equal(checkCitation(search({ citations: [
    citation('https://external.example/original'),
    citation('https://lumen.example/guide', 'followup_search'),
  ] }), 'lumen.example'), false, 'later research must not be presented as the original answer citation');
});

test('baseline selection uses the exact retained record and the same query and repetition', () => {
  const expected = Object.freeze(search({ id: 'expected', brandMention: 'present' }));
  const rows = Object.freeze([
    Object.freeze(search({ id: 'different-digest', digest: 'b'.repeat(64) })),
    Object.freeze(search({ id: 'different-question', queryId: '22222222-2222-4222-8222-222222222222' })),
    Object.freeze(search({ id: 'different-repetition', repetition: 2 })),
    Object.freeze(search({ id: 'after-record', phase: 'after' })),
    Object.freeze(search({ id: 'voided-copy', voidedAt: '2026-10-23T00:00:00Z' })),
    expected,
  ]);
  assert.equal(checkBaseline(check(), rows), expected);
  assert.equal(checkBaseline(check(), rows.slice(0, -1)), undefined);
  assert.equal(checkBaseline(check({ baselineDigest: 'c'.repeat(64) }), rows), undefined);
});

test('excluding a baseline removes the comparison without replacing it with another before observation', () => {
  const before = search({ brandMention: 'present', citations: [citation('https://lumen.example/')] });
  assert.equal(checkMention(checkBaseline(check(), [before])), true);
  const rows = [
    { ...before, voidedAt: '2026-10-23T00:00:00Z' },
    search({ digest: 'b'.repeat(64), brandMention: 'absent' }),
  ];
  const excluded = checkBaseline(check(), rows);
  assert.equal(excluded, undefined);
  assert.equal(checkMention(excluded), null);
  assert.equal(checkCitation(excluded, 'lumen.example'), null);
});

test('an active baseline with no verified AI answer remains available as evidence but has unknown metrics', () => {
  const failed = search({ result: 'error', searchConfirmed: false, brandMention: 'uncertain', citationReview: 'not_reviewed' });
  const selected = checkBaseline(check(), [failed]);
  assert.equal(selected, failed);
  assert.equal(checkMention(selected), null);
  assert.equal(checkCitation(selected, 'lumen.example'), null);
});

test('any changed search condition is disclosed, while object property ordering is irrelevant', () => {
  const before = Object.freeze({ surface: 'Perplexity', model: 'Auto', language: 'ko', country: 'KR', device: 'desktop', personalization: 'signed out' });
  const same = Object.fromEntries(Object.entries(before).reverse());
  assert.equal(checkContextChanged(before, same), false);
  const changes = { surface: 'Google AI Mode', model: 'Pro', language: 'en', country: 'US', device: 'mobile', personalization: 'signed in' };
  for (const [field, value] of Object.entries(changes)) {
    assert.equal(checkContextChanged(before, { ...before, [field]: value }), true, field);
  }
});
