import type { SecurityCheck, SecurityEvidence } from '../../lib/security-types';
import { SECURITY_REQUEST_BYTES } from '../../lib/security-types';
import { securityEvidenceSchema } from '../../lib/security-validation';

/** Display metadata is untrusted; never interpolate it directly into a shell command. */
export function securityOriginForDomain(domain: string): string | null {
  try {
    const value = domain.trim();
    if (!value || /[\s\\]/.test(value)) return null;
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return null;
    if (!/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(url.hostname)) return null;
    if (/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/i.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function securityCollectorCommand(domain: string): string | null {
  const origin = securityOriginForDomain(domain);
  if (!origin) return null;
  const quoted = `'${origin.replaceAll("'", "'\\''")}'`;
  return `node scripts/collect-security-evidence.mjs --origin ${quoted} --authorized --output ./lumen-web-check.json`;
}

export function prepareSecurityImport(raw: string, origin: string): SecurityEvidence {
  if (new TextEncoder().encode(raw).byteLength > SECURITY_REQUEST_BYTES) throw new Error('파일은 32 KiB 이하여야 해요. 수집 도구가 만든 JSON 파일을 선택하세요.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('JSON 파일을 읽지 못했어요. 수집 도구가 만든 파일을 그대로 선택하세요.'); }
  const result = securityEvidenceSchema.safeParse(value);
  if (!result.success) throw new Error('지원하는 수집 결과 형식이 아니에요. 최신 수집 도구로 다시 확인해 주세요.');
  if (result.data.targetOrigin !== origin) throw new Error('현재 브랜드의 HTTPS 주소와 다른 결과예요. 브랜드와 파일의 주소를 확인하세요.');
  if (Date.parse(result.data.observedAt) > Date.now()) throw new Error('관측 시각이 현재보다 나중이에요. 수집한 컴퓨터의 시간을 확인하세요.');
  return result.data;
}

/** Imported order is not observed order. A different origin/version cannot become a baseline. */
export function latestSecurityChecks(checks: SecurityCheck[]) {
  const sorted = [...checks].sort((a, b) => Date.parse(b.evidence.observedAt) - Date.parse(a.evidence.observedAt) || b.createdAt.localeCompare(a.createdAt));
  const latest = sorted[0];
  const previous = latest && sorted.find(check => check.id !== latest.id && check.siteId === latest.siteId && check.evidence.targetOrigin === latest.evidence.targetOrigin && check.evidence.collector === latest.evidence.collector && check.evidence.schemaVersion === latest.evidence.schemaVersion && Date.parse(check.evidence.observedAt) < Date.parse(latest.evidence.observedAt));
  return { latest, previous };
}

/** Exports observations without workspace IDs, task IDs or account metadata. */
export function securityReport(check: SecurityCheck, previous?: SecurityCheck) {
  const observation = (row: SecurityCheck) => ({ evidence: row.evidence, digest: row.digest, findings: row.findings });
  return { reportVersion: 1, provenance: 'user_supplied', scope: 'public_web_configuration', latest: observation(check), ...(previous ? { previous: observation(previous) } : {}) };
}
