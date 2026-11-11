import type { Answer, Citation, Competitor, Prompt, Site } from './product-types';
import { extractMentions } from './metrics';
export const DEMO_QUESTIONS=[
  ['성장하는 디자인팀에 적합한 프로젝트 관리 도구를 추천해 주세요.','제품 탐색','informational'],
  ['제품 로드맵과 할 일, 팀 문서를 한곳에서 관리할 수 있는 도구는 무엇인가요?','제품 탐색','informational'],
  ['20명 규모의 스타트업은 프로젝트 관리 도구를 어떤 기준으로 골라야 하나요?','선택 기준','informational'],
  ['원격으로 일하는 제품팀을 위한 협업 도구를 비교해 주세요.','제품 비교','comparison'],
  ['복잡한 기업용 프로젝트 관리 도구를 대체할 만한 서비스는 무엇인가요?','대안 탐색','comparison'],
  ['처음 도입하기 쉬운 프로젝트 관리 서비스는 무엇인가요?','선택 기준','transactional'],
  ['디자인팀과 개발팀이 공동 프로젝트를 효율적으로 관리하려면 어떻게 해야 하나요?','팀 업무 방식','informational'],
  ['고객사와 함께 일하는 대행사에 적합한 프로젝트 관리 도구를 추천해 주세요.','제품 탐색','transactional'],
  ['소규모 팀이 합리적인 비용으로 쓸 수 있는 프로젝트 관리 도구는 무엇인가요?','가격','transactional'],
  ['제품팀의 분기별 로드맵 계획에 도움이 되는 도구는 무엇인가요?','로드맵','informational'],
  ['협업 도구별 프로젝트 보고 기능을 비교해 주세요.','제품 비교','comparison'],
  ['여러 부서가 참여하는 프로젝트의 일정을 관리하기 좋은 도구는 무엇인가요?','팀 업무 방식','informational'],
] as const;
function hash(v:string){let h=2166136261;for(const c of v){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export function syntheticAnswer(site:Site,competitors:Pick<Competitor,'name'|'domain'>[],prompt:Pick<Prompt,'id'|'text'>,model:string,runId:string,date:string):Answer{
  const n=hash(`${prompt.text}|${model}|${date}`);const brands=[site,...competitors];
  const shown=brands.filter((_,i)=>((n>>i)%100)<(i===0?68:53));if(!shown.length)shown.push(brands[1]||site);
  shown.sort((a,b)=>(hash(a.name+date+prompt.text)%11)-(hash(b.name+date+prompt.text)%11));
  const text='합성 답변입니다. 제품 설명과 인용 출처는 기능을 보여 주기 위한 예시이며, 실제 AI 모델이 생성한 답변이 아닙니다.\n\n'+`질문: ${prompt.text}\n\n`+shown.map((b,i)=>`${i+1}. ${b.name} — 업무 담당자를 정하고 로드맵을 공유하며 팀별 진행 상황을 확인할 수 있는 가상의 협업 서비스입니다.`).join('\n\n')+'\n\n도구를 고를 때는 도입 과정, 접근 권한, 보고 기능을 비교해 보세요. 실제 업무 하나를 시험해 보면 우리 팀에 맞는지 판단하는 데 도움이 됩니다.';
  const citations:Citation[]=shown.filter((_,i)=>((n>>(i+3))%3)!==0).map(b=>({url:`https://${b.domain}/guides/team-collaboration`,title:`${b.name} 팀 협업 가이드 (합성 예시)`,domain:b.domain,startIndex:0,endIndex:0,provenance:'synthetic'}));
  return {id:crypto.randomUUID(),siteId:site.id,runId,promptId:prompt.id,promptText:prompt.text,model,provider:'Synthetic demo',mode:'demo',status:'completed',text,citations,mentions:extractMentions(text,citations,brands),inputTokens:0,outputTokens:0,providerResponseId:null,error:null,createdAt:date,completedAt:date};
}
