import { ProductError } from './product-validation';
import { ownedSite, quota } from './product-server';
import type { GA4Property, GA4Report, GA4Status } from './integration-types';
import { array, checkEncryptionKey, configuredOrigin, decryptSecret, encryptSecret, hash, integrationDb, isoNow, randomSecret, record, remoteJson, settings } from './integration-security';

// Official contracts checked 2026-10-18:
// https://developers.google.com/identity/protocols/oauth2/web-server
// https://developers.google.com/identity/protocols/oauth2/resources/best-practices
// https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
// https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
// https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
type Connection = { site_id: string; owner_id: string; refresh_cipher: string | null; access_cipher: string | null; access_expires: number; scopes: string; status: string; property_id: string | null; property_name: string | null; report: string | null; last_synced_at: string | null; error: string | null; revision: number; lease_token: string | null; lease_until: number };
const context = (owner: string, site: string, purpose: string) => `lumen:ga4:${owner}:${site}:${purpose}`;
function configured(): boolean { const e = settings(); return Boolean(e.GOOGLE_CLIENT_ID?.trim() && e.GOOGLE_CLIENT_SECRET?.trim() && e.INTEGRATION_ENCRYPTION_KEY?.trim() && e.APP_BASE_URL?.trim()); }
function requireConfigured(): void { if (!configured()) throw new ProductError(503, 'GA4 OAuth is not configured. The operator must configure a Google OAuth client and encryption key.', 'integration_unconfigured'); configuredOrigin(); }
async function connection(ownerId: string, siteId: string): Promise<Connection | null> { return integrationDb().prepare('SELECT * FROM ga4_connections WHERE site_id=? AND owner_id=?').bind(siteId, ownerId).first<Connection>(); }
async function liveSite(ownerId: string, siteId: string) { const site = await ownedSite(siteId, ownerId); if (site.mode !== 'live') throw new ProductError(400, 'GA4 connects to a live workspace only.', 'demo_integration_unavailable'); return site; }
export async function ga4Status(ownerId: string, siteId: string): Promise<GA4Status> {
  await ownedSite(siteId, ownerId); const row = await connection(ownerId, siteId);
  let report: GA4Report | null = null; if (row?.report) { try { report = JSON.parse(row.report) as GA4Report; } catch { /* A broken historical snapshot must not expose storage contents. */ } }
  return { oauthMode: settings().GOOGLE_OAUTH_MODE === 'production' ? 'production' : 'testing', configured: configured(), connected: Boolean(row?.refresh_cipher && row.status === 'connected'), reconnectRequired: row?.status === 'reconnect_required', propertyId: row?.property_id || null, propertyName: row?.property_name || null, lastSyncedAt: row?.last_synced_at || null, error: row?.error || null, report };
}
export async function startGa4Connection(ownerId: string, siteId: string): Promise<{ url: string }> {
  await liveSite(ownerId, siteId); requireConfigured(); await checkEncryptionKey(); await quota(ownerId, 'ga4-connect', 10, 1, 3600000);
  const state = randomSecret(), stateHash = await hash(state), verifier = randomSecret(), redirectUri = `${configuredOrigin()}/api/integrations/ga4/callback`;
  const verifierCipher = await encryptSecret(verifier, context(ownerId, siteId, `state:${stateHash}`));
  await integrationDb().batch([
    integrationDb().prepare('DELETE FROM oauth_states WHERE abs(expires_at)<? OR (owner_id=? AND site_id=?)').bind(Date.now(), ownerId, siteId),
    integrationDb().prepare('INSERT INTO oauth_states (state_hash,owner_id,site_id,verifier_cipher,redirect_uri,expires_at) VALUES (?,?,?,?,?,?)').bind(stateHash, ownerId, siteId, verifierCipher, redirectUri, Date.now() + 600000),
  ]);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: settings().GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString();
  return { url: url.href };
}
/** OAuth state is one-time, expiring and bound to the authenticated tenant before code exchange. */
export async function finishGa4Connection(ownerId: string, state: string, code: string | null, denied: boolean): Promise<string> {
  requireConfigured();
  if (!/^[\w-]{43}$/.test(state)) throw new ProductError(400, 'OAuth state is invalid or expired. Start connecting again.', 'oauth_state_invalid');
  const stateHash = await hash(state);
  // Negative expiry means claimed. Retain the row until exchange completes so disconnect can
  // invalidate an in-flight callback, while a replay cannot claim the state a second time.
  const pending = await integrationDb().prepare('UPDATE oauth_states SET expires_at=-expires_at WHERE state_hash=? AND owner_id=? AND expires_at>? RETURNING *').bind(stateHash, ownerId, Date.now()).first<{ site_id: string; verifier_cipher: string; redirect_uri: string }>();
  if (!pending) throw new ProductError(400, 'OAuth state is invalid, expired or already used. Start connecting again.', 'oauth_state_invalid');
  try {
  await liveSite(ownerId, pending.site_id);
  if (denied || !code || code.length > 4096) throw new ProductError(400, 'Google authorization was not completed.', 'oauth_denied');
  if (pending.redirect_uri !== `${configuredOrigin()}/api/integrations/ga4/callback`) throw new ProductError(400, 'OAuth callback configuration changed. Start connecting again.', 'oauth_state_invalid');
  const verifier = await decryptSecret(pending.verifier_cipher, context(ownerId, pending.site_id, `state:${stateHash}`));
  const tokens = await remoteJson(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: settings().GOOGLE_CLIENT_ID!, client_secret: settings().GOOGLE_CLIENT_SECRET!, code, code_verifier: verifier, redirect_uri: pending.redirect_uri, grant_type: 'authorization_code' }) }, 'Google OAuth');
  const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ') : [];
  if (!scopes.includes(SCOPE) || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || typeof tokens.expires_in !== 'number' || tokens.expires_in < 1 || tokens.token_type !== 'Bearer') throw new ProductError(400, 'Google did not grant read-only Analytics access with offline refresh. Reconnect and grant the requested access.', 'oauth_scope_missing');
  const refresh = await encryptSecret(tokens.refresh_token, context(ownerId, pending.site_id, 'refresh'));
  const access = await encryptSecret(tokens.access_token, context(ownerId, pending.site_id, 'access'));
  const at = isoNow();
  const saved = await integrationDb().prepare('INSERT INTO ga4_connections (site_id,owner_id,refresh_cipher,access_cipher,access_expires,scopes,status,created_at,updated_at) SELECT ?,?,?,?,?,?,\'connected\',?,? WHERE EXISTS (SELECT 1 FROM oauth_states WHERE state_hash=? AND owner_id=? AND expires_at<0 AND abs(expires_at)>?) ON CONFLICT(site_id) DO UPDATE SET refresh_cipher=excluded.refresh_cipher,access_cipher=excluded.access_cipher,access_expires=excluded.access_expires,scopes=excluded.scopes,status=\'connected\',error=NULL,property_id=NULL,property_name=NULL,report=NULL,last_synced_at=NULL,revision=ga4_connections.revision+1,lease_token=NULL,lease_until=0,updated_at=excluded.updated_at WHERE ga4_connections.owner_id=excluded.owner_id').bind(pending.site_id, ownerId, refresh, access, Date.now() + Math.min(tokens.expires_in, 86400) * 1000, scopes.join(' '), at, at, stateHash, ownerId, Date.now()).run();
  if (!saved.meta.changes) throw new ProductError(409, 'The connection was canceled or changed during authorization.', 'integration_changed');
  return pending.site_id;
  } finally { await integrationDb().prepare('DELETE FROM oauth_states WHERE state_hash=? AND owner_id=?').bind(stateHash, ownerId).run(); }
}
async function acquire(ownerId: string, siteId: string, duration = 180000): Promise<{ row: Connection; lease: string }> {
  const lease = crypto.randomUUID();
  const row = await integrationDb().prepare('UPDATE ga4_connections SET lease_token=?,lease_until=? WHERE site_id=? AND owner_id=? AND status=\'connected\' AND refresh_cipher IS NOT NULL AND lease_until<? RETURNING *').bind(lease, Date.now() + duration, siteId, ownerId, Date.now()).first<Connection>();
  if (!row) { const current = await connection(ownerId, siteId); if (!current?.refresh_cipher || current.status !== 'connected') throw new ProductError(409, 'Connect Google Analytics before using this feature.', 'ga4_not_connected'); throw new ProductError(409, 'Another GA4 operation is running. Retry shortly.', 'integration_busy'); }
  return { row, lease };
}
async function release(ownerId: string, siteId: string, lease: string): Promise<void> { await integrationDb().prepare('UPDATE ga4_connections SET lease_token=NULL,lease_until=0 WHERE site_id=? AND owner_id=? AND lease_token=?').bind(siteId, ownerId, lease).run(); }
async function tokenForLease(row: Connection, lease: string, preserveCredentials = false): Promise<string> {
  try {
    // Await inside the guarded block so invalid cached ciphertext also transitions
    // the connection to reconnect_required instead of leaving a false connected badge.
    if (row.access_cipher && row.access_expires > Date.now() + 60000) return await decryptSecret(row.access_cipher, context(row.owner_id, row.site_id, 'access'));
    if (!row.refresh_cipher) throw new ProductError(409, 'Reconnect Google Analytics.', 'ga4_not_connected');
    const refresh = await decryptSecret(row.refresh_cipher, context(row.owner_id, row.site_id, 'refresh'));
    const tokens = await remoteJson(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: settings().GOOGLE_CLIENT_ID!, client_secret: settings().GOOGLE_CLIENT_SECRET!, refresh_token: refresh, grant_type: 'refresh_token' }) }, 'Google OAuth');
    if (typeof tokens.access_token !== 'string' || typeof tokens.expires_in !== 'number' || tokens.expires_in < 1 || tokens.token_type !== 'Bearer') throw new ProductError(502, 'Google returned invalid refresh credentials.', 'integration_response_invalid');
    if (typeof tokens.scope === 'string' && !tokens.scope.split(' ').includes(SCOPE)) throw new ProductError(409, 'Google Analytics read-only permission was revoked. Reconnect.', 'oauth_revoked');
    const access = await encryptSecret(tokens.access_token, context(row.owner_id, row.site_id, 'access'));
    const refreshCipher = typeof tokens.refresh_token === 'string' ? await encryptSecret(tokens.refresh_token, context(row.owner_id, row.site_id, 'refresh')) : row.refresh_cipher;
    const updated = await integrationDb().prepare('UPDATE ga4_connections SET access_cipher=?,refresh_cipher=?,access_expires=?,updated_at=? WHERE site_id=? AND owner_id=? AND lease_token=? AND lease_until>? AND revision=?').bind(access, refreshCipher, Date.now() + Math.min(tokens.expires_in, 86400) * 1000, isoNow(), row.site_id, row.owner_id, lease, Date.now(), row.revision).run();
    if (!updated.meta.changes) throw new ProductError(409, 'Google Analytics connection changed during refresh.', 'integration_changed');
    return tokens.access_token;
  } catch (error) {
    if (error instanceof ProductError && ['oauth_revoked', 'integration_credentials_invalid'].includes(error.code)) {
      const statement = preserveCredentials
        ? 'UPDATE ga4_connections SET status=\'reconnect_required\',access_expires=0,error=?,updated_at=? WHERE site_id=? AND owner_id=? AND lease_token=? AND revision=?'
        : 'UPDATE ga4_connections SET status=\'reconnect_required\',access_cipher=NULL,refresh_cipher=NULL,access_expires=0,error=?,updated_at=? WHERE site_id=? AND owner_id=? AND lease_token=? AND revision=?';
      await integrationDb().prepare(statement).bind('Google access expired or was revoked. Reconnect to continue.', isoNow(), row.site_id, row.owner_id, lease, row.revision).run();
    }
    throw error;
  }
}
async function withConnection<T>(ownerId: string, siteId: string, action: (row: Connection, lease: string, access: string) => Promise<T>, preserveCredentials = false): Promise<T> {
  await liveSite(ownerId, siteId); requireConfigured(); const { row, lease } = await acquire(ownerId, siteId);
  try { return await action(row, lease, await tokenForLease(row, lease, preserveCredentials)); }
  catch (error) {
    if (error instanceof ProductError && error.code === 'integration_unauthorized') await integrationDb().prepare('UPDATE ga4_connections SET access_expires=0,error=? WHERE site_id=? AND owner_id=? AND lease_token=?').bind('Google access was rejected. Retry to refresh authorization, or reconnect.', siteId, ownerId, lease).run();
    throw error;
  } finally { await release(ownerId, siteId, lease); }
}
export async function listGa4Properties(ownerId: string, siteId: string, pageToken?: string): Promise<{ properties: GA4Property[]; nextPageToken: string | null }> {
  if (pageToken && pageToken.length > 2048) throw new ProductError(400, 'Invalid property page token.', 'invalid_input');
  await quota(ownerId, 'ga4-properties', 30, 1, 3600000);
  return withConnection(ownerId, siteId, async (_row, _lease, access) => {
    const query = new URLSearchParams({ pageSize: '200', ...(pageToken ? { pageToken } : {}) });
    const data = await remoteJson(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${query}`, { headers: { Authorization: `Bearer ${access}` } }, 'Google Analytics');
    const properties: GA4Property[] = [];
    for (const account of array(data.accountSummaries)) for (const property of array(account.propertySummaries)) {
      if (typeof property.property !== 'string' || !/^properties\/\d{1,20}$/.test(property.property)) continue;
      properties.push({ id: property.property.split('/')[1], name: typeof property.displayName === 'string' ? property.displayName.slice(0, 200) : property.property, accountName: typeof account.displayName === 'string' ? account.displayName.slice(0, 200) : '' });
    }
    return { properties, nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null };
  });
}
export async function selectGa4Property(ownerId: string, siteId: string, propertyId: string): Promise<GA4Status> {
  if (!/^\d{1,20}$/.test(propertyId)) throw new ProductError(400, 'Select a valid GA4 property.', 'invalid_input');
  await quota(ownerId, 'ga4-property-select', 20, 1, 3600000);
  await withConnection(ownerId, siteId, async (row, lease, access) => {
    const property = await remoteJson(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`, { headers: { Authorization: `Bearer ${access}` } }, 'Google Analytics');
    if (property.name !== `properties/${propertyId}` || property.deleteTime) throw new ProductError(400, 'This GA4 property is unavailable.', 'ga4_property_unavailable');
    const name = typeof property.displayName === 'string' ? property.displayName.slice(0, 200) : propertyId;
    const result = await integrationDb().prepare('UPDATE ga4_connections SET property_id=?,property_name=?,report=NULL,last_synced_at=NULL,error=NULL,revision=revision+1,updated_at=? WHERE site_id=? AND owner_id=? AND lease_token=? AND lease_until>? AND revision=?').bind(propertyId, name, isoNow(), siteId, ownerId, lease, Date.now(), row.revision).run();
    if (!result.meta.changes) throw new ProductError(409, 'The connection changed. Select the property again.', 'integration_changed');
  });
  return ga4Status(ownerId, siteId);
}
const AI_SOURCE_PATTERN = '(^|.*\\.)(chatgpt\\.com|chat\\.openai\\.com|perplexity\\.ai|claude\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com)$';
function reportingCalendar(timeZone: unknown): Intl.DateTimeFormat {
  try {
    if (typeof timeZone !== 'string' || !timeZone.trim()) throw new Error();
    return new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { throw new ProductError(502, 'Google Analytics returned an invalid reporting time zone.', 'integration_response_invalid'); }
}
/** Pin a calendar range once: relative API dates can shift between pages across property midnight.
 * https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DateRange
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties
 */
export function ga4DateRange(timeZone: unknown, days: 7 | 30 | 90, now = Date.now()): { startDate: string; endDate: string; timeZone: string } {
  if (![7, 30, 90].includes(days)) throw new ProductError(400, 'Choose 7, 30 or 90 days.', 'invalid_input');
  const calendar = reportingCalendar(timeZone), parts = calendar.formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find(value => value.type === type)?.value);
  // UTC is only the arithmetic calendar here; the year/month/day came from the property's zone.
  const today = Date.UTC(part('year'), part('month') - 1, part('day'));
  return { startDate: new Date(today - days * 86400000).toISOString().slice(0, 10), endDate: new Date(today - 86400000).toISOString().slice(0, 10), timeZone: calendar.resolvedOptions().timeZone };
}
function number(value: unknown): number { const parsed = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN; if (!Number.isFinite(parsed) || parsed < 0) throw new ProductError(502, 'Google Analytics returned an invalid metric.', 'integration_response_invalid'); return parsed; }
function values(row: Record<string, unknown>, field: string): string[] { return array(row[field]).map(item => typeof item.value === 'string' ? item.value : ''); }
function verifyHeaders(data: Record<string, unknown>, dimensions: string[], metrics: string[]) {
  const rowsValid = data.rows === undefined || Array.isArray(data.rows);
  const emptyRows = data.rows === undefined || Array.isArray(data.rows) && data.rows.length === 0;
  const emptyCount = data.rowCount === undefined || data.rowCount === 0;
  let allowEmptyHeaders = false;
  // Observed on a new property's empty aggregate report: kind and metadata remain,
  // but rows, rowCount and both header arrays may be omitted. Never infer zero from {}.
  if (emptyRows && emptyCount && data.kind === 'analyticsData#runReport') {
    try { reportingCalendar(record(data.metadata).timeZone); allowEmptyHeaders = true; } catch { /* Fail closed through the schema diagnostic below. */ }
  }
  const matches = (value: unknown, expected: string[]) => {
    if (value === undefined || Array.isArray(value) && value.length === 0) return expected.length === 0 || allowEmptyHeaders;
    return Array.isArray(value) && JSON.stringify(array(value).map(item => item.name)) === JSON.stringify(expected);
  };
  if (!rowsValid || emptyRows && !emptyCount || data.kind !== undefined && data.kind !== 'analyticsData#runReport' || !matches(data.dimensionHeaders, dimensions) || !matches(data.metricHeaders, metrics)) {
    // Schema diagnostics contain only fixed labels and booleans. Never log response
    // bodies, metric values, property/user identifiers, request headers or tokens.
    const known = new Set(['date', 'sessionSource', 'sessionMedium', 'sessions', 'totalUsers', 'screenPageViews']);
    const headers = (value: unknown) => ({ type: value === undefined ? 'absent' : Array.isArray(value) ? 'array' : 'invalid', names: array(value).slice(0, 10).map(item => typeof item.name === 'string' && known.has(item.name) ? item.name : 'other') });
    console.error('ga4_report_schema', JSON.stringify({
      stage: dimensions.length ? 'detail' : metrics.length > 1 ? 'totals' : 'aiTotals',
      dimensions: headers(data.dimensionHeaders), metrics: headers(data.metricHeaders),
      rows: data.rows === undefined ? 'absent' : Array.isArray(data.rows) ? data.rows.length ? 'nonempty' : 'empty' : 'invalid',
      rowCount: data.rowCount === undefined ? 'absent' : data.rowCount === 0 ? 'zero' : typeof data.rowCount === 'number' && Number.isSafeInteger(data.rowCount) && data.rowCount > 0 ? 'positive' : 'invalid',
      kindValid: data.kind === 'analyticsData#runReport', timeZonePresent: typeof record(data.metadata).timeZone === 'string',
    }));
    throw new ProductError(502, 'Google Analytics report columns did not match the requested schema.', 'integration_response_invalid');
  }
}
/** No visitor IDs, page URLs or event rows. Totals come from separate aggregate queries, never summed users. */
export function mapGa4Report(pages: Record<string, unknown>[], totals: Record<string, unknown>, aiTotals: Record<string, unknown>, startDate: string, endDate: string): GA4Report {
  const rows: GA4Report['rows'] = [];
  const grouped = new Map<string, GA4Report['rows'][number]>();
  for (const page of pages) {
    verifyHeaders(page, ['date', 'sessionSource', 'sessionMedium'], ['sessions', 'screenPageViews']);
    for (const raw of array(page.rows)) {
      const dimensions = values(raw, 'dimensionValues'), metrics = values(raw, 'metricValues');
      if (dimensions.length !== 3 || metrics.length !== 2 || !/^\d{8}$/.test(dimensions[0])) throw new ProductError(502, 'Google Analytics returned an invalid row.', 'integration_response_invalid');
      const date = `${dimensions[0].slice(0, 4)}-${dimensions[0].slice(4, 6)}-${dimensions[0].slice(6, 8)}`;
      const parsedDate = Date.parse(date);
      if (!Number.isFinite(parsedDate) || date < startDate || date > endDate || new Date(parsedDate).toISOString().slice(0, 10) !== date) throw new ProductError(502, 'Google Analytics returned data outside the requested dates.', 'integration_response_invalid');
      // Source/medium may be user-controlled UTM strings. Restrict stored labels and merge redacted buckets.
      const source = /^[a-z0-9._-]{1,100}$/i.test(dimensions[1]) ? dimensions[1].toLowerCase() : ['(direct)', '(not set)', '(other)'].includes(dimensions[1]) ? dimensions[1] : '(other source)';
      const medium = /^[a-z0-9_-]{1,40}$/i.test(dimensions[2]) ? dimensions[2].toLowerCase() : ['(none)', '(not set)', '(other)'].includes(dimensions[2]) ? dimensions[2] : '(other medium)';
      const key = `${date}|${source}|${medium}`, current = grouped.get(key) || { date, source, medium, sessions: 0, views: 0 };
      current.sessions += number(metrics[0]); current.views += number(metrics[1]); grouped.set(key, current);
    }
  }
  rows.push(...grouped.values());
  verifyHeaders(totals, [], ['sessions', 'totalUsers', 'screenPageViews']); verifyHeaders(aiTotals, [], ['sessions']);
  const total = array(totals.rows), ai = array(aiTotals.rows);
  if (total.length > 1 || ai.length > 1) throw new ProductError(502, 'Google Analytics totals were not aggregated.', 'integration_response_invalid');
  const summary = total.length ? values(total[0], 'metricValues').map(number) : [0, 0, 0];
  const aiSessions = ai.length ? number(values(ai[0], 'metricValues')[0]) : 0;
  if (summary.length !== 3) throw new ProductError(502, 'Google Analytics totals were incomplete.', 'integration_response_invalid');
  const metadata = [...pages, totals, aiTotals].map(p => record(p.metadata));
  return { startDate, endDate, totalSessions: summary[0], totalUsers: summary[1], totalViews: summary[2], aiSessions, rows, timeZone: typeof record(totals.metadata).timeZone === 'string' ? record(totals.metadata).timeZone as string : null, dataQuality: { subjectToThresholding: metadata.some(m => m.subjectToThresholding === true), dataLossFromOtherRow: metadata.some(m => m.dataLossFromOtherRow === true), sampled: metadata.some(m => Array.isArray(m.samplingMetadatas) && m.samplingMetadatas.length > 0) } };
}
export async function syncGa4(ownerId: string, siteId: string, days: 7 | 30 | 90 = 30): Promise<GA4Status> {
  if (![7, 30, 90].includes(days)) throw new ProductError(400, 'Choose 7, 30 or 90 days.', 'invalid_input');
  await quota(ownerId, 'ga4-import', 10, 1, 3600000);
  await withConnection(ownerId, siteId, async (row, lease, access) => {
    if (!row.property_id || !/^\d{1,20}$/.test(row.property_id)) throw new ProductError(409, 'Select a GA4 property first.', 'ga4_property_required');
    try {
      const property = await remoteJson(`https://analyticsadmin.googleapis.com/v1beta/properties/${row.property_id}`, { headers: { Authorization: `Bearer ${access}` } }, 'Google Analytics');
      if (property.name !== `properties/${row.property_id}` || property.deleteTime) throw new ProductError(400, 'This GA4 property is unavailable.', 'ga4_property_unavailable');
      const { startDate, endDate, timeZone } = ga4DateRange(property.timeZone, days);
      const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${row.property_id}:runReport`;
      const request = async (body: Record<string, unknown>) => {
        const data = await remoteJson(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate, endDate }], returnPropertyQuota: true, ...body }) }, 'Google Analytics');
        const responseTimeZone = record(data.metadata).timeZone;
        if (responseTimeZone !== undefined && reportingCalendar(responseTimeZone).resolvedOptions().timeZone !== timeZone) throw new ProductError(409, 'The GA4 reporting time zone changed during import. Retry the import.', 'ga4_report_changed');
        return data;
      };
      const pages: Record<string, unknown>[] = []; let expected = 0;
      for (let offset = 0; offset < 10000; offset += 2000) {
        const page = await request({ dimensions: ['date', 'sessionSource', 'sessionMedium'].map(name => ({ name })), metrics: ['sessions', 'screenPageViews'].map(name => ({ name })), limit: '2000', offset: String(offset), orderBys: ['date', 'sessionSource', 'sessionMedium'].map(dimensionName => ({ dimension: { dimensionName } })) });
        const pageRows = page.rows === undefined ? [] : page.rows;
        if (!Array.isArray(pageRows)) throw new ProductError(502, 'Google Analytics returned invalid report rows.', 'integration_response_invalid');
        // ProtoJSON may omit the default int32 rowCount=0 and empty repeated rows.
        // https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/RunReportResponse
        // https://protobuf.dev/programming-guides/json/#presence-and-default-values
        const rowCount = page.rowCount === undefined && pageRows.length === 0 ? 0 : page.rowCount;
        if (typeof rowCount !== 'number' || !Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > 2147483647) throw new ProductError(502, 'Google Analytics returned an invalid report row count.', 'integration_response_invalid');
        if (rowCount > 10000) throw new ProductError(422, 'This GA4 report exceeds 10,000 aggregate rows. Choose a shorter period. The previous report is unchanged.', 'ga4_report_too_large');
        if (offset === 0) expected = rowCount; else if (rowCount !== expected) throw new ProductError(409, 'GA4 data changed during pagination. Retry the import.', 'ga4_report_changed');
        if (pageRows.length > 2000 || offset + pageRows.length > rowCount) throw new ProductError(502, 'Google Analytics report row counts did not match.', 'integration_response_invalid');
        pages.push(page);
        if (offset + pageRows.length >= expected) break;
        if (pageRows.length !== 2000) throw new ProductError(502, 'Google Analytics returned an incomplete report page.', 'integration_response_invalid');
      }
      if (pages.reduce((n, p) => n + array(p.rows).length, 0) !== expected) throw new ProductError(502, 'Google Analytics report row counts did not match.', 'integration_response_invalid');
      const totals = await request({ metrics: ['sessions', 'totalUsers', 'screenPageViews'].map(name => ({ name })) });
      const aiTotals = await request({ metrics: [{ name: 'sessions' }], dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'FULL_REGEXP', value: AI_SOURCE_PATTERN, caseSensitive: false } } } });
      const report = mapGa4Report(pages, totals, aiTotals, startDate, endDate);
      report.timeZone = timeZone;
      if (new TextEncoder().encode(JSON.stringify(report)).length > 1500000) throw new ProductError(422, 'The GA4 aggregate snapshot is too large. Choose a shorter period. The previous report is unchanged.', 'ga4_report_too_large');
      const updated = await integrationDb().prepare('UPDATE ga4_connections SET report=?,last_synced_at=?,error=NULL,updated_at=? WHERE site_id=? AND owner_id=? AND property_id=? AND lease_token=? AND lease_until>? AND revision=? AND status=\'connected\'').bind(JSON.stringify(report), isoNow(), isoNow(), siteId, ownerId, row.property_id, lease, Date.now(), row.revision).run();
      if (!updated.meta.changes) throw new ProductError(409, 'The connection changed during import. No report was saved.', 'integration_changed');
    } catch (error) {
      const message = error instanceof ProductError ? error.message : 'GA4 import failed. The previous report is unchanged.';
      await integrationDb().prepare('UPDATE ga4_connections SET error=?,updated_at=? WHERE site_id=? AND owner_id=? AND lease_token=? AND revision=?').bind(message, isoNow(), siteId, ownerId, lease, row.revision).run();
      throw error;
    }
  });
  return ga4Status(ownerId, siteId);
}
export async function disconnectGa4(ownerId: string, siteId: string): Promise<GA4Status> {
  await ownedSite(siteId, ownerId);
  // Deleting local credentials first fences in-flight refresh/import writes. Google grants may be
  // shared across a user's workspaces, so revoking a global grant here would disrupt other sites.
  await integrationDb().batch([
    integrationDb().prepare('DELETE FROM ga4_connections WHERE site_id=? AND owner_id=?').bind(siteId, ownerId),
    integrationDb().prepare('DELETE FROM oauth_states WHERE site_id=? AND owner_id=?').bind(siteId, ownerId),
  ]);
  return ga4Status(ownerId, siteId);
}

/** Explicit, bounded baseline read. Reuses the current OAuth grant and never replaces its saved traffic report. */
export function ga4BaselineDateRange(timeZone: unknown, requestedStartDate: string, requestedEndDate: string, timestamp = Date.now()) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(requestedStartDate) || !validDate(requestedEndDate) || requestedStartDate > requestedEndDate || Date.parse(requestedEndDate) - Date.parse(requestedStartDate) >= 90 * 86400000) throw new ProductError(400, 'GA4 기준 기간은 1~90일의 유효한 날짜여야 해요.', 'invalid_input');
  const calendar = ga4DateRange(timeZone, 7, timestamp), endDate = requestedEndDate < calendar.endDate ? requestedEndDate : calendar.endDate;
  if (endDate < requestedStartDate) throw new ProductError(409, 'GA4 속성 시간대에서 기준 기간의 하루가 끝난 뒤 가져올 수 있어요.', 'ga4_baseline_not_ready');
  return { startDate: requestedStartDate, endDate, timeZone: calendar.timeZone };
}
export const GA4_BASELINE_SOURCE_PATTERN = AI_SOURCE_PATTERN;
export function mapGa4BaselineAggregate(data: Record<string, unknown>, metrics: string[], timeZone: string): number[] {
  verifyHeaders(data, [], metrics);
  if (reportingCalendar(record(data.metadata).timeZone).resolvedOptions().timeZone !== timeZone) throw new ProductError(409, 'GA4 보고 시간대가 달라졌어요. 다시 가져와 주세요.', 'ga4_report_changed');
  const rows = array(data.rows), count = data.rowCount === undefined && rows.length === 0 ? 0 : data.rowCount;
  if (rows.length > 1 || count !== rows.length || rows.some(row => array(row.dimensionValues).length !== 0)) throw new ProductError(502, 'GA4 집계 응답의 행 수가 일치하지 않아요.', 'integration_response_invalid');
  if (!rows.length) return metrics.map(() => 0);
  const raw = values(rows[0], 'metricValues');
  if (raw.length !== metrics.length) throw new ProductError(502, 'GA4 집계 응답의 지표가 일치하지 않아요.', 'integration_response_invalid');
  return raw.map(value => { const parsed = number(value); if (!Number.isSafeInteger(parsed) || parsed > 1_000_000_000) throw new ProductError(502, 'GA4 세션과 조회수는 유효한 정수여야 해요.', 'integration_response_invalid'); return parsed; });
}
export async function readGa4Baseline<T = import('./impact-baseline-types').ImpactBaselinePayload>(ownerId: string, siteId: string, requestedStartDate: string, requestedEndDate: string, save?: (payload: import('./impact-baseline-types').ImpactBaselinePayload, guard: { lease: string; revision: number; propertyId: string }) => Promise<T>): Promise<T> {
  const site = await liveSite(ownerId, siteId), hostName = site.domain.toLowerCase();
  if (!/^[a-z0-9.-]{3,253}$/.test(hostName)) throw new ProductError(400, '브랜드의 도메인을 확인해 주세요.', 'invalid_input');
  return withConnection(ownerId, siteId, async (row, lease, access) => {
    if (!row.property_id || !/^\d{1,20}$/.test(row.property_id)) throw new ProductError(409, '연결한 GA4 속성을 먼저 선택해 주세요.', 'ga4_property_required');
    const property = await remoteJson(`https://analyticsadmin.googleapis.com/v1beta/properties/${row.property_id}`, { headers: { Authorization: `Bearer ${access}` } }, 'Google Analytics');
    if (property.name !== `properties/${row.property_id}` || property.deleteTime) throw new ProductError(409, '연결한 GA4 속성을 사용할 수 없어요.', 'ga4_property_unavailable');
    const { startDate, endDate, timeZone } = ga4BaselineDateRange(property.timeZone, requestedStartDate, requestedEndDate);
    const hostFilter = { filter: { fieldName: 'hostName', inListFilter: { values: [hostName, `www.${hostName}`], caseSensitive: false } } };
    const request = (metrics: string[], ai = false) => remoteJson(`https://analyticsdata.googleapis.com/v1beta/properties/${row.property_id}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate, endDate }], metrics: metrics.map(name => ({ name })), dimensionFilter: ai ? { andGroup: { expressions: [hostFilter, { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'FULL_REGEXP', value: AI_SOURCE_PATTERN, caseSensitive: false } } }] } } : hostFilter, limit: '1', returnPropertyQuota: true }),
    }, 'Google Analytics');
    // Both totals are server aggregates; users and per-source rows are never summed.
    const totals = await request(['sessions', 'screenPageViews']), ai = await request(['sessions'], true);
    const [totalSessions, totalViews] = mapGa4BaselineAggregate(totals, ['sessions', 'screenPageViews'], timeZone), [aiSessions] = mapGa4BaselineAggregate(ai, ['sessions'], timeZone);
    if (aiSessions > totalSessions) throw new ProductError(409, '조회 도중 GA4 집계가 달라졌어요. 기존 자료를 유지하며 나중에 다시 가져올 수 있어요.', 'ga4_report_changed');
    const metadata = [record(totals.metadata), record(ai.metadata)];
    const dataQuality = { subjectToThresholding: metadata.some(m => m.subjectToThresholding === true), dataLossFromOtherRow: metadata.some(m => m.dataLossFromOtherRow === true), sampled: metadata.some(m => array(m.samplingMetadatas).length > 0), truncated: metadata.some(m => array(m.dataTruncationReasons).length > 0), emptyReasons: metadata.flatMap(m => typeof m.emptyReason === 'string' && m.emptyReason ? [m.emptyReason.slice(0, 500)] : []) };
    const notes = [
      `GA4에 기록된 ${hostName} 및 www.${hostName}의 합계입니다. 다른 하위 도메인은 포함하지 않으며 개선 대상과 비교 대상의 성과 집계로 사용하지 않습니다.`,
      `날짜는 GA4 속성 시간대(${timeZone}) 기준입니다. UTC로 작성한 검증 계획의 전후 비교값과 구분합니다.`,
      'AI 유입은 지정된 AI 서비스 도메인이 세션 출처에 남은 경우입니다. 직접 방문이나 출처가 사라진 유입은 포함되지 않을 수 있습니다.',
      '0은 요청 조건에 맞는 GA4 기록이 없다는 뜻입니다. 계측 누락이나 동의하지 않은 방문까지 없었다는 뜻은 아닙니다.',
      '전환 세션, 주문과 매출은 이 요청으로 측정하지 않으며 미측정으로 남깁니다. GA4 데이터는 처리 지연으로 변경될 수 있습니다.',
    ];
    if (endDate !== requestedEndDate) notes.push('기준 기간이 진행 중이어서 GA4 속성 시간대의 어제까지만 가져왔습니다.');
    if (dataQuality.subjectToThresholding || dataQuality.dataLossFromOtherRow || dataQuality.sampled || dataQuality.truncated || dataQuality.emptyReasons.length) notes.push('GA4 응답에 데이터 품질 제한이 있습니다. 임계치, 샘플링, 데이터 누락과 빈 응답 사유를 확인하세요.');
    const payload: import('./impact-baseline-types').ImpactBaselinePayload = { source: 'ga4_api', metricVersion: 'ga4-baseline-v1', propertyId: row.property_id, propertyName: typeof property.displayName === 'string' ? property.displayName.slice(0, 200) : row.property_name || row.property_id, fetchedAt: isoNow(), requestedStartDate, requestedEndDate, startDate, endDate, timeZone, hostName, totalSessions, aiSessions, totalViews, convertingSessions: null, orders: null, revenueMinor: null, sourcePattern: AI_SOURCE_PATTERN, scope: 'tracked_site_sessions', completeForPlan: false, dataQuality, notes };
    const current = await connection(ownerId, siteId);
    if (!current || current.status !== 'connected' || current.property_id !== row.property_id || current.revision !== row.revision || current.lease_token !== lease || current.lease_until <= Date.now()) throw new ProductError(409, '조회 중 GA4 연결이 변경되어 새 자료를 저장하지 않았어요.', 'integration_changed');
    // Saving while the existing connection lease is held also prevents overlapping imports.
    return save ? save(payload, { lease, revision: row.revision, propertyId: row.property_id }) : payload as T;
  }, true);
}
