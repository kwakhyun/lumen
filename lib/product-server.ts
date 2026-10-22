import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import * as tables from '@/db/schema';
import type { Answer, Run, Site, SiteState, TrafficSummary } from './product-types';
import { computeMetrics, extractMentions } from './metrics';
import { ProductError } from './product-validation';
import { providerStatuses } from './providers';
export const now=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();
export async function requireUser(){const u=await getChatGPTUser();if(!u)throw new ProductError(401,'Sign in with ChatGPT to access your workspace.','unauthenticated');return u;}
export function publicSite(row:typeof tables.sites.$inferSelect):Site{const {ownerId,...rest}=row;void ownerId;return rest;}
export function publicRun(row:typeof tables.runs.$inferSelect):Run{const {leaseUntil,leaseToken,models,...rest}=row;void leaseUntil;void leaseToken;return {...rest,models:JSON.parse(models)};}
export function publicAnswer(row:typeof tables.answers.$inferSelect):Answer{return {...row,citations:JSON.parse(row.citations),mentions:JSON.parse(row.mentions)};}
export async function ownedSite(id:string,userId:string){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new ProductError(404,'Workspace not found.','not_found');
  const [site]=await getDb().select().from(tables.sites).where(and(eq(tables.sites.id,id),eq(tables.sites.ownerId,userId))).limit(1);
  if(!site)throw new ProductError(404,'Workspace not found.','not_found');return site;
}
/** Conditional UPSERT is atomic across Worker isolates. Costs are reserved before external calls. */
export async function quota(userId:string,kind:string,maximum:number,amount=1,windowMs=86400000){
  if(amount>maximum)throw new ProductError(429,'Requested quota exceeds the permitted limit.','quota_exceeded');
  const slot=Math.floor(Date.now()/windowMs),id=`${kind}:${userId}:${slot}`;
  const rows=await getDb().insert(tables.quotas).values({id,count:amount,expiresAt:(slot+1)*windowMs}).onConflictDoUpdate({target:tables.quotas.id,set:{count:sql`${tables.quotas.count} + ${amount}`},setWhere:sql`${tables.quotas.count} + ${amount} <= ${maximum}`}).returning({count:tables.quotas.count});
  if(amount>maximum||!rows.length)throw new ProductError(429,`The ${kind.replaceAll('-',' ')} limit has been reached. Try again after the current quota window.`, 'quota_exceeded');
}
export async function getState(site:typeof tables.sites.$inferSelect):Promise<SiteState>{
  const db=getDb();const since=new Date(Date.now()-30*86400000).toISOString();
  const [prompts,competitors,runs,answerRows,documents,tasks,personas,trafficRows,trafficPages,answerCount]=await Promise.all([
    db.select().from(tables.prompts).where(eq(tables.prompts.siteId,site.id)).orderBy(desc(tables.prompts.pinned),desc(tables.prompts.createdAt)).limit(100),
    db.select().from(tables.competitors).where(eq(tables.competitors.siteId,site.id)).limit(20),
    db.select().from(tables.runs).where(eq(tables.runs.siteId,site.id)).orderBy(desc(tables.runs.createdAt)).limit(40),
    db.select().from(tables.answers).where(and(eq(tables.answers.siteId,site.id),gte(tables.answers.createdAt,since))).orderBy(desc(tables.answers.createdAt)).limit(1000),
    db.select().from(tables.documents).where(eq(tables.documents.siteId,site.id)).orderBy(desc(tables.documents.createdAt)).limit(100),
    db.select().from(tables.tasks).where(eq(tables.tasks.siteId,site.id)).orderBy(desc(tables.tasks.createdAt)).limit(100),
    db.select().from(tables.personas).where(eq(tables.personas.siteId,site.id)).limit(20),
    db.select({day:tables.traffic.day,source:tables.traffic.source,visits:sql<number>`sum(${tables.traffic.visits})`.mapWith(Number)}).from(tables.traffic).where(and(eq(tables.traffic.siteId,site.id),gte(tables.traffic.day,since.slice(0,10)))).groupBy(tables.traffic.day,tables.traffic.source),
    db.select({path:tables.traffic.path,visits:sql<number>`sum(${tables.traffic.visits})`.mapWith(Number)}).from(tables.traffic).where(and(eq(tables.traffic.siteId,site.id),gte(tables.traffic.day,since.slice(0,10)))).groupBy(tables.traffic.path).orderBy(desc(sql`sum(${tables.traffic.visits})`)).limit(20),
    db.select({total:count()}).from(tables.answers).where(and(eq(tables.answers.siteId,site.id),gte(tables.answers.createdAt,since))),
  ]);
  // Re-evaluate the original evidence against the current tracked brand cohort.
  // Adding/renaming a competitor must not silently produce false zero metrics.
  const answers=answerRows.map(publicAnswer).map(a=>({...a,mentions:extractMentions(a.text,a.citations,[site,...competitors])})),publicRuns=runs.map(publicRun);
  const latest=publicRuns.find(r=>['completed','partial','failed'].includes(r.status))||publicRuns[0];
  const summary:TrafficSummary={totalVisits:0,aiVisits:0,sources:[],pages:[],series:[],trackingEnabled:site.mode==='live',note:site.mode==='demo'?'샘플 워크스페이스에서는 방문을 수집하지 않습니다. 내 브랜드의 방문을 수집하려면 해당 워크스페이스에서 추적 스크립트를 확인해 웹사이트에 설치하세요.':'브라우저가 보낸 최근 30일의 방문 기록입니다. 쿠키와 IP 주소는 저장하지 않으며, URL의 쿼리 문자열도 제외합니다.'};
  const sources=new Map<string,number>(),series=new Map<string,{date:string;visits:number;aiVisits:number}>();
  for(const t of trafficRows){const ai=['ChatGPT','Perplexity','Claude','Gemini','Copilot'].includes(t.source);summary.totalVisits+=t.visits;summary.aiVisits+=ai?t.visits:0;sources.set(t.source,(sources.get(t.source)||0)+t.visits);const d=series.get(t.day)||{date:t.day,visits:0,aiVisits:0};d.visits+=t.visits;d.aiVisits+=ai?t.visits:0;series.set(t.day,d);}
  summary.sources=[...sources].map(([source,visits])=>({source,visits})).sort((a,b)=>b.visits-a.visits);summary.pages=trafficPages;summary.series=[...series.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(site.mode==='demo'){summary.totalVisits=0;summary.aiVisits=0;summary.sources=[];summary.pages=[];summary.series=[];}
  return {dataWindow:{days:30,answersReturned:answers.length,totalAnswers:answerCount[0].total,truncated:answerCount[0].total>answers.length},site:publicSite(site),prompts,competitors,runs:publicRuns,answers,documents,tasks,personas,traffic:summary,metrics:computeMetrics(site,competitors,answers.filter(a=>a.runId===latest?.id),prompts,answers),providers:providerStatuses()};
}
export function errorResponse(error:unknown):Response{
  if(error instanceof ProductError)return Response.json({error:error.message,code:error.code},{status:error.status,headers:{'Cache-Control':'no-store',...(error.status===429?{'Retry-After':'60'}:{})}});
  // Do not leak SQL, request payloads, upstream credentials or stack traces.
  const message=error instanceof Error?error.message:'';
  if(/UNIQUE constraint failed/i.test(message))return Response.json({error:'This record already exists.',code:'duplicate'},{status:409});
  if(/binding|no such table|D1_ERROR/i.test(message))return Response.json({error:'The database is not ready. Apply the D1 migrations and check the DB binding.',code:'database_unavailable'},{status:503});
  return Response.json({error:'The operation could not be completed. Please retry.',code:'internal_error'},{status:500});
}
