import type { SiteState } from '../product-types';
import { gapQuestions, type AgentEvidence } from './evidence';
import type { AgentRun } from './types';

export type SuggestionAction =
  | { kind: 'agent'; agentId: string; input?: Record<string, string>; label: string }
  | { kind: 'collect'; label: string }
  | { kind: 'form'; form: 'competitor' | 'prompt'; label: string };
export type Suggestion = { id: string; tone: 'accent' | 'amber' | 'green'; icon: 'target' | 'users' | 'refresh' | 'link' | 'compass' | 'calendar' | 'pulse'; title: string; detail: string; action: SuggestionAction };

const DAY = 86_400_000;
const modelNames: Record<string, string> = { 'gpt-6.1-terra': 'GPT', 'claude-opus-5-5': 'Claude', 'gemini-3.8-flash': 'Gemini', 'perplexity/sonar': 'Perplexity', 'gpt-4.1-mini': 'GPT 샘플', 'demo-gemini': 'Gemini 샘플', 'demo-perplexity': 'Perplexity 샘플' };

/** What to do next, derived from the same numbers the dashboard shows. No model is involved. */
export function buildSuggestions(state: SiteState, evidence: AgentEvidence, runs: AgentRun[], now = Date.now()): Suggestion[] {
  const list: Suggestion[] = [], { overview } = evidence;
  const gap = gapQuestions(evidence, 1)[0];
  if (gap) list.push({ id: `gap:${gap.id}`, tone: 'amber', icon: 'target', title: `‘${gap.text}’에서 경쟁사만 언급되고 있어요`, detail: `완료 답변 ${gap.answerCount}개 중 ${gap.competitorOnlyCount}개에 ${gap.competitorNames.join(', ')}만 등장했어요.`, action: { kind: 'agent', agentId: 'gap-analysis', input: { promptId: gap.id }, label: '격차 분석' } });
  const rivalSources = evidence.sources.filter(source => source.kind === 'competitor').length, thirdParty = evidence.sources.filter(source => source.kind === 'third_party').length;
  const ownSource = evidence.sources.find(source => source.kind === 'own');
  if (evidence.sources.length && (thirdParty > 0 || !ownSource)) list.push({ id: 'sources', tone: 'accent', icon: 'link', title: ownSource ? `AI가 인용하는 제3자 출처가 ${thirdParty}곳 있어요` : '우리 도메인은 아직 인용되지 않았어요', detail: `인용된 도메인 ${evidence.sources.length}개 중 경쟁사 ${rivalSources}개, 제3자 ${thirdParty}개예요.`, action: { kind: 'agent', agentId: 'source-playbook', label: '출처 분석' } });
  const sorted = [...evidence.models].sort((a, b) => a.mentionRate - b.mentionRate), weak = sorted[0], strong = sorted[sorted.length - 1];
  if (weak && strong && weak.model !== strong.model && strong.mentionRate - weak.mentionRate >= 10) list.push({ id: `model:${weak.model}`, tone: 'accent', icon: 'pulse', title: `${modelNames[weak.model] || weak.model}에서 언급률이 낮아요`, detail: `${modelNames[weak.model] || weak.model} ${weak.mentionRate}%, ${modelNames[strong.model] || strong.model} ${strong.mentionRate}%로 ${Math.round((strong.mentionRate - weak.mentionRate) * 10) / 10}%p 차이예요.`, action: { kind: 'agent', agentId: 'brand-health', label: '가시성 리포트' } });
  const latest = state.answers.reduce((max, answer) => answer.status === 'completed' ? Math.max(max, Date.parse(answer.completedAt || answer.createdAt)) : max, 0);
  if (latest && now - latest > 7 * DAY) list.push({ id: 'stale', tone: 'amber', icon: 'refresh', title: `마지막 수집이 ${Math.floor((now - latest) / DAY)}일 전이에요`, detail: '같은 질문으로 다시 수집하면 변화를 비교할 수 있어요.', action: { kind: 'collect', label: '다시 수집' } });
  if (!state.competitors.length) list.push({ id: 'competitors', tone: 'accent', icon: 'users', title: '비교할 경쟁사를 등록해 보세요', detail: '경쟁사를 등록하면 점유율과 경쟁사만 언급된 답변을 계산해요.', action: { kind: 'form', form: 'competitor', label: '경쟁사 추가' } });
  const active = state.prompts.filter(prompt => prompt.active).length;
  if (active < 5) list.push({ id: 'prompts', tone: 'accent', icon: 'compass', title: `추적하는 질문이 ${active}개예요`, detail: '주제와 의도가 다른 질문을 더하면 빠진 영역을 찾기 쉬워요.', action: { kind: 'agent', agentId: 'prompt-discovery', label: '질문 발굴' } });
  const reported = runs.some(run => ['weekly-report', 'brand-health'].includes(run.agentId) && run.status === 'completed' && now - Date.parse(run.createdAt) < 7 * DAY);
  if (overview.answerCount > 0 && !reported) list.push({ id: 'weekly', tone: 'green', icon: 'calendar', title: '이번 주 리포트를 만들어 둘까요?', detail: `완료 답변 ${overview.answerCount}개를 기준으로 달라진 점을 정리해요.`, action: { kind: 'agent', agentId: 'weekly-report', label: '리포트 작성' } });
  return list.slice(0, 5);
}

/** Topic rows against tracked brands: the share of completed answers that mention each brand. */
export function topicBrandMatrix(state: Pick<SiteState, 'site' | 'competitors' | 'prompts'>, answers: SiteState['answers']) {
  const canonical = (domain: string) => domain.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const brands = [state.site, ...state.competitors].map((brand, index) => ({ name: brand.name, domain: canonical(brand.domain), isOwn: index === 0 }));
  const topicOf = new Map(state.prompts.map(prompt => [prompt.id, prompt.topic || '일반']));
  const rows = new Map<string, { answers: number; hits: number[] }>();
  for (const answer of answers) {
    if (answer.status !== 'completed') continue;
    const topic = topicOf.get(answer.promptId); if (!topic) continue;
    const row = rows.get(topic) || { answers: 0, hits: brands.map(() => 0) };
    row.answers += 1;
    const mentioned = new Set(answer.mentions.filter(mention => mention.mentioned).map(mention => canonical(mention.domain)));
    brands.forEach((brand, index) => { if (mentioned.has(brand.domain)) row.hits[index] += 1; });
    rows.set(topic, row);
  }
  return { brands, rows: [...rows].map(([topic, row]) => ({ topic, answers: row.answers, rates: row.hits.map(hit => Math.round(hit / row.answers * 1000) / 10) })).sort((a, b) => a.rates[0] - b.rates[0]) };
}
