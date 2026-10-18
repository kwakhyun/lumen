import { and, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import * as t from '@/db/schema';
import { now, ownedSite, uid } from './product-server';
import { ProductError } from './product-validation';
import { requireProvider } from './providers';
import { getUsageStatus } from './usage';
import { isValidTimeZone, nextOccurrence } from './automation-time';
import { automationSecretConfigured } from './operations-security';
import type { CollectionSchedule, OperationAlert, OperationAudit, OperationsState, ScheduledExecution } from './operations-types';
export const scheduleInput=z.object({siteId:z.string().uuid(),name:z.string().trim().min(1).max(80),enabled:z.boolean().default(true),frequency:z.enum(['daily','weekly']),timezone:z.string().max(80).refine(isValidTimeZone,'올바른 IANA 시간대를 입력하세요.'),hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59),weekdays:z.array(z.number().int().min(0).max(6)).max(7).default([]),models:z.array(z.string().max(80)).min(1).max(3),promptIds:z.array(z.string().uuid()).min(1).max(20).nullable().optional()}).strict();
export const schedulePatch=scheduleInput.omit({siteId:true}).partial().extend({siteId:z.string().uuid(),id:z.string().uuid()}).strict();
export type ScheduleRow=typeof t.collectionSchedules.$inferSelect;
export function publicSchedule(s:ScheduleRow):CollectionSchedule{return {id:s.id,siteId:s.siteId,name:s.name,enabled:s.enabled,frequency:s.frequency,timezone:s.timezone,hour:s.hour,minute:s.minute,weekdays:JSON.parse(s.weekdays),models:JSON.parse(s.models),promptIds:s.promptIds?JSON.parse(s.promptIds):null,nextRunAt:new Date(s.nextRunAt).toISOString(),lastRunAt:s.lastRunAt?new Date(s.lastRunAt).toISOString():null,lastStatus:s.lastStatus,createdAt:s.createdAt,updatedAt:s.updatedAt};}
export function publicExecution(e:typeof t.scheduledExecutions.$inferSelect):ScheduledExecution{return {id:e.id,scheduleId:e.scheduleId,siteId:e.siteId,scheduleName:e.scheduleName,scheduledFor:new Date(e.scheduledFor).toISOString(),status:e.status,runId:e.runId,attempts:e.attempts,completed:e.completed,failed:e.failed,total:e.total,errorCode:e.errorCode,message:e.message,createdAt:e.createdAt,updatedAt:e.updatedAt,completedAt:e.completedAt};}
function publicAlert(a:typeof t.operationAlerts.$inferSelect):OperationAlert{const {ownerId,dedupeKey,...safe}=a;void ownerId;void dedupeKey;return safe;}
export async function audit(ownerId:string,siteId:string,action:string,subjectId:string|null,summary:string){await getDb().insert(t.operationAudit).values({id:uid(),ownerId,siteId,action,subjectId,summary,createdAt:now()});}
export async function alert(ownerId:string,siteId:string,executionId:string|null,code:string,title:string,message:string,severity:'warning'|'critical'='warning',dedupeKey=`${code}:${executionId||siteId}`){const date=now();await getDb().insert(t.operationAlerts).values({id:uid(),ownerId,siteId,executionId,dedupeKey,severity,code,title,message,status:'open',createdAt:date,updatedAt:date}).onConflictDoNothing();}
export async function ownedSchedule(ownerId:string,siteId:string,id:string){await ownedSite(siteId,ownerId);const [s]=await getDb().select().from(t.collectionSchedules).where(and(eq(t.collectionSchedules.id,id),eq(t.collectionSchedules.ownerId,ownerId),eq(t.collectionSchedules.siteId,siteId),isNull(t.collectionSchedules.deletedAt))).limit(1);if(!s)throw new ProductError(404,'수집 일정을 찾을 수 없습니다.','not_found');return s;}
async function plannedUnits(siteId:string,promptIds:string[]|null,models:string[]){const active=await getDb().select({id:t.prompts.id}).from(t.prompts).where(and(eq(t.prompts.siteId,siteId),eq(t.prompts.active,true)));const selected=promptIds?active.filter(p=>promptIds.includes(p.id)):active;if(promptIds&&selected.length!==new Set(promptIds).size)throw new ProductError(400,'현재 워크스페이스의 활성 질문만 선택하세요.','invalid_prompt');if(!selected.length)throw new ProductError(400,'정기 수집에 사용할 활성 질문을 먼저 등록하세요.','no_active_prompts');return selected.length*new Set(models).size;}
async function validateSchedule(ownerId:string,input:z.infer<typeof scheduleInput>,excludeId?:string){
  const site=await ownedSite(input.siteId,ownerId);if(site.mode!=='live')throw new ProductError(400,'실제 워크스페이스에서만 정기 수집을 설정할 수 있습니다.','demo_schedule_forbidden');
  if(input.frequency==='weekly'&&!input.weekdays.length)throw new ProductError(400,'수집할 요일을 하나 이상 선택하세요.','invalid_weekdays');
  if(input.enabled){input.models.forEach(requireProvider);const units=await plannedUnits(site.id,input.promptIds||null,input.models),usage=await getUsageStatus(ownerId);
    const schedules=await getDb().select().from(t.collectionSchedules).where(and(eq(t.collectionSchedules.ownerId,ownerId),eq(t.collectionSchedules.enabled,true),isNull(t.collectionSchedules.deletedAt))).limit(20);
    let reserved=0;for(const existing of schedules.filter(s=>s.id!==excludeId)){try{reserved+=await plannedUnits(existing.siteId,existing.promptIds?JSON.parse(existing.promptIds):null,JSON.parse(existing.models));}catch{reserved+=usage.daily.limit;}}
    if(units+reserved>usage.daily.limit)throw new ProductError(409,`활성 일정의 예상 수집량을 합쳐 계정의 하루 한도 ${usage.daily.limit}회 안으로 설정하세요. 질문 수 × 모델 수로 계산합니다.`,'schedule_budget_exceeded');
  }
  return site;
}
async function createScheduleUnlocked(ownerId:string,input:z.infer<typeof scheduleInput>){
  await validateSchedule(ownerId,input);const db=getDb(),[total]=await db.select({n:count()}).from(t.collectionSchedules).where(and(eq(t.collectionSchedules.ownerId,ownerId),isNull(t.collectionSchedules.deletedAt)));if(total.n>=20)throw new ProductError(409,'일정은 계정당 20개까지 만들 수 있습니다.','schedule_limit');
  const date=now(),id=uid();const [s]=await db.insert(t.collectionSchedules).values({id,ownerId,siteId:input.siteId,name:input.name,enabled:input.enabled,frequency:input.frequency,timezone:input.timezone,hour:input.hour,minute:input.minute,weekdays:JSON.stringify([...new Set(input.weekdays)]),models:JSON.stringify([...new Set(input.models)]),promptIds:input.promptIds?JSON.stringify([...new Set(input.promptIds)]):null,nextRunAt:nextOccurrence(input,Date.now()),createdAt:date,updatedAt:date}).returning();await audit(ownerId,input.siteId,'schedule_created',id,'정기 수집 일정을 만들었습니다.');return publicSchedule(s);
}
async function updateScheduleUnlocked(ownerId:string,input:z.infer<typeof schedulePatch>){
  const existing=await ownedSchedule(ownerId,input.siteId,input.id),prior=publicSchedule(existing);const {id:ignored,siteId:ignoredSite,...patch}=input;void ignored;void ignoredSite;const merged=scheduleInput.parse({siteId:prior.siteId,name:prior.name,enabled:prior.enabled,frequency:prior.frequency,timezone:prior.timezone,hour:prior.hour,minute:prior.minute,weekdays:prior.weekdays,models:prior.models,promptIds:prior.promptIds,...patch});
  await validateSchedule(ownerId,merged,input.id);const timingChanged=['frequency','timezone','hour','minute','weekdays'].some(k=>k in input)||input.enabled===true&&!existing.enabled;
  const [row]=await getDb().update(t.collectionSchedules).set({name:merged.name,enabled:merged.enabled,frequency:merged.frequency,timezone:merged.timezone,hour:merged.hour,minute:merged.minute,weekdays:JSON.stringify([...new Set(merged.weekdays)]),models:JSON.stringify([...new Set(merged.models)]),promptIds:merged.promptIds?JSON.stringify([...new Set(merged.promptIds)]):null,...(timingChanged?{nextRunAt:nextOccurrence(merged,Date.now())}:{}),updatedAt:now()}).where(and(eq(t.collectionSchedules.id,input.id),eq(t.collectionSchedules.ownerId,ownerId),eq(t.collectionSchedules.siteId,input.siteId))).returning();
  if(!merged.enabled)await getDb().update(t.scheduledExecutions).set({status:'cancelled',completedAt:now(),updatedAt:now(),message:'일정이 일시 중지되어 대기 중인 실행을 취소했습니다.'}).where(and(eq(t.scheduledExecutions.scheduleId,input.id),eq(t.scheduledExecutions.ownerId,ownerId),eq(t.scheduledExecutions.status,'queued')));
  await audit(ownerId,input.siteId,merged.enabled?'schedule_updated':'schedule_paused',input.id,merged.enabled?'수집 일정을 변경했습니다.':'수집 일정을 일시 중지했습니다. 이미 시작된 실행은 마무리됩니다.');return publicSchedule(row);
}
async function deleteScheduleUnlocked(ownerId:string,siteId:string,id:string){await ownedSchedule(ownerId,siteId,id);const date=now();await getDb().batch([getDb().update(t.collectionSchedules).set({enabled:false,deletedAt:date,updatedAt:date}).where(and(eq(t.collectionSchedules.id,id),eq(t.collectionSchedules.ownerId,ownerId))),getDb().update(t.scheduledExecutions).set({status:'cancelled',completedAt:date,updatedAt:date,message:'일정이 삭제되어 대기 중인 실행을 취소했습니다.'}).where(and(eq(t.scheduledExecutions.scheduleId,id),eq(t.scheduledExecutions.ownerId,ownerId),eq(t.scheduledExecutions.status,'queued')))]);await audit(ownerId,siteId,'schedule_deleted',id,'수집 일정을 삭제했습니다. 실행 이력은 보관됩니다.');}
export async function acknowledgeAlert(ownerId:string,siteId:string,id:string,status:'acknowledged'|'resolved'){await ownedSite(siteId,ownerId);const [row]=await getDb().update(t.operationAlerts).set({status,updatedAt:now()}).where(and(eq(t.operationAlerts.id,id),eq(t.operationAlerts.ownerId,ownerId),eq(t.operationAlerts.siteId,siteId))).returning();if(!row)throw new ProductError(404,'알림을 찾을 수 없습니다.','not_found');await audit(ownerId,siteId,'alert_updated',id,'운영 알림의 확인 상태를 변경했습니다.');return publicAlert(row);}
export async function getOperationsState(ownerId:string,siteId:string):Promise<OperationsState>{
  await ownedSite(siteId,ownerId);const db=getDb();const [schedules,executions,alerts,audits,heartbeats,enabled,active,open]=await Promise.all([
    db.select().from(t.collectionSchedules).where(and(eq(t.collectionSchedules.ownerId,ownerId),eq(t.collectionSchedules.siteId,siteId),isNull(t.collectionSchedules.deletedAt))).orderBy(desc(t.collectionSchedules.createdAt)).limit(20),
    db.select().from(t.scheduledExecutions).where(and(eq(t.scheduledExecutions.ownerId,ownerId),eq(t.scheduledExecutions.siteId,siteId))).orderBy(desc(t.scheduledExecutions.createdAt)).limit(50),
    db.select().from(t.operationAlerts).where(and(eq(t.operationAlerts.ownerId,ownerId),eq(t.operationAlerts.siteId,siteId))).orderBy(desc(t.operationAlerts.createdAt)).limit(50),
    db.select().from(t.operationAudit).where(and(eq(t.operationAudit.ownerId,ownerId),eq(t.operationAudit.siteId,siteId))).orderBy(desc(t.operationAudit.createdAt)).limit(50),
    db.select().from(t.operationHeartbeats).where(inArray(t.operationHeartbeats.id,[`owner:${ownerId}`,'service'])),
    db.select({n:count()}).from(t.collectionSchedules).where(and(eq(t.collectionSchedules.ownerId,ownerId),eq(t.collectionSchedules.siteId,siteId),eq(t.collectionSchedules.enabled,true),isNull(t.collectionSchedules.deletedAt))),
    db.select({n:count()}).from(t.scheduledExecutions).where(and(eq(t.scheduledExecutions.ownerId,ownerId),eq(t.scheduledExecutions.siteId,siteId),inArray(t.scheduledExecutions.status,['queued','running']))),
    db.select({n:count()}).from(t.operationAlerts).where(and(eq(t.operationAlerts.ownerId,ownerId),eq(t.operationAlerts.siteId,siteId),eq(t.operationAlerts.status,'open'))),
  ]);
  const last=heartbeats.map(h=>h.lastFinishedAt||h.lastStartedAt).filter((v):v is string=>!!v).sort().at(-1)||null,lastSuccess=heartbeats.map(h=>h.lastSuccessAt).filter((v):v is string=>!!v).sort().at(-1)||null;
  const overdue=schedules.some(s=>s.enabled&&Date.now()-s.nextRunAt>2*3600000);const stale=overdue||enabled[0].n>0&&last!==null&&Date.now()-Date.parse(last)>2*3600000;const latestHeartbeat=[...heartbeats].sort((a,b)=>(a.lastFinishedAt||a.lastStartedAt||'').localeCompare(b.lastFinishedAt||b.lastStartedAt||'')).at(-1);const heartbeatFailed=!!latestHeartbeat?.lastErrorCode;const status=!last?'not_observed':open[0].n||stale||heartbeatFailed?'attention':'healthy';
  return {schedules:schedules.map(publicSchedule),executions:executions.map(publicExecution),alerts:alerts.map(publicAlert),audit:audits.map(a=>{const {ownerId,...safe}=a;void ownerId;return safe as OperationAudit;}),health:{status,lastHeartbeatAt:last,lastSuccessAt:lastSuccess,activeExecutions:active[0].n,openAlerts:open[0].n,enabledSchedules:enabled[0].n,serviceSecretConfigured:automationSecretConfigured(),message:status==='not_observed'?'아직 서버 수집기의 실행 기록이 없습니다. 외부 스케줄러 또는 인증된 MCP 호출을 연결하세요.':stale?'2시간 이상 수집기 실행 기록이 없거나 예정된 수집이 지연되었습니다. 외부 스케줄러 연결을 확인하세요.':heartbeatFailed?'최근 서버 수집기 실행에 오류가 발생했습니다. 연결과 실행 기록을 확인하세요.':status==='attention'?'확인이 필요한 운영 알림이 있습니다.':'최근 서버 수집기 실행이 확인되었습니다.'}};
}

export async function readOwnedExecution(ownerId:string,siteId:string,id:string){await ownedSite(siteId,ownerId);const [row]=await getDb().select().from(t.scheduledExecutions).where(and(eq(t.scheduledExecutions.id,id),eq(t.scheduledExecutions.ownerId,ownerId),eq(t.scheduledExecutions.siteId,siteId))).limit(1);if(!row)throw new ProductError(404,'수집 실행을 찾을 수 없습니다.','not_found');return publicExecution(row);}

// Configuration mutations for one owner share a durable lease so simultaneous enables
// cannot both pass the daily planning budget check against an outdated schedule list.
async function withScheduleConfigLock<T>(ownerId:string,siteId:string,work:()=>Promise<T>):Promise<T>{
  await ownedSite(siteId,ownerId);const db=getDb(),id=`schedule-config:${ownerId}`,token=uid(),until=Date.now()+30000;
  const claimed=await db.insert(t.operationHeartbeats).values({id,ownerId,leaseToken:token,leaseUntil:until,lastStartedAt:now()}).onConflictDoUpdate({target:t.operationHeartbeats.id,set:{leaseToken:token,leaseUntil:until,lastStartedAt:now()},setWhere:lte(t.operationHeartbeats.leaseUntil,Date.now())}).returning({id:t.operationHeartbeats.id});
  if(!claimed.length)throw new ProductError(409,'다른 일정 변경을 저장 중입니다. 잠시 후 다시 시도하세요.','schedule_locked');
  try{return await work();}finally{await db.update(t.operationHeartbeats).set({leaseToken:null,leaseUntil:0,lastFinishedAt:now()}).where(and(eq(t.operationHeartbeats.id,id),eq(t.operationHeartbeats.leaseToken,token)));}
}
export function createSchedule(ownerId:string,input:z.infer<typeof scheduleInput>){return withScheduleConfigLock(ownerId,input.siteId,()=>createScheduleUnlocked(ownerId,input));}
export function updateSchedule(ownerId:string,input:z.infer<typeof schedulePatch>){return withScheduleConfigLock(ownerId,input.siteId,()=>updateScheduleUnlocked(ownerId,input));}
export function deleteSchedule(ownerId:string,siteId:string,id:string){return withScheduleConfigLock(ownerId,siteId,()=>deleteScheduleUnlocked(ownerId,siteId,id));}
