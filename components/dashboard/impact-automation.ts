import { impactSearchSchema, assertSearchMatchesPlan } from '../../lib/impact-validation';
import type { ImpactArm, ImpactSearch, ImpactSearchInput, ImpactStudy } from '../../lib/impact-types';

export const IMPACT_IMPORT_BYTES = 64 * 1024;
export const IMPACT_IMPORT_ROWS = 20;
export type ImpactImportRow = { requestId: string; observation: ImpactSearchInput; saved: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only structured observations are imported; prose is never interpreted as evidence. */
export function prepareImpactImport(raw: string, study: ImpactStudy, createId: () => string = () => crypto.randomUUID(), timestamp = Date.now()): ImpactImportRow[] {
  if (new TextEncoder().encode(raw).byteLength > IMPACT_IMPORT_BYTES) throw new Error('JSON은 64 KiB 이하로 나누어 가져오세요.');
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error('JSON 형식을 확인하세요. 전체 내용을 {"observations": [...]} 형태로 입력해 주세요.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !('observations' in input) || !Array.isArray(input.observations)) throw new Error('최상위에는 observations 배열만 넣어 주세요.');
  if (!input.observations.length || input.observations.length > IMPACT_IMPORT_ROWS) throw new Error('한 번에 1~20개의 검색 관측을 가져올 수 있어요.');
  const cells = new Set<string>(), ids = new Set<string>();
  return input.observations.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${index + 1}번째 관측은 JSON 객체여야 해요.`);
    const { requestId: providedId, ...observation } = value as Record<string, unknown>;
    if (providedId !== undefined && (typeof providedId !== 'string' || !uuid.test(providedId))) throw new Error(`${index + 1}번째 requestId는 UUID여야 해요.`);
    const parsed = impactSearchSchema.safeParse(observation);
    if (!parsed.success) throw new Error(`${index + 1}번째 관측: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '내용'}: ${issue.message}`).join(' / ')}`);
    try { assertSearchMatchesPlan(study.plan, parsed.data, timestamp); } catch (cause) { throw new Error(`${index + 1}번째 관측: ${(cause as Error).message}`); }
    const cell = `${parsed.data.phase}/${parsed.data.queryId}/${parsed.data.repetition}`;
    if (cells.has(cell)) throw new Error(`${index + 1}번째 관측은 같은 질문, 기간과 회차가 중복돼요.`);
    cells.add(cell);
    const requestId = providedId as string | undefined ?? createId();
    if (ids.has(requestId)) throw new Error(`${index + 1}번째 requestId가 중복돼요.`);
    ids.add(requestId);
    return { requestId, observation: parsed.data, saved: false };
  });
}

/** Keep row IDs after an ambiguous failure; retries use the server's idempotency check. */
export async function saveImpactImport<T>(rows: ImpactImportRow[], save: (row: ImpactImportRow) => Promise<T>, onSaved: (value: T, rows: ImpactImportRow[]) => void) {
  const next = rows.map(row => ({ ...row }));
  for (let index = 0; index < next.length; index++) {
    if (next[index].saved) continue;
    try {
      const result = await save(next[index]);
      next[index].saved = true;
      onSaved(result, next.map(row => ({ ...row })));
    } catch (cause) {
      return { rows: next, error: `${index + 1}번째 관측에서 멈췄어요. ${(cause as Error).message}` };
    }
  }
  return { rows: next, error: '' };
}

export function beforeSearchBaseline(study: ImpactStudy, records: ImpactSearch[]) {
  const result = {} as Record<ImpactArm, { planned: number; recorded: number; confirmedAnswers: number; mention: { numerator: number; denominator: number; rate: number | null }; citation: { numerator: number; denominator: number; rate: number | null } }>;
  const own = study.brand.domain.toLowerCase().replace(/^www\./, '');
  const rate = (numerator: number, denominator: number) => ({ numerator, denominator, rate: denominator ? numerator / denominator * 100 : null });
  for (const arm of ['treatment', 'control'] as const) {
    const queryIds = new Set(study.plan.queries.filter(query => query.arm === arm).map(query => query.id));
    const rows = records.filter(row => !row.voidedAt && row.phase === 'before' && queryIds.has(row.queryId));
    const confirmed = rows.filter(row => row.result === 'answer' && row.searchConfirmed);
    const mentions = confirmed.filter(row => row.brandMention !== 'uncertain'), citations = confirmed.filter(row => row.citationReview === 'complete');
    result[arm] = { planned: queryIds.size * study.plan.repetitions, recorded: rows.length, confirmedAnswers: confirmed.length, mention: rate(mentions.filter(row => row.brandMention === 'present').length, mentions.length), citation: rate(citations.filter(row => row.citations.some(citation => {
      if (citation.relation !== 'original_citation') return false;
      try { const host = new URL(citation.url).hostname.toLowerCase().replace(/^www\./, ''); return host === own || host.endsWith(`.${own}`); } catch { return false; }
    })).length, citations.length) };
  }
  return result;
}
