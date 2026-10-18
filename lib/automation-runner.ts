import { env } from 'cloudflare:workers';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import * as t from '@/db/schema';
import { now, ownedSite, uid } from './product-server';
import { createRun, processRun } from './product-jobs';
import { ProductError } from './product-validation';
import { nextOccurrence } from './automation-time';
import { alert, audit, ownedSchedule, publicExecution } from './operations-server';
import type { ScheduleRow } from './operations-server';
import type { AutomationTickResult } from './operations-types';

type Execution=typeof t.scheduledExecutions.$inferSelect;
type Configuration={models:string[];promptIds:string[]|null};
const scope=(column:typeof t.scheduledExecutions.ownerId,ownerId?:string)=>ownerId?eq(column,ownerId):undefined;
function binding(){if(!env.DB)throw new ProductError(503,'운영 데이터베이스가 연결되지 않았습니다.','database_unavailable');return env.DB;}
function safeFailure(error:unknown):{code:string;message:string;blocked:boolean;retry:boolean}{
  const code=error instanceof ProductError?error.code:'collection_error';
  const known:Record<string,string>={ai_usage_exhausted:'무료 AI 사용 한도에 도달했습니다. 다음 UTC 한도 초기화 이후의 일정에서 다시 수집합니다.',provider_unavailable:'선택한 AI 제공자가 연결되지 않았습니다. 서버 연결 상태를 확인하세요.',run_size:'활성 질문 수가 수집 범위를 벗어났습니다. 질문을 선택하거나 일정을 수정하세요.',invalid_prompt:'일정에 지정된 질문이 삭제되었거나 비활성화되었습니다.',run_in_progress:'기존 수집이 끝난 뒤 이 일정을 이어서 처리합니다.',run_locked:'다른 수집기가 이 실행을 처리하고 있습니다.',run_lease_changed:'다른 수집기가 처리를 이어받았습니다.',not_found:'워크스페이스 또는 실행을 찾을 수 없습니다.',quota_exceeded:'작업 횟수 한도에 도달했습니다. 다음 수집 일정을 확인하세요.'};
  return {code:known[code]?code:'collection_error',message:known[code]||'수집을 완료하지 못했습니다. 실행 기록과 제공자 연결을 확인하세요.',blocked:['ai_usage_exhausted','quota_exceeded'].includes(code),retry:['run_in_progress','run_locked','run_lease_changed'].includes(code)};
}
function configuration(schedule:ScheduleRow):Configuration{return {models:JSON.parse(schedule.models),promptIds:schedule.promptIds?JSON.parse(schedule.promptIds):null};}

/** Schedule claiming and occurrence insertion commit in one D1 transaction. */
async function enqueueOccurrence(schedule:ScheduleRow,scheduledFor:number,advance:boolean){
  const id=uid(),date=now(),config=JSON.stringify(configuration(schedule)),db=binding();
  const predicate=advance?'AND enabled=1 AND next_run_at=?':'';
  const insert=db.prepare(`INSERT INTO scheduled_executions (id,owner_id,site_id,schedule_id,schedule_name,scheduled_for,status,configuration,attempts,completed,failed,total,lease_until,next_attempt_at,created_at,updated_at) SELECT ?,owner_id,site_id,id,name,?,'queued',?,0,0,0,0,0,?,?,? FROM collection_schedules WHERE id=? AND owner_id=? AND deleted_at IS NULL ${predicate} ON CONFLICT(schedule_id,scheduled_for) DO NOTHING`).bind(id,scheduledFor,config,Date.now(),date,date,schedule.id,schedule.ownerId,...(advance?[scheduledFor]:[]));
  if(advance){const next=nextOccurrence({...schedule,weekdays:JSON.parse(schedule.weekdays)},Math.max(Date.now(),scheduledFor));await db.batch([insert,db.prepare('UPDATE collection_schedules SET next_run_at=?,updated_at=? WHERE id=? AND owner_id=? AND enabled=1 AND next_run_at=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM scheduled_executions WHERE schedule_id=? AND scheduled_for=?)').bind(next,date,schedule.id,schedule.ownerId,scheduledFor,schedule.id,scheduledFor)]);}else await insert.run();
  const [execution]=await getDb().select().from(t.scheduledExecutions).where(and(eq(t.scheduledExecutions.scheduleId,schedule.id),eq(t.scheduledExecutions.ownerId,schedule.ownerId),eq(t.scheduledExecutions.scheduledFor,scheduledFor))).limit(1);
  return {execution,created:execution?.id===id};
}
export async function enqueueManualSchedule(ownerId:string,siteId:string,scheduleId:string){const schedule=await ownedSchedule(ownerId,siteId,scheduleId);const result=await enqueueOccurrence(schedule,Math.floor(Date.now()/60000)*60000,false);if(!result.execution)throw new ProductError(409,'일정 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.','schedule_changed');if(result.created)await audit(ownerId,siteId,'schedule_run_requested',result.execution.id,'일정을 즉시 실행하도록 요청했습니다.');return publicExecution(result.execution);}
async function enqueueDue(ownerId?:string){const db=getDb(),due=await db.select().from(t.collectionSchedules).where(and(eq(t.collectionSchedules.enabled,true),isNull(t.collectionSchedules.deletedAt),lte(t.collectionSchedules.nextRunAt,Date.now()),ownerId?eq(t.collectionSchedules.ownerId,ownerId):undefined)).orderBy(asc(t.collectionSchedules.nextRunAt)).limit(10);let created=0;for(const schedule of due){const result=await enqueueOccurrence(schedule,schedule.nextRunAt,true);if(result.created){created++;await audit(schedule.ownerId,schedule.siteId,'scheduled_execution_queued',result.execution.id,'예정된 정기 수집을 대기열에 등록했습니다. 누락된 과거 일정은 한 번만 처리합니다.');}}return created;}

async function closeUnfinishedRun(siteId:string,runId:string,message:string){
  const db=getDb(),[run]=await db.select().from(t.runs).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,siteId),inArray(t.runs.status,['queued','running']),lte(t.runs.leaseUntil,Date.now()))).limit(1);if(!run)return null;
  const fence=sql`EXISTS (SELECT 1 FROM runs WHERE id=${runId} AND site_id=${siteId} AND lease_until<=${Date.now()} AND status IN ('queued','running'))`;
  await db.update(t.answers).set({status:'failed',error:message,completedAt:now()}).where(and(eq(t.answers.runId,runId),eq(t.answers.siteId,siteId),inArray(t.answers.status,['pending','processing']),fence));
  const rows=await db.select({status:t.answers.status}).from(t.answers).where(and(eq(t.answers.runId,runId),eq(t.answers.siteId,siteId)));const completed=rows.filter(a=>a.status==='completed').length,failed=rows.filter(a=>a.status==='failed').length;
  if(completed+failed!==run.total)return null;
  const [updated]=await db.update(t.runs).set({status:completed?'partial':'failed',completed,failed,error:message,completedAt:now(),leaseToken:null,leaseUntil:0}).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,siteId),inArray(t.runs.status,['queued','running']),lte(t.runs.leaseUntil,Date.now()))).returning();return updated||null;
}

async function processExecution(execution:Execution){
  const db=getDb(),token=uid(),date=now();const [claimed]=await db.update(t.scheduledExecutions).set({status:'running',leaseToken:token,leaseUntil:Date.now()+120000,attempts:sql`${t.scheduledExecutions.attempts}+1`,updatedAt:date}).where(and(eq(t.scheduledExecutions.id,execution.id),eq(t.scheduledExecutions.ownerId,execution.ownerId),inArray(t.scheduledExecutions.status,['queued','running']),lte(t.scheduledExecutions.leaseUntil,Date.now()),lte(t.scheduledExecutions.nextAttemptAt,Date.now()))).returning();if(!claimed)return {status:'locked' as const,runId:null};
  const fence=and(eq(t.scheduledExecutions.id,execution.id),eq(t.scheduledExecutions.ownerId,execution.ownerId),eq(t.scheduledExecutions.leaseToken,token));
  try{
    const site=await ownedSite(execution.siteId,execution.ownerId),config=JSON.parse(execution.configuration) as Configuration;
    // The execution UUID is also its immutable run UUID. A crash between create and link cannot create a second paid run.
    const run=await createRun(site,{mode:'live',models:config.models,...(config.promptIds?{promptIds:config.promptIds}:{})},{idempotencyKey:execution.id});
    const linked=await db.update(t.scheduledExecutions).set({runId:run.id,total:run.total,updatedAt:now()}).where(fence).returning({id:t.scheduledExecutions.id});if(!linked.length)return {status:'locked' as const,runId:run.id};
    const result=await processRun(site,run.id),terminal=!['queued','running'].includes(result.run.status);
    const [updated]=await db.update(t.scheduledExecutions).set({status:terminal?result.run.status as 'completed'|'partial'|'failed':'running',completed:result.run.completed,failed:result.run.failed,total:result.run.total,completedAt:terminal?now():null,updatedAt:now(),leaseUntil:0,leaseToken:null,nextAttemptAt:0,errorCode:result.run.failed?'answer_collection_failed':null,message:result.run.failed?'일부 답변을 수집하지 못했습니다. 답변별 오류를 확인하세요.':null}).where(fence).returning();
    if(!updated)return {status:'locked' as const,runId:run.id};
    if(execution.scheduleId)await db.update(t.collectionSchedules).set({lastRunAt:Date.now(),lastStatus:updated.status,updatedAt:now()}).where(and(eq(t.collectionSchedules.id,execution.scheduleId),eq(t.collectionSchedules.ownerId,execution.ownerId)));
    if(terminal){await audit(execution.ownerId,execution.siteId,`scheduled_execution_${updated.status}`,execution.id,updated.status==='completed'?'정기 수집을 완료했습니다.':'정기 수집이 끝났습니다. 수집되지 않은 답변을 확인하세요.');if(updated.status!=='completed')await alert(execution.ownerId,execution.siteId,execution.id,'answer_collection_failed','수집 결과 확인이 필요합니다','일부 답변이 실패했습니다. 다시 수집하면 새로운 사용량이 예약됩니다.');else await db.update(t.operationAlerts).set({status:'resolved',updatedAt:now()}).where(and(eq(t.operationAlerts.ownerId,execution.ownerId),eq(t.operationAlerts.executionId,execution.id),eq(t.operationAlerts.code,'execution_stalled')));}
    return {status:updated.status,runId:run.id};
  }catch(error){const issue=safeFailure(error),closed=issue.retry?null:await closeUnfinishedRun(execution.siteId,execution.id,issue.message);const status=issue.retry?'running':issue.blocked?'blocked':closed?.status==='partial'?'partial':'failed';const [updated]=await db.update(t.scheduledExecutions).set({status,...(closed?{runId:closed.id,total:closed.total,completed:closed.completed,failed:closed.failed}:{}),errorCode:issue.code,message:issue.message,leaseToken:null,leaseUntil:0,nextAttemptAt:issue.retry?Date.now()+120000:0,updatedAt:now(),completedAt:issue.retry?null:now()}).where(fence).returning();if(!updated)return {status:'locked' as const,runId:execution.runId};if(!issue.retry){await alert(execution.ownerId,execution.siteId,execution.id,issue.code,issue.blocked?'무료 사용 한도에 도달했습니다':'정기 수집을 완료하지 못했습니다',issue.message,issue.blocked?'warning':'critical');await audit(execution.ownerId,execution.siteId,`scheduled_execution_${status}`,execution.id,issue.message);if(execution.scheduleId)await db.update(t.collectionSchedules).set({lastStatus:status,lastRunAt:Date.now(),updatedAt:now()}).where(and(eq(t.collectionSchedules.id,execution.scheduleId),eq(t.collectionSchedules.ownerId,execution.ownerId)));}return {status,runId:closed?.id||execution.runId};}
}
async function observeStalled(ownerId?:string){const stuck=await getDb().select().from(t.scheduledExecutions).where(and(inArray(t.scheduledExecutions.status,['queued','running']),lte(t.scheduledExecutions.leaseUntil,Date.now()),lte(t.scheduledExecutions.updatedAt,new Date(Date.now()-30*60000).toISOString()),scope(t.scheduledExecutions.ownerId,ownerId))).limit(20);for(const e of stuck)await alert(e.ownerId,e.siteId,e.id,'execution_stalled','수집이 지연되고 있습니다','30분 이상 진행 기록이 없어 서버 수집기가 남은 작업을 이어서 처리합니다. 이미 요청한 답변을 자동 재청구하지 않습니다.');}

/** Trusted-server entry point. MCP callers MUST pass their authenticated ownerId; only the narrow secret route may omit it. */
export async function tickDueSchedules(options:{ownerId?:string;limit?:number;executionId?:string}={}):Promise<AutomationTickResult>{
  if(options.ownerId!==undefined&&!options.ownerId)throw new ProductError(401,'인증된 소유자 정보가 필요합니다.','unauthenticated');
  const limit=Math.min(2,Math.max(1,options.limit||1)),db=getDb(),tickId=uid(),key=options.ownerId?`owner:${options.ownerId}`:'service',token=uid(),date=now();
  const heartbeat=await db.insert(t.operationHeartbeats).values({id:key,ownerId:options.ownerId||null,leaseToken:token,leaseUntil:Date.now()+120000,lastStartedAt:date,lastTickId:tickId}).onConflictDoUpdate({target:t.operationHeartbeats.id,set:{leaseToken:token,leaseUntil:Date.now()+120000,lastStartedAt:date,lastTickId:tickId},setWhere:lte(t.operationHeartbeats.leaseUntil,Date.now())}).returning();
  const result:AutomationTickResult={tickId,queued:0,processed:0,completed:0,failed:0,blocked:0,continuation:false,retryAfterSeconds:0,skipped:!heartbeat.length,executionIds:[],runIds:[]};
  if(!heartbeat.length)return {...result,continuation:true,retryAfterSeconds:120};
  try{
    await observeStalled(options.ownerId);
    // Browser-created runs already reserved their budget. Resume their pending answers before starting new scheduled work.
    const manual=options.executionId?[]:await db.select({run:t.runs,site:t.sites}).from(t.runs).innerJoin(t.sites,eq(t.runs.siteId,t.sites.id)).where(and(eq(t.runs.mode,'live'),inArray(t.runs.status,['queued','running']),lte(t.runs.leaseUntil,Date.now()),options.ownerId?eq(t.sites.ownerId,options.ownerId):undefined,sql`NOT EXISTS (SELECT 1 FROM scheduled_executions WHERE scheduled_executions.id=${t.runs.id} OR scheduled_executions.run_id=${t.runs.id})`)).orderBy(asc(t.runs.createdAt)).limit(limit);
    const manualResults=await Promise.all(manual.map(async({run,site})=>{try{const r=await processRun(site,run.id);if(['failed','partial'].includes(r.run.status))await alert(site.ownerId,site.id,null,'manual_collection_failed','수집 결과 확인이 필요합니다','브라우저에서 시작한 수집을 서버가 이어서 처리했습니다. 실패한 답변을 확인하세요.','warning',`manual_collection_failed:${run.id}`);return {runId:run.id,status:r.run.status};}catch(error){const issue=safeFailure(error);if(!issue.retry){await closeUnfinishedRun(site.id,run.id,issue.message);await alert(site.ownerId,site.id,null,issue.code,'수집을 이어서 처리하지 못했습니다',issue.message,'warning',`manual:${run.id}:${issue.code}`);}return {runId:run.id,status:issue.retry?'running':'failed'};}}));
    for(const r of manualResults){result.processed++;result.runIds.push(r.runId);if(r.status==='completed')result.completed++;if(['partial','failed'].includes(r.status))result.failed++;}
    result.queued=await enqueueDue(options.ownerId);
    if(result.processed<limit){const pending=await db.select().from(t.scheduledExecutions).where(and(inArray(t.scheduledExecutions.status,['queued','running']),lte(t.scheduledExecutions.leaseUntil,Date.now()),lte(t.scheduledExecutions.nextAttemptAt,Date.now()),scope(t.scheduledExecutions.ownerId,options.ownerId),options.executionId?eq(t.scheduledExecutions.id,options.executionId):undefined)).orderBy(asc(t.scheduledExecutions.createdAt)).limit(limit-result.processed);const outcomes=await Promise.all(pending.map(processExecution));outcomes.forEach((r,i)=>{if(r.status!=='locked'){result.processed++;result.executionIds.push(pending[i].id);if(r.runId)result.runIds.push(r.runId);if(r.status==='completed')result.completed++;if(['partial','failed'].includes(r.status))result.failed++;if(r.status==='blocked')result.blocked++;}});}
    const [pendingExecution,pendingManual,due]=await Promise.all([
      db.select({id:t.scheduledExecutions.id}).from(t.scheduledExecutions).where(and(inArray(t.scheduledExecutions.status,['queued','running']),scope(t.scheduledExecutions.ownerId,options.ownerId))).limit(1),
      db.select({id:t.runs.id}).from(t.runs).innerJoin(t.sites,eq(t.runs.siteId,t.sites.id)).where(and(eq(t.runs.mode,'live'),inArray(t.runs.status,['queued','running']),options.ownerId?eq(t.sites.ownerId,options.ownerId):undefined)).limit(1),
      db.select({id:t.collectionSchedules.id}).from(t.collectionSchedules).where(and(eq(t.collectionSchedules.enabled,true),isNull(t.collectionSchedules.deletedAt),lte(t.collectionSchedules.nextRunAt,Date.now()),options.ownerId?eq(t.collectionSchedules.ownerId,options.ownerId):undefined)).limit(1),
    ]);
    result.continuation=!!(pendingExecution.length||pendingManual.length||due.length);result.retryAfterSeconds=result.continuation?(result.processed?2:120):0;
    await db.update(t.operationHeartbeats).set({leaseToken:null,leaseUntil:0,lastFinishedAt:now(),lastSuccessAt:now(),lastErrorCode:null}).where(and(eq(t.operationHeartbeats.id,key),eq(t.operationHeartbeats.leaseToken,token)));return result;
  }catch(error){await db.update(t.operationHeartbeats).set({leaseToken:null,leaseUntil:0,lastFinishedAt:now(),lastErrorCode:safeFailure(error).code}).where(and(eq(t.operationHeartbeats.id,key),eq(t.operationHeartbeats.leaseToken,token)));throw error;}
}
