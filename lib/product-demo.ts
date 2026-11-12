import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import * as t from '@/db/schema';
import { DEMO_MODELS } from './product-types';
import { DEMO_QUESTIONS, syntheticAnswer } from './demo';
import { now, publicSite, quota, uid } from './product-server';
import { snapshotAnswers } from './experiment-metrics';
import { improvementExperiments } from '@/db/experiments-schema';
/** siteId pins the workspace ID so that concurrent seeds of a shared sample collide instead of duplicating it. */
export async function seedDemo(ownerId:string,options:{siteId?:string}={}){
  const db=getDb();const [existing]=await db.select().from(t.sites).where(and(eq(t.sites.ownerId,ownerId),eq(t.sites.mode,'demo'))).limit(1);if(existing)return publicSite(existing);
  await quota(ownerId,'demo-workspaces',2);
  const date=now(),site={id:options.siteId||uid(),ownerId,name:'Northstar',domain:'northstar.example',description:'제품팀과 디자인팀, 개발팀을 위한 가상의 협업 서비스입니다. 이 워크스페이스의 모든 데이터는 기능을 보여 주기 위해 만든 예시입니다.',industry:'업무 협업 소프트웨어',language:'한국어',country:'KR',mode:'demo' as const,trackingKey:uid(),createdAt:date,updatedAt:date};
  const competitors=[{id:uid(),siteId:site.id,name:'Orbit',domain:'orbit.example',createdAt:date},{id:uid(),siteId:site.id,name:'Tandem',domain:'tandem.example',createdAt:date},{id:uid(),siteId:site.id,name:'Boardly',domain:'boardly.example',createdAt:date}];
  const prompts=DEMO_QUESTIONS.map(([text,topic,intent],i)=>({id:uid(),siteId:site.id,text,topic,intent,active:true,pinned:i<3,createdAt:date}));
  const runs=Array.from({length:7},(_,i)=>{const createdAt=new Date(Date.now()-(6-i)*4*86400000).toISOString();return{id:uid(),siteId:site.id,mode:'demo' as const,status:'completed' as const,models:JSON.stringify(DEMO_MODELS),total:prompts.length*3,completed:prompts.length*3,failed:0,leaseUntil:0,leaseToken:null,createdAt,completedAt:createdAt,error:null};});
  const sampleAnswers=runs.flatMap(run=>prompts.flatMap(p=>DEMO_MODELS.map(model=>syntheticAnswer(publicSite(site),competitors,p,model,run.id,run.createdAt))));
  const answers=sampleAnswers.map(a=>({...a,citations:JSON.stringify(a.citations),mentions:JSON.stringify(a.mentions)}));
  // A finished before/after comparison between the first and the latest sample collection.
  const brands=[site,...competitors].map(({name,domain})=>({name,domain})),first=runs[0],latest=runs[runs.length-1];
  const experiment={id:uid(),siteId:site.id,title:'가격 안내 페이지 보완 전후 비교',hypothesis:'가격표와 체험 절차를 한 페이지에 정리하면 가격과 도입 관련 질문에서 Northstar가 더 자주 언급될 것이다.',intervention:'가격 페이지에 요금제별 사용자 수 제한, 결제 주기, 무료 체험 절차를 표로 추가했습니다. (합성 예시)',metric:'mentionRate' as const,targetDelta:5,status:'reviewed' as const,baselineRunId:first.id,followupRunId:latest.id,baselineSnapshot:JSON.stringify(snapshotAnswers(sampleAnswers.filter(a=>a.runId===first.id),brands,'demo')),followupSnapshot:JSON.stringify(snapshotAnswers(sampleAnswers.filter(a=>a.runId===latest.id),brands,'demo')),notes:'샘플 실험입니다. 같은 질문과 모델로 수집한 두 시점을 짝지어 비교합니다.',createdAt:first.createdAt,updatedAt:date};
  const tasks=[
    ['제품 비교 페이지 작성하기','추적 중인 대안과 비교해 Northstar가 적합한 상황을 설명하세요. 구체적인 선택 기준과 확인할 수 있는 제품 정보를 담으세요.','high','todo'],
    ['가격 질문에 대한 명확한 답변 추가하기','읽기 쉬운 가격표를 만들고 사용자 수 제한, 결제 주기, 체험 절차를 설명하세요.','high','in_progress'],
    ['원격 팀 사용 사례 보강하기','질문에 바로 답하는 페이지를 만들고 실제 사례와 근거 문서를 연결하세요.','medium','todo'],
    ['주요 인용 출처 검토하기','예시 답변에 어떤 도메인이 인용되는지 살펴보고 문서 보완이나 외부 콘텐츠 협업 계획을 세우세요.','medium','todo'],
    ['제품 문서 탐색 구조 개선하기','설치, 연동, 권한 설정에 관한 문서를 쉽게 찾을 수 있도록 정리하세요.','medium','done'],
  ].map(([title,description,priority,status])=>({id:uid(),siteId:site.id,title,description,priority:priority as 'high'|'medium',status:status as 'todo'|'in_progress'|'done',createdAt:date,updatedAt:date}));
  const documents=[{id:uid(),siteId:site.id,kind:'report' as const,title:'브랜드 언급 분석 리포트 예시',format:'report',mode:'demo' as const,createdAt:date,content:'# 브랜드 언급 분석 리포트 예시\n\n리포트 형식을 보여 주기 위한 합성 데이터입니다. 실제 관측 결과를 포함하지 않습니다.\n\n## 측정 범위\n\n12개 질문과 3개 모델 이름, 7개 수집 날짜를 사용한 예시입니다. 답변과 인용 출처는 모두 가상 데이터입니다.\n\n## 살펴볼 질문\n\n브랜드가 등장하지 않는 비교 질문을 먼저 확인하세요. 답변 원문과 인용 출처를 읽고, 자사 제품 페이지가 해당 질문에 충분히 답하고 있는지 검토하세요.\n\n## 다음 단계\n\n1. 실제 워크스페이스를 만들고 추적할 질문을 등록하세요.\n2. 무료 이용 조건과 남은 사용량을 확인한 뒤 Gemini API 답변을 수집하세요.\n3. 답변 원문에서 자사와 경쟁사의 언급을 확인하세요. 실제 검색 노출을 비교하려면 ChatGPT 또는 Perplexity에서 직접 확인한 검색 결과를 별도로 기록하세요.\n\n현재 무료 Gemini 수집은 웹 검색을 사용하지 않아 인용 출처를 제공하지 않습니다. 이 샘플의 인용은 화면을 설명하기 위한 가상 자료이며, API 답변의 브랜드 언급을 실제 검색 노출이나 매출로 해석하지 않습니다.'},{id:uid(),siteId:site.id,kind:'content' as const,title:'우리 팀에 맞는 협업 도구 선택 가이드',format:'article',mode:'demo' as const,createdAt:date,content:'# 우리 팀에 맞는 협업 도구 선택 가이드\n\n기능을 보여 주기 위한 콘텐츠 예시입니다. 게시하기 전에 제품 정보를 확인하세요.\n\n팀이 실제로 일하는 방식부터 정리해 보세요. 함께 기록해야 할 결정, 담당자를 정해야 할 업무, 쉽게 찾아야 할 문서가 무엇인지 목록을 만드세요.\n\n## 비교 기준 정하기\n\n도입에 걸리는 시간, 접근 권한, 외부 서비스 연동, 보고 기능을 비교하세요. 실제 프로젝트로 짧게 시험해 보면 차이를 확인할 수 있습니다.\n\n## 중요한 질문 확인하기\n\n- 새 팀원이 최신 계획을 쉽게 찾을 수 있나요?\n- 별도 회의 없이도 업무 담당자를 알 수 있나요?\n- 외부 파트너가 필요한 자료에만 접근할 수 있나요?\n\n## 선택 이유 기록하기\n\n제품이 누구에게 적합한지, 어떤 한계가 있는지 명확하게 설명하세요. 확인할 수 없는 주장은 피하세요.'}];
  const personas=[{id:uid(),siteId:site.id,name:'스타트업 대표',description:'성장 중인 팀이 쉽게 도입할 수 있는 협업 도구를 찾는 대표입니다.',promptPrefix:'20명 규모 스타트업의 대표 입장에서 ',createdAt:date},{id:uid(),siteId:site.id,name:'제품팀 리더',description:'디자인팀과 개발팀의 공동 업무를 조율하는 제품팀 리더입니다.',promptPrefix:'디자인팀과 개발팀을 이끄는 제품팀 리더 입장에서 ',createdAt:date}];
  // A single D1 transaction prevents half-created demo workspaces after interruption.
  await db.batch([db.insert(t.sites).values(site),db.insert(t.prompts).values(prompts),db.insert(t.competitors).values(competitors),...runs.map(r=>db.insert(t.runs).values(r)),...Array.from({length:Math.ceil(answers.length/5)},(_,i)=>db.insert(t.answers).values(answers.slice(i*5,i*5+5))),db.insert(t.tasks).values(tasks),db.insert(t.documents).values(documents),db.insert(t.personas).values(personas),db.insert(improvementExperiments).values(experiment)]);
  return publicSite(site);
}
