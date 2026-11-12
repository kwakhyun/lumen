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
const BRAND_LINES=[
  '로드맵과 작업, 문서를 한 화면에서 연결해 볼 수 있어 제품팀이 쓰기 좋습니다.',
  '초기 설정이 간단하고 템플릿이 많아 소규모 팀이 빠르게 도입할 수 있습니다.',
  '권한을 세밀하게 나눌 수 있어 외부 협력사와 함께 일하는 팀에 맞습니다.',
  '일정과 의존 관계를 타임라인으로 보여 주어 여러 부서가 참여하는 프로젝트에 적합합니다.',
  '보고서와 대시보드가 잘 갖춰져 있어 진행 상황을 자주 공유하는 조직에 어울립니다.',
  '요금 구조가 단순하고 무료 구간이 넓어 비용에 민감한 팀이 시작하기 좋습니다.',
  '디자인 파일과 개발 이슈를 함께 추적할 수 있어 디자인팀과 개발팀의 협업에 쓰입니다.',
];
const INTROS=[
  '팀의 규모와 일하는 방식에 따라 맞는 도구가 달라집니다. 자주 거론되는 선택지는 다음과 같습니다.',
  '이 질문에는 정답이 하나가 아닙니다. 아래 서비스들을 기준별로 비교해 보는 것을 권합니다.',
  '몇 가지 서비스가 이 용도로 자주 추천됩니다. 각 서비스의 특징을 간단히 정리했습니다.',
];
const CLOSINGS=[
  '도입 과정, 접근 권한, 보고 기능을 기준으로 비교하고, 실제 업무 하나를 시험해 보면 판단하기 쉽습니다.',
  '무료 체험 기간에 팀의 실제 프로젝트를 옮겨 보고, 2주 뒤에도 계속 쓰고 있는지 확인해 보세요.',
  '가격만 보지 말고 팀이 이미 쓰는 도구와의 연동과 관리 부담을 함께 따져 보는 것이 좋습니다.',
];
/** Review sites, guides and communities: the sources a real answer cites besides the brands themselves. */
export const DEMO_THIRD_PARTY_SOURCES=[
  {domain:'worktool-review.example',title:'협업 도구 비교 리뷰',path:'/reviews/collaboration-tools'},
  {domain:'startup-playbook.example',title:'스타트업 업무 도구 가이드',path:'/guides/project-tools'},
  {domain:'pm-community.example',title:'PM 커뮤니티 추천 스레드',path:'/threads/project-management'},
  {domain:'saas-magazine.example',title:'SaaS 매거진 팀 도구 총정리',path:'/articles/team-tools'},
] as const;
/**
 * Deterministic for a given question, model and date. Questions differ in how often the
 * brand appears, models differ slightly, and later collections trend upward, so that
 * filters, comparisons and before/after views have something to show.
 */
export function syntheticAnswer(site:Site,competitors:Pick<Competitor,'name'|'domain'>[],prompt:Pick<Prompt,'id'|'text'>,model:string,runId:string,date:string):Answer{
  const n=hash(`${prompt.text}|${model}|${date}`);const brands=[site,...competitors];
  const ageDays=Math.max(0,Math.min(30,(Date.now()-Date.parse(date))/86400000));
  const ownChance=Math.min(97,48+(hash(prompt.text)%5)*12+(hash(model)%3)*4+Math.round((30-ageDays)/30*8));
  const shown=brands.filter((_,i)=>((n>>>(i*5))%100)<(i===0?ownChance:56));if(!shown.length)shown.push(brands[1]||site);
  shown.sort((a,b)=>(hash(a.name+date+prompt.text)%11)-(hash(b.name+date+prompt.text)%11));
  const text='※ 기능 소개용 합성 답변입니다. 실제 AI 모델이 생성한 답변이 아닙니다.\n\n'+INTROS[n%INTROS.length]+'\n\n'+shown.map((b,i)=>`${i+1}. **${b.name}** — ${BRAND_LINES[hash(b.name+prompt.text)%BRAND_LINES.length]}`).join('\n')+'\n\n'+CLOSINGS[(n>>>3)%CLOSINGS.length];
  const brandCitations:Citation[]=shown.filter((_,i)=>((n>>>(i+3))%3)!==0).map(b=>({url:`https://${b.domain}/guides/team-collaboration`,title:`${b.name} 팀 협업 가이드 (합성 예시)`,domain:b.domain,startIndex:0,endIndex:0,provenance:'synthetic'}));
  const thirdParty:Citation[]=DEMO_THIRD_PARTY_SOURCES.filter((_,i)=>((n>>>(i*3+7))%100)<(i<2?46:28)).map(source=>({url:`https://${source.domain}${source.path}`,title:`${source.title} (합성 예시)`,domain:source.domain,startIndex:0,endIndex:0,provenance:'synthetic'}));
  const citations=[...brandCitations,...thirdParty];
  return {id:crypto.randomUUID(),siteId:site.id,runId,promptId:prompt.id,promptText:prompt.text,model,provider:'Synthetic demo',mode:'demo',status:'completed',text,citations,mentions:extractMentions(text,citations,brands),inputTokens:0,outputTokens:0,providerResponseId:null,error:null,createdAt:date,completedAt:date};
}
