/** Public landing-only analytics. This module never reads account or workspace state. */
export const ANALYTICS_ID = 'G-3Q9BXQLQ4H';
export const ANALYTICS_HOST = 'lumen-ai-visibility.khyun97.chatgpt.site';
export const CONSENT_KEY = 'lumen.analytics-consent.v1';
export const CONSENT_MAX_AGE_MS = 180 * 86400000;
export type AnalyticsConsent = 'granted' | 'denied';
export type ConsentRecord = { version: 1; value: AnalyticsConsent; updatedAt: number };
const DENIED = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', personalization_storage: 'denied' };
export function parseConsent(raw: string | null, time = Date.now()): AnalyticsConsent | null {
  if (!raw) return null;
  try { const data = JSON.parse(raw) as Partial<ConsentRecord>; return data.version === 1 && (data.value === 'granted' || data.value === 'denied') && typeof data.updatedAt === 'number' && data.updatedAt <= time && time - data.updatedAt < CONSENT_MAX_AGE_MS ? data.value : null; } catch { return null; }
}
export function serializeConsent(value: AnalyticsConsent, time = Date.now()): string { return JSON.stringify({ version: 1, value, updatedAt: time } satisfies ConsentRecord); }
export function analyticsAllowed(location: Pick<Location, 'protocol' | 'hostname' | 'pathname' | 'port'>, production: boolean): boolean { return production && location.protocol === 'https:' && location.hostname === ANALYTICS_HOST && !location.port && location.pathname === '/'; }
export function safeReferrer(value: string): string { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin + '/' : ''; } catch { return ''; } }
export function landingPageFields(origin: string, referrer: string) { return { page_location: origin + '/', page_referrer: safeReferrer(referrer), page_title: 'Lumen — AI 검색 관찰', allow_google_signals: false, allow_ad_personalization_signals: false, campaign_id: '', campaign_name: '', campaign_source: '', campaign_medium: '', campaign_term: '', campaign_content: '' }; }
type AnalyticsWindow = Window & { dataLayer?: IArguments[]; [key: `ga-disable-${string}`]: boolean | undefined };
/** No script, cookie, or network work occurs until explicit consent reaches apply('granted'). */
export function createLandingAnalytics(window: Window, document: Document, production: boolean) {
  const target = window as AnalyticsWindow;
  const disableKey = `ga-disable-${ANALYTICS_ID}` as const;
  let initialized = false, pageViewQueued = false, script: HTMLScriptElement | null = null;
  target[disableKey] = true;
  function tag(...args: unknown[]) { void args; target.dataLayer!.push(arguments); }
  function removeAnalyticsCookies() {
    for (const item of document.cookie.split(';')) { const name = item.split('=')[0].trim(); if (/^lumen_ga(?:_|$)/.test(name)) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`; }
  }
  function stop(clearCookies = false) {
    target[disableKey] = true;
    if (initialized) tag('consent', 'update', DENIED);
    if (clearCookies) removeAnalyticsCookies();
  }
  function apply(consent: AnalyticsConsent | null): boolean {
    if (consent !== 'granted' || !analyticsAllowed(window.location, production)) { stop(consent === 'denied'); return false; }
    target[disableKey] = false;
    if (!initialized) {
      // Commands are queued before loading Google, with advertising consent always denied.
      target.dataLayer = [];
      tag('consent', 'default', DENIED);
      tag('consent', 'update', { ...DENIED, analytics_storage: 'granted' });
      const fields = landingPageFields(window.location.origin, document.referrer);
      tag('set', { ...fields, send_page_view: false, ads_data_redaction: true, url_passthrough: false, user_id: null });
      tag('js', new Date());
      tag('config', ANALYTICS_ID, { ...fields, send_page_view: false, cookie_domain: 'none', cookie_prefix: 'lumen', cookie_expires: 0, cookie_update: false, cookie_flags: 'SameSite=Lax;Secure' });
      initialized = true;
    } else tag('consent', 'update', { ...DENIED, analytics_storage: 'granted' });
    if (!pageViewQueued) { tag('event', 'page_view', { ...landingPageFields(window.location.origin, document.referrer), send_to: ANALYTICS_ID }); pageViewQueued = true; }
    if (!script) { script = document.createElement('script'); script.id = 'lumen-analytics-tag'; script.async = true; script.referrerPolicy = 'no-referrer'; script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`; document.head.appendChild(script); }
    return true;
  }
  // Stop synchronously before a normal link leaves the landing page. A new document
  // never loads this component on dashboard/account routes; cleanup covers SPA unmounts.
  function leaving(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    try { const destination = new URL(anchor.href, window.location.href); if (destination.origin !== window.location.origin || destination.pathname !== '/') stop(); } catch { stop(); }
  }
  const pageHide = () => stop();
  document.addEventListener('click', leaving, true);
  window.addEventListener('pagehide', pageHide);
  return { apply, stop, dispose() { stop(); if(script){script.remove();script=null;} document.removeEventListener('click', leaving, true); window.removeEventListener('pagehide', pageHide); } };
}
