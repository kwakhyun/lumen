import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Pure voice-of-customer logic: no database, no network, no model.
const root = fileURLToPath(new URL('..', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base && !path.extname(base) && existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { SAMPLE_VOICES, VOICE_LIMITS, buildVoiceResult, localVoiceReply, parseVoiceReply, voiceInput, voiceLines, voicePrompt } = await import('../lib/voice.ts');
const { guestMayRequest } = await import('../lib/auth/guest.ts');

const site = { name: 'Northstar', industry: '협업 도구', mode: 'live' };
const lines = ['화면이 직관적이라 쉽고 좋아요', '요금이 비싸서 부담돼요', '팀원이 늘면 요금이 얼마나 나올지 걱정돼요', '슬랙 연동이 끊겨서 불편해요', '고객센터 답변이 빨라서 만족해요'];
const build = (reply, extra = {}) => buildVoiceResult({ lines, reply: parseVoiceReply(JSON.stringify(reply)), site, competitors: [{ name: 'Orbit' }], prompts: [], model: 'm', ...extra });

test('pasted text becomes clean, unique, capped lines', () => {
  assert.deepEqual(voiceLines('1. 좋아요 정말\n- 좋아요 정말\n\n  • 느려서 불편해요\nㅋ'), ['좋아요 정말', '느려서 불편해요']);
  assert.equal(voiceLines(Array.from({ length: 300 }, (_, index) => `리뷰 내용 ${index}`).join('\n')).length, VOICE_LIMITS.lines);
  assert.equal(voiceLines('가'.repeat(900))[0].length, VOICE_LIMITS.lineLength);
});

test('every quote and count comes from the pasted lines, never from the model', () => {
  const result = build({ summary: '요약이에요.', factors: [
    { sentiment: 'satisfied', label: '쉬운 사용법', lines: [1, 5, 5] },
    { sentiment: 'complaint', label: '비싼 요금', lines: [2] },
    { sentiment: 'anxiety', label: '요금 걱정', lines: [3, 99, 0, -1] },
    { sentiment: 'complaint', label: '없는 줄', lines: [42] },
  ], needs: [{ label: '예산에 맞는 도구', lines: [2, 3] }], questions: [{ text: '비용 부담이 적은 협업 도구를 추천해 주세요.', line: 3 }] });
  assert.equal(result.total, 5);
  assert.equal(result.classified, 4);
  assert.equal(result.sentiments.satisfied.count, 2);
  assert.equal(result.sentiments.satisfied.factors[0].quote, lines[0]);
  assert.equal(result.sentiments.satisfied.factors[0].share, 40);
  assert.equal(result.sentiments.anxiety.factors[0].count, 1);
  assert.deepEqual(result.sentiments.complaint.factors.map(factor => factor.label), ['비싼 요금']);
  assert.equal(result.sentiments.satisfied.share + result.sentiments.complaint.share + result.sentiments.anxiety.share, 100);
  assert.deepEqual(result.needs[0].examples, [lines[1], lines[2]]);
  assert.equal(result.questions[0].quote, lines[2]);
});

test('measuring questions never name a brand, repeat, or cite a missing line', () => {
  const result = build({ factors: [], needs: [], questions: [
    { text: 'Northstar는 가격이 얼마인가요?', line: 2 },
    { text: 'orbit 대신 쓸 도구가 있나요?', line: 2 },
    { text: '비용 부담이 적은 협업 도구를 추천해 주세요.', line: 2 },
    { text: '비용 부담이 적은 협업 도구를 추천해 주세요', line: 3 },
    { text: '연동이 잘 되는 협업 도구는 무엇인가요?', line: 77 },
    { text: '연동이 안정적인 협업 도구를 알려 주세요.', line: 4 },
  ] }, { prompts: [{ text: '연동이 안정적인 협업 도구를 알려 주세요' }] });
  assert.deepEqual(result.questions.map(question => question.text), ['비용 부담이 적은 협업 도구를 추천해 주세요.', '연동이 안정적인 협업 도구를 알려 주세요.']);
  assert.deepEqual(result.questions.map(question => question.tracked), [false, true]);
});

test('a reply is read from fenced JSON and rejected when it is not usable', () => {
  assert.equal(parseVoiceReply('```json\n{"summary":"s","factors":[],"needs":[],"questions":[]}\n```').summary, 's');
  assert.throws(() => parseVoiceReply('죄송해요, 분석할 수 없어요.'));
  assert.throws(() => parseVoiceReply('{"factors":[{"sentiment":"angry","label":"x","lines":[1]}]}'));
});

test('keyword grouping follows the same contract for sample workspaces', () => {
  const sample = voiceLines(SAMPLE_VOICES.join('\n'));
  const result = buildVoiceResult({ lines: sample, reply: localVoiceReply(sample, '협업 도구'), site: { ...site, mode: 'demo' }, competitors: [], prompts: [], model: null });
  for (const tone of ['satisfied', 'complaint', 'anxiety']) {
    assert.ok(result.sentiments[tone].factors.length >= 2, tone);
    for (const factor of result.sentiments[tone].factors) assert.ok(sample.includes(factor.quote));
  }
  assert.ok(result.questions.length >= 3);
  assert.ok(result.questions.every(question => sample.includes(question.quote) && question.text.includes('협업 도구')));
  assert.ok(result.needs.length >= 2);
  assert.ok(result.summary.length > 10);
  // A worry outranks a complaint in the same line.
  assert.equal(localVoiceReply(['요금이 비싸서 계속 써도 될까 걱정이에요'], 'x').factors[0].sentiment, 'anxiety');
});

test('input bounds, prompt shape and guest access', () => {
  assert.equal(voiceInput.safeParse({ text: '짧아요' }).success, false);
  assert.equal(voiceInput.safeParse({ text: '가'.repeat(VOICE_LIMITS.total + 1) }).success, false);
  assert.equal(voiceInput.safeParse({ text: lines.join('\n') }).success, true);
  const prompt = JSON.parse(voicePrompt(lines, site));
  assert.deepEqual(prompt.lines[2], { n: 3, text: lines[2] });
  assert.equal(guestMayRequest('POST', '/api/sites/d0000000-0000-4000-8000-000000000001/voice'), true);
});
