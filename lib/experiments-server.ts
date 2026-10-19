import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { competitors, runs, answers } from '@/db/schema';
import { improvementExperiments } from '@/db/experiments-schema';
import { now, ownedSite, publicAnswer, uid } from './product-server';
import { ProductError } from './product-validation';
import { citationMetricAvailable, compareExperiment, snapshotAnswers } from './experiment-metrics';
import { EXPERIMENT_METRIC_VERSION, type ExperimentSnapshot, type ImprovementExperiment } from './experiment-types';

export const experimentInput = z.object({
  siteId: z.string().uuid(), title: z.string().trim().min(3).max(200), hypothesis: z.string().trim().min(5).max(2000),
  intervention: z.string().trim().min(3).max(2000), metric: z.enum(['mentionRate', 'citationRate']),
  targetDelta: z.number().int().min(1).max(100), baselineRunId: z.string().uuid(),
}).strict();
export const experimentPatch = z.object({ siteId: z.string().uuid(), id: z.string().uuid(), expectedUpdatedAt: z.string().datetime(),
  status: z.enum(['draft', 'observing', 'reviewed']).optional(), followupRunId: z.string().uuid().optional(), notes: z.string().trim().max(4000).optional(),
}).strict().refine(value => value.status !== undefined || value.followupRunId !== undefined || value.notes !== undefined);

function publicExperiment(row: typeof improvementExperiments.$inferSelect): ImprovementExperiment {
  const baselineSnapshot = JSON.parse(row.baselineSnapshot) as ExperimentSnapshot;
  const followupSnapshot = row.followupSnapshot ? JSON.parse(row.followupSnapshot) as ExperimentSnapshot : null;
  return { ...row, baselineSnapshot, followupSnapshot, comparison: followupSnapshot ? compareExperiment(baselineSnapshot, followupSnapshot, row.metric, row.targetDelta) : null };
}
async function readRun(siteId: string, runId: string) {
  const db = getDb();
  const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.siteId, siteId))).limit(1);
  if (!run) throw new ProductError(404, '이 워크스페이스의 수집을 선택해 주세요.', 'not_found');
  if (!['completed', 'partial', 'failed'].includes(run.status)) throw new ProductError(409, '진행 중인 수집은 비교할 수 없어요.', 'experiment_run_incomplete');
  const rows = await db.select().from(answers).where(and(eq(answers.siteId, siteId), eq(answers.runId, runId))).limit(61);
  if (rows.length !== run.total) throw new ProductError(409, '수집의 전체 답변을 확인할 수 없어요.', 'experiment_run_incomplete');
  return { run, answers: rows.map(publicAnswer) };
}
export async function getExperiments(ownerId: string, siteId: string) {
  await ownedSite(siteId, ownerId);
  const rows = await getDb().select().from(improvementExperiments).where(eq(improvementExperiments.siteId, siteId)).orderBy(desc(improvementExperiments.createdAt)).limit(100);
  return { experiments: rows.map(publicExperiment), metricVersion: EXPERIMENT_METRIC_VERSION };
}
export async function createExperiment(ownerId: string, input: z.infer<typeof experimentInput>) {
  const site = await ownedSite(input.siteId, ownerId), db = getDb();
  const [{ run, answers: rows }, rivals] = await Promise.all([readRun(site.id, input.baselineRunId), db.select({ name: competitors.name, domain: competitors.domain }).from(competitors).where(eq(competitors.siteId, site.id)).limit(20)]);
  if (run.mode !== site.mode) throw new ProductError(409, '실제 데이터와 샘플 데이터는 함께 비교할 수 없어요.', 'experiment_mode_mismatch');
  const snapshot = snapshotAnswers(rows, [{ name: site.name, domain: site.domain }, ...rivals], run.mode);
  if (input.metric === 'citationRate' && !citationMetricAvailable(snapshot)) throw new ProductError(409, '이 모델은 검색 인용을 제공하지 않아요. 언급률을 선택해 주세요.', 'experiment_citation_unavailable');
  const date = now(), id = uid();
  // Atomic bounded insert avoids concurrent requests exceeding the workspace record cap.
  await db.run(sql`INSERT INTO improvement_experiments (id,site_id,title,hypothesis,intervention,metric,target_delta,status,baseline_run_id,baseline_snapshot,notes,created_at,updated_at)
    SELECT ${id},${site.id},${input.title},${input.hypothesis},${input.intervention},${input.metric},${input.targetDelta},'draft',${input.baselineRunId},${JSON.stringify(snapshot)},'',${date},${date}
    WHERE (SELECT count(*) FROM improvement_experiments WHERE site_id=${site.id}) < 100`);
  const [saved] = await db.select().from(improvementExperiments).where(eq(improvementExperiments.id, id));
  if (!saved) throw new ProductError(409, '워크스페이스당 실험은 최대 100개까지 저장할 수 있어요.', 'experiment_limit');
  return publicExperiment(saved);
}
export async function updateExperiment(ownerId: string, input: z.infer<typeof experimentPatch>) {
  await ownedSite(input.siteId, ownerId); const db = getDb();
  const [row] = await db.select().from(improvementExperiments).where(and(eq(improvementExperiments.siteId, input.siteId), eq(improvementExperiments.id, input.id))).limit(1);
  if (!row) throw new ProductError(404, '실험을 찾을 수 없어요.', 'not_found');
  const patch: Partial<typeof improvementExperiments.$inferInsert> = { updatedAt: new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString() };
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.followupRunId) {
    if (input.followupRunId === row.baselineRunId) throw new ProductError(409, '기준 이후에 수집한 다른 결과를 선택해 주세요.', 'experiment_same_run');
    const [before, after] = await Promise.all([readRun(input.siteId, row.baselineRunId), readRun(input.siteId, input.followupRunId)]);
    if (Date.parse(after.run.createdAt) <= Date.parse(before.run.completedAt || before.run.createdAt)) throw new ProductError(409, '기준 수집이 끝난 이후의 결과를 선택해 주세요.', 'experiment_run_order');
    const baseline = JSON.parse(row.baselineSnapshot) as ExperimentSnapshot;
    const followup = snapshotAnswers(after.answers, baseline.brands, after.run.mode);
    compareExperiment(baseline, followup, row.metric, row.targetDelta);
    patch.followupRunId = input.followupRunId; patch.followupSnapshot = JSON.stringify(followup);
  }
  if (input.status === 'reviewed' && !(patch.followupSnapshot || row.followupSnapshot)) throw new ProductError(409, '전후 결과를 연결한 뒤 검토 완료로 표시해 주세요.', 'experiment_evidence_required');
  if (input.status) patch.status = input.status;
  const saved = await db.update(improvementExperiments).set(patch).where(and(eq(improvementExperiments.id, row.id), eq(improvementExperiments.siteId, input.siteId), eq(improvementExperiments.updatedAt, input.expectedUpdatedAt))).returning();
  if (!saved.length) throw new ProductError(409, '다른 화면에서 실험이 변경됐어요. 새로고침 후 다시 시도해 주세요.', 'experiment_conflict');
  return publicExperiment(saved[0]);
}
