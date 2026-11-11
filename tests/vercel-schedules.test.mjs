import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = globalThis.__scheduleEnv = {};
const ticks = globalThis.__scheduleTicks = [];
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/runtime-env') return { url: 'data:text/javascript,export const env=globalThis.__scheduleEnv;', shortCircuit: true };
  if (specifier === '@/lib/automation-runner') return { url: 'data:text/javascript,export async function tickDueSchedules(options){globalThis.__scheduleTicks.push(options);return {processed:0};}', shortCircuit: true };
  if (specifier === '@/lib/product-server') return { url: 'data:text/javascript,export function errorResponse(error){return Response.json({error:error.code},{status:error.status||500});}', shortCircuit: true };
  if (specifier.startsWith('@/')) return { url: pathToFileURL(path.join(root, specifier.slice(2) + '.ts')).href, shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (existsSync(base + '.ts')) return { url: pathToFileURL(base + '.ts').href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { POST } = await import('../app/api/operations/scheduled/route.ts');
const secret = 'fixture-schedule-secret-with-32-characters';
const request = (token, body) => new Request('https://lumen.test/api/operations/scheduled', {
  method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body,
});
after(() => { delete globalThis.__scheduleEnv; delete globalThis.__scheduleTicks; });

test('missing, weak and forged schedule credentials fail before doing work', async () => {
  settings.VERCEL_ENV = 'production'; settings.LUMEN_SCHEDULES_ENABLED = 'true';
  assert.equal((await POST(request(secret))).status, 503);
  settings.CRON_SECRET = 'short';
  assert.equal((await POST(request('short'))).status, 503);
  settings.CRON_SECRET = secret;
  for (const token of [undefined, 'wrong', secret + 'x']) assert.equal((await POST(request(token))).status, 401);
  assert.equal(ticks.length, 0);
});

test('preview and disabled production cannot spend AI usage with a valid credential', async () => {
  settings.CRON_SECRET = secret;
  for (const [environment, enabled] of [['preview', 'true'], ['development', 'true'], [undefined, 'true'], ['production', 'false'], ['production', undefined]]) {
    settings.VERCEL_ENV = environment; settings.LUMEN_SCHEDULES_ENABLED = enabled;
    const response = await POST(request(secret));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { skipped: true, reason: 'schedule_disabled' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(ticks.length, 0);
});

test('enabled production uses a fixed global scope and batch size', async () => {
  settings.CRON_SECRET = secret; settings.VERCEL_ENV = 'production'; settings.LUMEN_SCHEDULES_ENABLED = 'true';
  const response = await POST(request(secret, JSON.stringify({ ownerId: 'injected', limit: 100, entryPoint: 'mcp_operator' })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 0 });
  assert.deepEqual(ticks, [{ limit: 1, entryPoint: 'service_bearer' }]);
});
