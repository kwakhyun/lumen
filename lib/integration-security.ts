import { env } from 'cloudflare:workers';
import { ProductError } from './product-validation';

export type IntegrationEnv = typeof env & {
  APP_BASE_URL?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; INTEGRATION_ENCRYPTION_KEY?: string; INTEGRATION_ENCRYPTION_KEY_PREVIOUS?: string;
};
export const settings = () => env as IntegrationEnv;
export function integrationDb(): D1Database { if (!env.DB) throw new ProductError(503, 'Database binding is unavailable.', 'database_unavailable'); return env.DB; }
export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
export const isoNow = () => new Date().toISOString();
export function configuredOrigin(): string {
  try { const url = new URL(settings().APP_BASE_URL || ''); if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error(); return url.origin; }
  catch { throw new ProductError(503, 'APP_BASE_URL must be the deployment origin.', 'integration_unconfigured'); }
}
export function base64url(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
export function fromBase64(value: string): Uint8Array { const clean = value.replaceAll('-', '+').replaceAll('_', '/'); return Uint8Array.from(atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, '=')), char => char.charCodeAt(0)); }
export function randomSecret(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function hash(value: string): Promise<string> { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function encryptionKey(raw: string | undefined): Promise<CryptoKey> {
  let bytes: Uint8Array; try { bytes = fromBase64(raw || ''); if (bytes.length !== 32) throw new Error(); } catch { throw new ProductError(503, 'A 256-bit integration encryption key must be configured.', 'integration_unconfigured'); }
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function checkEncryptionKey(): Promise<void> { await encryptionKey(settings().INTEGRATION_ENCRYPTION_KEY); }
/** AES-GCM binds every ciphertext to a tenant, workspace and token purpose. No secrets leave the server. */
export async function encryptSecret(value: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await encryptionKey(settings().INTEGRATION_ENCRYPTION_KEY), new TextEncoder().encode(value));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}
export async function decryptSecret(value: string, context: string): Promise<string> {
  const [version, nonce, payload, extra] = value.split('.');
  if (version !== 'v1' || !nonce || !payload || extra) throw new ProductError(503, 'Stored integration credentials could not be decrypted. Reconnect the integration.', 'integration_credentials_invalid');
  for (const raw of [settings().INTEGRATION_ENCRYPTION_KEY, settings().INTEGRATION_ENCRYPTION_KEY_PREVIOUS].filter(Boolean)) {
    try { const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(nonce) as BufferSource, additionalData: new TextEncoder().encode(context) }, await encryptionKey(raw), fromBase64(payload) as BufferSource); return new TextDecoder().decode(decoded); } catch { /* Try the explicit previous key during rotation. */ }
  }
  throw new ProductError(503, 'Stored integration credentials could not be decrypted. Reconnect the integration.', 'integration_credentials_invalid');
}
export async function limitedBody(request: Request | Response, maximum = 1048576): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > maximum) { await reader.cancel(); throw new ProductError(413, 'Integration payload is too large.', 'payload_too_large'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return new TextDecoder().decode(bytes);
}
export async function remoteJson(url: string, init: RequestInit, service: string): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), redirect: 'manual' }); } catch { throw new ProductError(502, `${service} could not be reached. Retry later.`, 'integration_network_error'); }
  // Reject redirects without forwarding OAuth credentials. Older workerd versions
  // reject redirect:'error' during Request construction, before any HTTP dispatch.
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new ProductError(502, `${service} returned an unexpected redirect.`, 'integration_upstream_error'); }
  const raw = await limitedBody(response, 8 * 1024 * 1024);
  let data: Record<string, unknown>; try { data = record(JSON.parse(raw)); } catch { throw new ProductError(502, `${service} returned an invalid response.`, 'integration_response_invalid'); }
  if (!response.ok) {
    const code = data.error === 'invalid_grant' ? 'oauth_revoked' : response.status === 401 ? 'integration_unauthorized' : response.status === 403 ? 'integration_forbidden' : response.status === 429 ? 'integration_rate_limited' : 'integration_upstream_error';
    throw new ProductError(response.status === 429 ? 429 : 502, `${service} rejected the request (HTTP ${response.status}). Check authorization and service settings.`, code);
  }
  return data;
}
