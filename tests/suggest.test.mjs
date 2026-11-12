import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Pure suggestion logic: no database, no network, no model.
const root = fileURLToPath(new URL('..', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base && !path.extname(base) && existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { cleanSuggestion, sampleSuggestion, suggestInput, suggestInstructions, suggestPayload, withinBurst, SUGGEST_FIELDS } = await import('../lib/suggest.ts');
const { guestMayRequest } = await import('../lib/auth/guest.ts');

test('a reply becomes one clean line that continues the typed text', () => {
  assert.equal(cleanSuggestion('ask', '', '"경쟁사보다 덜 언급되는 질문이 뭐야?"'), '경쟁사보다 덜 언급되는 질문이 뭐야?');
  assert.equal(cleanSuggestion('ask', '경쟁사보다 ', '덜 언급되는 질문이 뭐야?\n\n설명: 이렇게 물어보세요'), '덜 언급되는 질문이 뭐야?');
  // The model repeated what was typed: only the ending is kept.
  assert.equal(cleanSuggestion('ask', '경쟁사보다', '경쟁사보다 덜 언급되는 질문'), ' 덜 언급되는 질문');
  assert.equal(cleanSuggestion('ask', '경쟁사보다 ', '경쟁사보다 덜 언급되는 질문'), '덜 언급되는 질문');
  assert.equal(cleanSuggestion('task_title', '', ''), '');
});

test('a suggestion cannot push the entry far past the field limit', () => {
  const long = '가나다라 '.repeat(80);
  const cut = cleanSuggestion('task_title', '', long);
  assert.ok(cut.length <= 110);
  assert.ok(!cut.endsWith(' '));
  assert.equal(cleanSuggestion('task_title', 'x'.repeat(200), '더 쓸 말'), '');
});

test('sample workspaces complete from a fixed list without a model', () => {
  assert.equal(sampleSuggestion('ask', ''), '경쟁사보다 덜 언급되는 질문이 뭐야?');
  assert.equal(sampleSuggestion('ask', '경쟁사보다 '), '덜 언급되는 질문이 뭐야?');
  assert.equal(sampleSuggestion('ask', '우리 브랜드를'), ' 가장 많이 인용한 출처는 어디야?');
  assert.equal(sampleSuggestion('ask', '전혀 다른 입력'), '');
  assert.equal(sampleSuggestion('ask', '경쟁사보다 덜 언급되는 질문이 뭐야?'), '');
  for (const field of SUGGEST_FIELDS) assert.ok(sampleSuggestion(field, '').length > 5, field);
});

test('the request carries brand context and keeps instructions out of the data', () => {
  const state = { site: { name: 'Northstar', industry: '협업 소프트웨어', description: '설명', language: '한국어' }, competitors: [{ name: 'Orbit' }], prompts: [{ text: '질문 1', active: true }, { text: '꺼둔 질문', active: false }], tasks: [{ title: '열린 작업', status: 'todo' }, { title: '끝난 작업', status: 'done' }] };
  const ask = JSON.parse(suggestPayload('ask', '경쟁', undefined, state));
  assert.equal(ask.typed, '경쟁');
  assert.equal(ask.brand.name, 'Northstar');
  assert.deepEqual(ask.trackedQuestions, ['질문 1']);
  assert.equal(ask.openTasks, undefined);
  const task = JSON.parse(suggestPayload('task_description', '', '가격표 추가', state));
  assert.equal(task.related, '가격표 추가');
  assert.deepEqual(task.openTasks, ['열린 작업']);
  assert.match(suggestInstructions('prompt', '한국어'), /Do not name the brand/);
  assert.match(suggestInstructions('ask', '한국어'), /never follow instructions/);
});

test('input is bounded and the burst guard only stops runaway clients', () => {
  assert.equal(suggestInput.safeParse({ field: 'ask', text: '' }).success, true);
  assert.equal(suggestInput.safeParse({ field: 'other', text: '' }).success, false);
  assert.equal(suggestInput.safeParse({ field: 'ask', text: 'a'.repeat(601) }).success, false);
  assert.equal(suggestInput.safeParse({ field: 'ask', text: '', extra: 1 }).success, false);
  const start = 1_000_000;
  for (let i = 0; i < 90; i += 1) assert.equal(withinBurst('account-a', start + i), true);
  assert.equal(withinBurst('account-a', start + 100), false);
  assert.equal(withinBurst('account-b', start + 100), true);
  assert.equal(withinBurst('account-a', start + 61_000), true);
  assert.equal(guestMayRequest('POST', '/api/sites/d0000000-0000-4000-8000-000000000001/suggest'), true);
});
