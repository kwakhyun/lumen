import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import * as t from '@/db/schema';
import { DEMO_MODELS } from './product-types';
import { now, publicAnswer, publicRun, publicSite, quota, uid } from './product-server';
import { askProvider, providerStatuses, requireProvider } from './providers';
import { extractMentions } from './metrics';
import { syntheticAnswer } from './demo';
import { ProductError } from './product-validation';
import { reserveAiUsage } from './usage';

export async function createRun(site:typeof t.sites.$inferSelect,input:{mode:'live'|'demo';models:string[];promptIds?:string[]},options:{idempotencyKey?:string}={}){
  const db=getDb(),runId=options.idempotencyKey||uid();
  if(!/^[0-9a-f-]{36}$/i.test(runId))throw new ProductError(400,'Invalid analysis idempotency key.','invalid_idempotency_key');
  const [existing]=await db.select().from(t.runs).where(eq(t.runs.id,runId)).limit(1);
  if(existing){
    if(existing.siteId!==site.id||existing.mode!==input.mode||JSON.stringify([...new Set(JSON.parse(existing.models) as string[])].sort())!==JSON.stringify([...new Set(input.models)].sort()))throw new ProductError(409,'This analysis key belongs to a different request.','idempotency_conflict');
    if(input.promptIds){const rows=await db.select({id:t.answers.promptId}).from(t.answers).where(and(eq(t.answers.runId,runId),eq(t.answers.siteId,site.id)));if(JSON.stringify([...new Set(rows.map(r=>r.id))].sort())!==JSON.stringify([...new Set(input.promptIds)].sort()))throw new ProductError(409,'This analysis key has different questions.','idempotency_conflict');}
    return publicRun(existing);
  }
  if(input.mode!==site.mode)throw new ProductError(400,'Live and synthetic data must use separate workspaces.','mode_mismatch');
  const models=[...new Set(input.models)];
  if(site.mode==='live')models.forEach(requireProvider);else if(models.some(m=>!DEMO_MODELS.includes(m as typeof DEMO_MODELS[number])))throw new ProductError(400,'Unknown sample model.','invalid_model');
  const active=await db.select().from(t.prompts).where(and(eq(t.prompts.siteId,site.id),eq(t.prompts.active,true)));
  const selected=input.promptIds?active.filter(p=>input.promptIds!.includes(p.id)):active;
  if(input.promptIds&&selected.length!==new Set(input.promptIds).size)throw new ProductError(400,'Select only active questions from this workspace.','invalid_prompt');
  if(!selected.length||selected.length>20)throw new ProductError(400,'Select between 1 and 20 active questions per analysis run.','run_size');
  const unfinished=await db.select({id:t.runs.id}).from(t.runs).where(and(eq(t.runs.siteId,site.id),inArray(t.runs.status,['queued','running']))).limit(3);
  if(unfinished.length>=2)throw new ProductError(409,'Resume your unfinished runs before starting another.','run_in_progress');
  await quota(site.ownerId,'analysis-runs',20);
  if(site.mode==='live')await reserveAiUsage(site.ownerId,selected.length*models.length,`analysis:${runId}`);
  const run={id:runId,siteId:site.id,mode:site.mode,status:'queued' as const,models:JSON.stringify(models),total:selected.length*models.length,completed:0,failed:0,leaseUntil:0,leaseToken:null,createdAt:now(),completedAt:null,error:null};
  const rows=selected.flatMap(p=>models.map(model=>({id:uid(),siteId:site.id,runId:run.id,promptId:p.id,promptText:p.text,model,provider:site.mode==='demo'?'Synthetic demo':providerStatuses().find(p=>p.model===model)!.name,mode:site.mode,status:'pending' as const,createdAt:run.createdAt})));
  // D1 batch is transactional; incomplete job manifests are never visible.
  try{await db.batch([db.insert(t.runs).values(run),...rows.map(a=>db.insert(t.answers).values(a))]);}catch(error){
    // A concurrent replay may have committed this exact manifest. The usage reservation is also idempotent.
    const [committed]=await db.select().from(t.runs).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,site.id))).limit(1);
    if(committed)return createRun(site,input,{idempotencyKey:runId});throw error;
  }
  return publicRun(run);
}
export async function processRun(site:typeof t.sites.$inferSelect,runId:string){
  const db=getDb();const [original]=await db.select().from(t.runs).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,site.id))).limit(1);
  if(!original)throw new ProductError(404,'Analysis run not found.','not_found');
  if(!['queued','running'].includes(original.status))return {run:publicRun(original),answers:[]};
  if(site.mode==='live'){(JSON.parse(original.models) as string[]).forEach(requireProvider);await reserveAiUsage(site.ownerId,original.total,`analysis:${runId}`);}
  const leaseToken=uid(),until=Date.now()+120000;
  const claimed=await db.update(t.runs).set({status:'running',leaseToken,leaseUntil:until}).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,site.id),lte(t.runs.leaseUntil,Date.now()),inArray(t.runs.status,['queued','running']))).returning();
  if(!claimed.length)throw new ProductError(409,'This run is already being processed. Wait briefly, then resume.','run_locked');
  try{
    const leaseFence=()=>sql`EXISTS (SELECT 1 FROM runs WHERE id = ${runId} AND site_id = ${site.id} AND lease_token = ${leaseToken} AND lease_until > ${Date.now()})`;
    // An interrupted request might already have incurred provider cost. Mark it failed, never silently replay it.
    await db.update(t.answers).set({status:'failed',error:'Collection interrupted after dispatch. Start a new run to collect this answer again.',completedAt:now()}).where(and(eq(t.answers.runId,runId),eq(t.answers.siteId,site.id),eq(t.answers.status,'processing'),leaseFence()));
    
    const pending=await db.select().from(t.answers).where(and(eq(t.answers.runId,runId),eq(t.answers.siteId,site.id),eq(t.answers.status,'pending'))).limit(2);
    const competitors=await db.select().from(t.competitors).where(eq(t.competitors.siteId,site.id));
    await Promise.all(pending.map(async a=>{
      const claim=await db.update(t.answers).set({status:'processing'}).where(and(eq(t.answers.id,a.id),eq(t.answers.siteId,site.id),eq(t.answers.status,'pending'),leaseFence())).returning({id:t.answers.id});
      if(!claim.length)return;
      try {
        let result;
        if(site.mode==='demo'){
          const sample=syntheticAnswer(publicSite(site),competitors,{id:a.promptId,text:a.promptText},a.model,runId,now());
          result={text:sample.text,citations:sample.citations,inputTokens:0,outputTokens:0,providerResponseId:null};
        }else result=await askProvider(a.model,a.promptText,{search:true,instructions:`Answer the user's product discovery question objectively in ${site.language}. Consider the ${site.country} market where relevant. ${a.model==='gemini-3.8-flash'?'Use your model knowledge only. Web search is unavailable. Do not imply current verification or invent sources.':'Search the web and cite relevant sources.'} Explain tradeoffs. Do not assume any particular brand should be recommended. Do not invent sources or claims.`,maxTokens:1800});
        const mentions=extractMentions(result.text,result.citations,[site,...competitors]);
        await db.update(t.answers).set({...result,citations:JSON.stringify(result.citations),mentions:JSON.stringify(mentions),status:'completed',error:null,completedAt:now()}).where(and(eq(t.answers.id,a.id),eq(t.answers.siteId,site.id),eq(t.answers.status,'processing'),leaseFence()));
      }catch(error){await db.update(t.answers).set({status:'failed',error:error instanceof ProductError?error.message:'The answer could not be collected. Start a new run to try again.',completedAt:now()}).where(and(eq(t.answers.id,a.id),eq(t.answers.siteId,site.id),eq(t.answers.status,'processing'),leaseFence()));}
    }));
    const answers=await db.select().from(t.answers).where(and(eq(t.answers.runId,runId),eq(t.answers.siteId,site.id)));
    const completed=answers.filter(a=>a.status==='completed').length,failed=answers.filter(a=>a.status==='failed').length,finished=completed+failed===original.total;
    const status=finished?(failed?(completed?'partial':'failed'):'completed'):'running';
    const [run]=await db.update(t.runs).set({completed,failed,status,completedAt:finished?now():null,leaseUntil:0,leaseToken:null,error:failed?`${failed} answer${failed===1?'':'s'} could not be collected. Review the answer errors.`:null}).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,site.id),eq(t.runs.leaseToken,leaseToken))).returning();
    if(!run)throw new ProductError(409,'Processing lease changed. Refresh the run.','run_lease_changed');
    return {run:publicRun(run),answers:answers.map(publicAnswer)};
  }catch(error){
    await db.update(t.runs).set({leaseUntil:0,leaseToken:null}).where(and(eq(t.runs.id,runId),eq(t.runs.siteId,site.id),eq(t.runs.leaseToken,leaseToken)));throw error;
  }
}
