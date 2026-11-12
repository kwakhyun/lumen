import type { DashboardScope } from '../dashboard-scope';
import type { SiteState } from '../product-types';
import { answerExcerpts, gapQuestions, type AgentEvidence } from './evidence';
import type { AgentProposal } from './types';

export type AgentDraft = { title: string; summary: string; report: string; proposals: Omit<AgentProposal, 'id' | 'status'>[] };
type WriterContext = { evidence: AgentEvidence; state: SiteState; scope: DashboardScope; input: Record<string, string>; asOf: number };

const num = (value: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value);
const rate = (value: number | null) => value === null ? '측정 불가' : `${num(value)}%`;
const modelNames: Record<string, string> = { 'gpt-6.1-terra': 'GPT-6.1 Terra', 'claude-opus-5-5': 'Claude Opus 5.5', 'gpt-4.1-mini': 'GPT-4.1 mini', 'gemini-3.8-flash': 'Gemini 3.8 Flash', 'perplexity/sonar': 'Perplexity Sonar', 'demo-gemini': 'Gemini 샘플', 'demo-perplexity': 'Perplexity 샘플' };
const modelName = (id: string) => modelNames[id] || id;
const scopeLine = ({ scope, overview }: AgentEvidence) => `최근 ${scope.period}일 · ${scope.model === 'all' ? '모든 AI 모델' : modelName(scope.model)} · 완료 답변 ${overview.answerCount}개`;
const table = (head: string[], rows: (string | number)[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell => String(cell).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`)].join('\n');
const footer = (evidence: AgentEvidence) => `\n---\n\n${evidence.site.mode === 'demo' ? '합성 샘플 데이터로 만든 예시예요. ' : ''}수집한 API 답변을 집계한 결과이며, 소비자용 AI 앱의 개인화된 답변과 다를 수 있어요.`;
/** First sentence that says something about the brand, with list markers and emphasis removed. */
const sentenceAbout = (text: string, brand: string) => text.split(/\n+/)
  .flatMap(line => line.replace(/^\s*(?:\d+\.|[-•*])\s+/, '').replace(/\*+/g, '').split(/(?<=[.!?。])\s+/))
  .map(part => part.trim()).find(part => part.includes(brand) && part.length > brand.length + 6)?.slice(0, 220);
const own = (evidence: AgentEvidence) => evidence.brands.find(brand => brand.isOwn)!;
const rivals = (evidence: AgentEvidence) => evidence.brands.filter(brand => !brand.isOwn);

/** Shown instead of analysis when the selected scope holds no completed answer. */
export function emptyDraft(agentName: string, evidence: AgentEvidence): AgentDraft {
  return {
    title: `${agentName}: 분석할 답변이 없어요`,
    summary: '선택한 기간과 모델에 완료된 답변이 없어 분석을 진행하지 않았어요. AI 사용량은 차감되지 않았어요.',
    report: `## 분석을 진행하지 않았어요\n\n${scopeLine(evidence)}\n\n이 조건에서 완료한 답변이 없어요. 기간이나 모델을 바꾸거나, 질문을 등록하고 답변을 먼저 수집해 주세요. 다른 기간의 답변은 근거로 쓰지 않았어요.`,
    proposals: [],
  };
}

function gapTask(question: AgentEvidence['questions'][number], brand: string): AgentDraft['proposals'][number] {
  return { kind: 'task', priority: question.competitorOnlyCount / Math.max(1, question.answerCount) >= 0.25 ? 'high' : 'medium', title: `‘${question.text.slice(0, 60)}’에 답하는 페이지 보완`, detail: `관측: 완료 답변 ${question.answerCount}개 중 ${question.competitorOnlyCount}개에서 경쟁사(${question.competitorNames.join(', ')})만 언급됐어요.\n할 일: 이 질문에 직접 답하는 문단과 ${brand}가 적합한 상황을 자사 페이지에 추가하세요.\n완료 기준: 같은 질문과 모델로 다시 수집해 언급 여부를 비교해요.` };
}

function brandHealth({ evidence, state, scope, asOf }: WriterContext): AgentDraft {
  const { overview, site } = evidence, gaps = gapQuestions(evidence, 3), leader = evidence.brands[0], me = own(evidence);
  const position = evidence.brands.findIndex(brand => brand.isOwn) + 1;
  const weakestModel = [...evidence.models].sort((a, b) => a.mentionRate - b.mentionRate)[0], strongestModel = [...evidence.models].sort((a, b) => b.mentionRate - a.mentionRate)[0];
  const weakestTopic = evidence.topics.find(topic => topic.mentionRate !== null);
  const sample = gaps[0] && answerExcerpts(state, scope, { promptId: gaps[0].id, limit: 1, only: 'own_missing' }, asOf)[0];
  const rivalLine = sample && sample.mentionedBrands[0] ? sentenceAbout(sample.text, sample.mentionedBrands[0]) : undefined;
  return {
    title: `${site.name} 브랜드 가시성 리포트`,
    summary: `${site.name}는 완료 답변 ${overview.answerCount}개 중 ${overview.mentionCount}개(${rate(overview.mentionRate)})에서 언급됐고, 추적 브랜드 ${evidence.brands.length}개 중 ${position}위예요.${gaps.length ? ` 경쟁사만 언급된 답변이 있는 질문은 ${evidence.questions.filter(q => q.competitorOnlyCount > 0).length}개예요.` : ''}`,
    report: [
      `## 한눈에 보기`, '', scopeLine(evidence), '',
      table(['지표', '값', '계산'], [
        ['브랜드 언급률', rate(overview.mentionRate), `언급 ${overview.mentionCount} / 완료 답변 ${overview.answerCount}`],
        ['언급 점유율', overview.totalBrandMentions ? rate(overview.shareOfVoice) : '측정 불가', `자사 ${overview.mentionCount} / 전체 브랜드 언급 ${overview.totalBrandMentions}`],
        ['브랜드 인용률', rate(overview.citationRate), `인용 ${overview.citationCount} / 인용 측정 가능 답변 ${overview.citationEligibleAnswerCount}`],
        ['평균 등장 순서', overview.averageRank === null ? '—' : `${num(overview.averageRank)}번째`, '브랜드가 등장한 답변 기준'],
      ]), '',
      `## 경쟁사와 비교`, '',
      table(['순위', '브랜드', '언급률', '점유율', '평균 등장 순서'], evidence.brands.map((brand, index) => [index + 1, brand.isOwn ? `**${brand.name}** (자사)` : brand.name, rate(brand.mentionRate), rate(brand.shareOfVoice), brand.averageRank === null ? '—' : `${num(brand.averageRank)}번째`])), '',
      leader && !leader.isOwn ? `언급률 1위는 ${leader.name}(${rate(leader.mentionRate)})이며 ${site.name}와의 차이는 ${num(leader.mentionRate - me.mentionRate)}%p예요.` : `${site.name}가 추적 브랜드 중 언급률이 가장 높아요.`, '',
      `## 모델별`, '',
      evidence.models.length > 1 ? table(['모델', '완료 답변', '언급률', '인용률'], evidence.models.map(model => [modelName(model.model), model.answerCount, rate(model.mentionRate), rate(model.citationRate)])) + `\n\n${modelName(strongestModel.model)}에서 가장 자주 언급되고(${rate(strongestModel.mentionRate)}), ${modelName(weakestModel.model)}에서 가장 적게 언급됩니다(${rate(weakestModel.mentionRate)}).` : '이 범위에는 한 모델의 답변만 있어 모델 간 비교는 하지 않았어요.', '',
      `## 주제별`, '',
      table(['주제', '질문', '완료 답변', '언급률', '경쟁사만 언급'], evidence.topics.map(topic => [topic.topic, topic.promptCount, topic.answerCount, rate(topic.mentionRate), topic.competitorOnlyCount])), '',
      weakestTopic ? `언급률이 가장 낮은 주제는 **${weakestTopic.topic}**(${rate(weakestTopic.mentionRate)})예요.` : '', '',
      `## 먼저 볼 질문`, '',
      gaps.length ? gaps.map((question, index) => `${index + 1}. **${question.text}**  \n   완료 답변 ${question.answerCount}개 중 ${question.competitorOnlyCount}개에서 ${question.competitorNames.join(', ')}만 언급`).join('\n') : '경쟁사만 언급된 답변이 없어요. 언급된 답변의 설명이 정확한지 확인해 보세요.', '',
      rivalLine ? `> 경쟁사가 소개된 문장 예시: “${rivalLine}”` : '',
      footer(evidence),
    ].filter(line => line !== undefined).join('\n'),
    proposals: [
      ...gaps.slice(0, 2).map(question => gapTask(question, site.name)),
      ...(weakestModel && strongestModel && weakestModel.model !== strongestModel.model && strongestModel.mentionRate - weakestModel.mentionRate >= 5 ? [{ kind: 'task' as const, priority: 'medium' as const, title: `${modelName(weakestModel.model)}에서 빠진 질문 확인`, detail: `관측: ${modelName(weakestModel.model)} 언급률 ${rate(weakestModel.mentionRate)}, ${modelName(strongestModel.model)} ${rate(strongestModel.mentionRate)}.\n할 일: 모델 필터를 ${modelName(weakestModel.model)}로 바꿔 미언급 답변의 원문을 읽고 공통으로 빠진 정보를 기록하세요.` }] : []),
    ],
  };
}

function weeklyReport({ evidence }: WriterContext): AgentDraft {
  const { overview, previous, site } = evidence;
  const delta = previous ? Math.round((overview.mentionRate - previous.mentionRate) * 10) / 10 : null;
  const gaps = gapQuestions(evidence, 3);
  const direction = delta === null ? '' : delta > 0 ? `${num(delta)}%p 올랐어요` : delta < 0 ? `${num(-delta)}%p 내렸어요` : '같아요';
  return {
    title: `${site.name} 주간 AEO 리포트`,
    summary: previous ? `최근 7일 언급률은 ${rate(overview.mentionRate)}로 그 전 7일(${rate(previous.mentionRate)})보다 ${direction}. 완료 답변은 ${overview.answerCount}개, 이전 기간은 ${previous.answerCount}개예요.` : `최근 ${evidence.scope.period}일 언급률은 ${rate(overview.mentionRate)}예요. 비교할 이전 기간의 답변이 없어 변화는 계산하지 않았어요.`,
    report: [
      `## 이번 주 요약`, '', scopeLine(evidence), '',
      previous ? table(['지표', '최근 7일', '그 전 7일', '변화'], [
        ['완료 답변', overview.answerCount, previous.answerCount, `${overview.answerCount - previous.answerCount >= 0 ? '+' : ''}${overview.answerCount - previous.answerCount}`],
        ['브랜드 언급률', rate(overview.mentionRate), rate(previous.mentionRate), `${delta! >= 0 ? '+' : ''}${num(delta!)}%p`],
        ['언급 점유율', rate(overview.shareOfVoice), rate(previous.shareOfVoice), `${overview.shareOfVoice - previous.shareOfVoice >= 0 ? '+' : ''}${num(overview.shareOfVoice - previous.shareOfVoice)}%p`],
        ['브랜드 인용률', rate(overview.citationRate), rate(previous.citationRate), overview.citationRate !== null && previous.citationRate !== null ? `${overview.citationRate - previous.citationRate >= 0 ? '+' : ''}${num(overview.citationRate - previous.citationRate)}%p` : '—'],
      ]) : `비교할 이전 기간이 없어요. 기간을 **최근 7일**로 두고 실행하면 그 전 7일과 비교해요.\n\n- 브랜드 언급률: ${rate(overview.mentionRate)} (언급 ${overview.mentionCount} / 완료 답변 ${overview.answerCount})\n- 언급 점유율: ${rate(overview.shareOfVoice)}`, '',
      previous && Math.min(overview.answerCount, previous.answerCount) < 20 ? '> 한쪽 기간의 완료 답변이 20개 미만이에요. 변화 폭은 표본 차이일 수 있어요.\n' : '',
      `## 경쟁사 순위`, '',
      table(['순위', '브랜드', '언급률', '점유율'], evidence.brands.map((brand, index) => [index + 1, brand.isOwn ? `**${brand.name}** (자사)` : brand.name, rate(brand.mentionRate), rate(brand.shareOfVoice)])), '',
      `## 날짜별 언급률`, '',
      table(['날짜', '완료 답변', '언급률'], evidence.trend.map(point => [point.date, point.answerCount, rate(point.mentionRate)])), '',
      `## 지켜볼 질문`, '',
      gaps.length ? gaps.map(question => `- **${question.text}** — 경쟁사만 언급 ${question.competitorOnlyCount} / ${question.answerCount}개`).join('\n') : '- 경쟁사만 언급된 답변이 없어요.',
      footer(evidence),
    ].join('\n'),
    proposals: gaps.slice(0, 2).map(question => gapTask(question, site.name)),
  };
}

function factCheck({ evidence, state, scope, asOf }: WriterContext): AgentDraft {
  const { site } = evidence;
  const excerpts = answerExcerpts(state, scope, { limit: 6, only: 'own_mentioned' }, asOf);
  const lines = excerpts.map(excerpt => ({ excerpt, line: sentenceAbout(excerpt.text, site.name) })).filter(item => item.line);
  const unique = [...new Map(lines.map(item => [item.line, item])).values()].slice(0, 5);
  return {
    title: `${site.name} 답변 정확도 점검`,
    summary: `${site.name}가 언급된 답변 ${evidence.overview.mentionCount}개 중 최근 ${excerpts.length}개에서 설명 문장 ${unique.length}개를 모았어요. 등록된 브랜드 정보와 대조해 확인이 필요한 항목을 표시했어요.`,
    report: [
      `## 기준이 된 브랜드 정보`, '', scopeLine(evidence), '',
      site.description ? `> ${site.description}` : '> 브랜드 설명이 등록되어 있지 않아요. 설정에서 제품 설명을 추가하면 더 정확하게 대조할 수 있어요.', '',
      `## AI가 ${site.name}를 설명한 문장`, '',
      unique.length ? table(['모델', '설명 문장', '확인'], unique.map(({ excerpt, line }) => [modelName(excerpt.model), `“${line}”`, site.description ? '브랜드 정보와 대조 필요' : '기준 정보 없음'])) : '설명 문장을 찾지 못했어요. 브랜드가 이름만 나열된 답변일 수 있어요.', '',
      `## 확인할 점`, '',
      `- 가격, 지원 범위, 연동 같은 구체적인 사실이 답변마다 다르게 나오는지 원문에서 확인하세요.`,
      `- 사실과 다른 설명이 반복되면 자사 사이트의 해당 정보를 한 문장으로 분명하게 적어 두세요.`,
      `- 규칙 기반 점검은 문장을 모아 보여 줄 뿐 사실 여부를 판정하지 않아요. AI 모델이 연결되면 문장별로 일치 여부를 판단해요.`,
      footer(evidence),
    ].join('\n'),
    proposals: unique.length ? [{ kind: 'task', priority: 'medium', title: `${site.name} 소개 문장 사실 확인`, detail: `관측: 답변 ${excerpts.length}개에서 브랜드 설명 문장 ${unique.length}개를 수집했어요.\n할 일: 각 문장을 공식 제품 정보와 대조하고, 다른 내용이 있으면 자사 페이지의 해당 설명을 보완하세요.` }] : [],
  };
}

function gapAnalysis({ evidence, state, scope, input, asOf }: WriterContext): AgentDraft {
  const { site } = evidence;
  const focused = evidence.questions.find(question => question.id === input.promptId);
  const gaps = focused ? [focused] : gapQuestions(evidence, 3);
  const sections = gaps.map((question, index) => {
    const sample = answerExcerpts(state, scope, { promptId: question.id, limit: 1, only: 'own_missing' }, asOf)[0];
    const rival = sample?.mentionedBrands[0], line = rival ? sentenceAbout(sample.text, rival) : undefined;
    return [`### ${index + 1}. ${question.text}`, '',
      `- 완료 답변 ${question.answerCount}개 중 자사 언급 ${question.mentionCount}개, 경쟁사만 언급 ${question.competitorOnlyCount}개`,
      question.competitorNames.length ? `- 대신 언급된 브랜드: ${question.competitorNames.join(', ')}` : '',
      line ? `- 경쟁사 소개 문장: “${line}” (${modelName(sample.model)})` : '',
      sample?.citations.length ? `- 이 답변의 인용 출처: ${sample.citations.map(citation => citation.domain).join(', ')}` : '',
      '', `**메울 방법**: 이 질문에 직접 답하는 문단을 자사 페이지에 두고, ${site.name}가 어떤 팀과 상황에 맞는지 구체적으로 적으세요. 경쟁사가 인용된 출처가 있으면 같은 주제의 자사 자료를 준비하세요.`].filter(Boolean).join('\n');
  });
  return {
    title: focused ? `질문 격차 분석: ${focused.text.slice(0, 40)}` : `${site.name} 질문 격차 분석`,
    summary: gaps.length ? `경쟁사만 언급된 답변이 많은 질문 ${gaps.length}개를 골랐어요. 가장 큰 격차는 ‘${gaps[0].text.slice(0, 50)}’로, 완료 답변 ${gaps[0].answerCount}개 중 ${gaps[0].competitorOnlyCount}개에서 ${site.name}가 빠졌어요.` : `선택한 범위에서 경쟁사만 언급된 답변이 없어요.`,
    report: [`## 격차가 큰 질문`, '', scopeLine(evidence), '', gaps.length ? sections.join('\n\n') : '모든 완료 답변에 자사가 언급됐거나, 경쟁사가 등록되어 있지 않아요. 경쟁사를 등록하면 격차를 계산할 수 있어요.', footer(evidence)].join('\n'),
    proposals: gaps.filter(question => question.competitorOnlyCount > 0).map(question => gapTask(question, site.name)),
  };
}

function competitorInsight({ evidence, state, scope, input, asOf }: WriterContext): AgentDraft {
  const { site } = evidence, me = own(evidence);
  const target = rivals(evidence).find(brand => brand.name === input.competitor || brand.domain === input.competitor) || rivals(evidence)[0];
  if (!target) return { title: `${site.name} 경쟁사 인사이트`, summary: '등록된 경쟁사가 없어 비교하지 않았어요.', report: `## 비교할 경쟁사가 없어요\n\n${scopeLine(evidence)}\n\n경쟁 브랜드를 등록하면 같은 답변에서 누가 더 자주, 먼저 언급되는지 비교할 수 있어요.`, proposals: [] };
  const wins = evidence.questions.filter(question => question.competitorNames.includes(target.name)).sort((a, b) => b.competitorOnlyCount - a.competitorOnlyCount).slice(0, 4);
  const sample = wins[0] && answerExcerpts(state, scope, { promptId: wins[0].id, limit: 2, only: 'own_missing' }, asOf).find(excerpt => excerpt.mentionedBrands.includes(target.name));
  const line = sample ? sentenceAbout(sample.text, target.name) : undefined;
  return {
    title: `경쟁사 인사이트: ${target.name}`,
    summary: `${target.name}의 언급률은 ${rate(target.mentionRate)}, ${site.name}는 ${rate(me.mentionRate)}예요. ${target.name}만 언급되고 ${site.name}가 빠진 답변이 있는 질문은 ${wins.length}개예요.`,
    report: [
      `## ${target.name}와 ${site.name}`, '', scopeLine(evidence), '',
      table(['지표', site.name, target.name], [
        ['언급률', rate(me.mentionRate), rate(target.mentionRate)], ['언급 점유율', rate(me.shareOfVoice), rate(target.shareOfVoice)],
        ['인용률', rate(me.citationRate), rate(target.citationRate)], ['평균 등장 순서', me.averageRank === null ? '—' : `${num(me.averageRank)}번째`, target.averageRank === null ? '—' : `${num(target.averageRank)}번째`],
      ]), '',
      `## ${target.name}가 앞서는 질문`, '',
      wins.length ? table(['질문', '주제', `${target.name} 포함 경쟁사만 언급`], wins.map(question => [question.text, question.topic, `${question.competitorOnlyCount} / ${question.answerCount}`])) : `${target.name}만 언급된 답변이 없어요.`, '',
      line ? `## 소개되는 방식\n\n> “${line}” (${modelName(sample!.model)})\n\n같은 질문에서 ${site.name}가 어떤 문장으로 소개되는지 원문에서 비교해 보세요.` : '',
      `\n## 전체 순위\n`, table(['순위', '브랜드', '언급률', '점유율'], evidence.brands.map((brand, index) => [index + 1, brand.isOwn ? `**${brand.name}** (자사)` : brand.name, rate(brand.mentionRate), rate(brand.shareOfVoice)])),
      footer(evidence),
    ].join('\n'),
    proposals: wins.slice(0, 2).map(question => ({ kind: 'task', priority: 'medium', title: `${target.name}와 비교 정보 보완: ${question.text.slice(0, 40)}`, detail: `관측: 이 질문의 완료 답변 ${question.answerCount}개 중 ${question.competitorOnlyCount}개에서 ${site.name} 없이 경쟁사만 언급됐어요.\n할 일: ${target.name}와 비교해 ${site.name}가 적합한 상황을 설명하는 비교 문단을 준비하세요. 확인할 수 있는 사실만 사용하세요.` })),
  };
}

function promptDiscovery({ evidence, input }: WriterContext): AgentDraft {
  const { site } = evidence, field = site.industry || `${site.name} 같은 서비스`;
  const intents = { informational: 0, comparison: 0, transactional: 0 };
  evidence.questions.filter(question => question.active).forEach(question => { intents[question.intent] += 1; });
  const rivalNames = rivals(evidence).map(brand => brand.name), topic = input.topic?.trim();
  const candidates: { text: string; topic: string; intent: 'informational' | 'comparison' | 'transactional' }[] = [
    { text: `${field}를 처음 도입할 때 확인해야 할 점은 무엇인가요?`, topic: topic || '도입', intent: 'informational' },
    { text: `${field}의 가격은 보통 어떻게 책정되나요?`, topic: topic || '가격', intent: 'transactional' },
    { text: `무료로 시작할 수 있는 ${field}를 추천해 주세요.`, topic: topic || '가격', intent: 'transactional' },
    { text: `${field}를 고를 때 보안과 권한 관리는 어떻게 비교하나요?`, topic: topic || '선택 기준', intent: 'comparison' },
    ...(rivalNames[0] ? [{ text: `${rivalNames[0]}를 대신할 만한 서비스를 추천해 주세요.`, topic: topic || '대안 탐색', intent: 'comparison' as const }] : []),
    ...(rivalNames.length > 1 ? [{ text: `${rivalNames[0]}와 ${rivalNames[1]}의 차이를 비교해 주세요.`, topic: topic || '제품 비교', intent: 'comparison' as const }] : []),
    { text: `${field}를 다른 업무 도구와 연동하려면 무엇을 확인해야 하나요?`, topic: topic || '연동', intent: 'informational' },
    { text: `${field}를 도입한 팀의 사례를 알려 주세요.`, topic: topic || '도입 사례', intent: 'informational' },
  ];
  const existing = new Set(evidence.questions.map(question => question.text));
  const fresh = candidates.filter(candidate => !existing.has(candidate.text)).slice(0, 6);
  return {
    title: `${site.name} 질문 발굴`,
    summary: `추적 중인 질문 ${evidence.questions.filter(q => q.active).length}개의 주제와 의도 분포를 확인하고, 비어 있는 영역의 질문 ${fresh.length}개를 제안했어요. 승인한 질문만 추적 목록에 추가돼요.`,
    report: [
      `## 지금 추적하는 질문`, '', table(['의도', '질문 수'], [['정보 탐색', intents.informational], ['비교 검토', intents.comparison], ['구매 고려', intents.transactional]]), '',
      table(['주제', '질문 수'], evidence.topics.map(row => [row.topic, row.promptCount])), '',
      `## 제안하는 질문`, '', fresh.length ? fresh.map((candidate, index) => `${index + 1}. ${candidate.text}  \n   주제: ${candidate.topic}`).join('\n') : '새로 제안할 질문이 없어요.', '',
      `브랜드 이름을 넣지 않은 질문을 우선했어요. 어떤 브랜드가 자연스럽게 추천되는지 보기 위해서예요. 검색량은 추정하지 않았어요.`,
      footer(evidence),
    ].join('\n'),
    proposals: fresh.map(candidate => ({ kind: 'prompt', title: candidate.text, detail: `주제: ${candidate.topic}`, topic: candidate.topic, intent: candidate.intent })),
  };
}

function pickTopic(evidence: AgentEvidence, requested?: string) {
  return evidence.topics.find(topic => topic.topic === requested) || evidence.topics.find(topic => topic.mentionRate !== null) || evidence.topics[0];
}

function contentBrief({ evidence, input }: WriterContext): AgentDraft {
  const { site } = evidence, topic = pickTopic(evidence, input.topic);
  const questions = evidence.questions.filter(question => question.active && (!topic || question.topic === topic.topic)).slice(0, 5);
  const competitorNames = [...new Set(questions.flatMap(question => question.competitorNames))];
  return {
    title: `콘텐츠 브리프: ${topic?.topic || site.name}`,
    summary: topic ? `언급률 ${rate(topic.mentionRate)}인 ‘${topic.topic}’ 주제의 브리프예요. 답해야 할 질문 ${questions.length}개와 다룰 내용을 정리했어요.` : '주제를 정할 수 있는 질문이 없어 일반 브리프를 만들었어요.',
    report: [
      `## 브리프`, '', scopeLine(evidence), '',
      table(['항목', '내용'], [
        ['주제', topic?.topic || '—'], ['목표 독자', `${site.industry || '제품'}을 찾거나 비교하는 실무자`],
        ['이 주제의 현재 상태', topic ? `완료 답변 ${topic.answerCount}개, 언급률 ${rate(topic.mentionRate)}, 경쟁사만 언급 ${topic.competitorOnlyCount}개` : '—'],
        ['함께 언급되는 경쟁사', competitorNames.join(', ') || '없음'],
      ]), '',
      `## 글이 답해야 할 질문`, '', questions.map((question, index) => `${index + 1}. ${question.text}`).join('\n'), '',
      `## 권장 구성`, '',
      `1. 질문에 대한 한 문단 요약 답변\n2. 선택 기준 3–5개와 각 기준의 설명\n3. ${site.name}가 맞는 상황과 맞지 않는 상황\n4. 자주 묻는 질문 3–5개`, '',
      `## 작성 전에 확인할 것`, '',
      `- 가격, 기능, 고객 사례 등 구체적인 사실은 공식 자료로 확인한 내용만 사용해요.\n- 경쟁사에 대한 서술은 확인할 수 있는 공개 정보로 제한해요.`,
      footer(evidence),
    ].join('\n'),
    proposals: [{ kind: 'task', priority: 'high', title: `‘${topic?.topic || site.name}’ 주제 콘텐츠 작성`, detail: `브리프 기준으로 초안을 작성하고 사실관계를 검토한 뒤 게시하세요.\n완료 기준: 게시 후 같은 주제의 질문을 다시 수집해 언급률(현재 ${rate(topic?.mentionRate ?? null)})을 비교해요.` }],
  };
}

function contentDraft({ evidence, input }: WriterContext): AgentDraft {
  const { site } = evidence, topic = input.topic?.trim() || evidence.topics[0]?.topic || site.industry || site.name;
  const related = evidence.questions.filter(question => question.active).slice(0, 4);
  return {
    title: topic.slice(0, 80),
    summary: `‘${topic.slice(0, 60)}’ 주제의 검토용 초안이에요. 규칙 기반 예시 구조이며, AI 모델이 연결되면 수집한 답변을 읽고 본문을 작성해요.`,
    report: [
      `# ${topic}`, '',
      `> 검토용 초안이에요. 게시 전에 사실관계와 표현을 확인하세요. [확인 필요]로 표시한 부분은 공식 자료로 채워야 해요.`, '',
      `## 먼저 정리할 것`, '', `팀이 실제로 일하는 방식부터 적어 보세요. 누가, 어떤 결정을, 어떤 자료를 보고 내리는지가 선택 기준이 돼요.`, '',
      `## 비교 기준`, '', `- 도입에 걸리는 시간과 초기 설정\n- 권한과 보안\n- 기존 도구와의 연동\n- 가격과 요금 구조 [확인 필요]`, '',
      `## ${site.name}가 맞는 상황`, '', `${site.description || `${site.name}의 제품 설명을 등록하면 이 문단을 채울 수 있어요.`} [확인 필요]`, '',
      `## 자주 묻는 질문`, '', related.map(question => `### ${question.text}\n\n[답변 작성 필요]`).join('\n\n'),
      footer(evidence),
    ].join('\n'),
    proposals: [{ kind: 'task', priority: 'medium', title: `초안 검토와 게시: ${topic.slice(0, 50)}`, detail: '[확인 필요] 표시를 공식 자료로 채우고 사실관계를 검토한 뒤 게시하세요.' }],
  };
}

function faqSchema({ evidence, input }: WriterContext): AgentDraft {
  const { site } = evidence;
  const questions = evidence.questions.filter(question => question.active && (!input.topic || question.topic === input.topic)).slice(0, 8);
  const jsonLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions.map(question => ({ '@type': 'Question', name: question.text, acceptedAnswer: { '@type': 'Answer', text: '[답변 작성 필요]' } })) };
  return {
    title: `${site.name} FAQ와 구조화 데이터`,
    summary: `추적 중인 질문 ${questions.length}개로 FAQ 문항과 FAQPage JSON-LD 틀을 만들었어요. 답변은 공식 정보로 채운 뒤 게시하세요.`,
    report: [
      `## FAQ 문항`, '', scopeLine(evidence), '', questions.map((question, index) => `${index + 1}. **${question.text}**  \n   현재 언급률 ${rate(question.mentionRate)} · [답변 작성 필요]`).join('\n'), '',
      `## FAQPage JSON-LD`, '', '```json', JSON.stringify(jsonLd, null, 2), '```', '',
      `답변을 채운 뒤 페이지에 보이는 FAQ와 같은 내용으로 JSON-LD를 넣으세요. 화면에 없는 내용을 구조화 데이터에만 넣지 않아요.`,
      footer(evidence),
    ].join('\n'),
    proposals: [{ kind: 'task', priority: 'medium', title: 'FAQ 답변 작성과 JSON-LD 적용', detail: `FAQ ${questions.length}문항의 답변을 공식 정보로 작성하고, 페이지 본문과 같은 내용으로 FAQPage JSON-LD를 추가하세요.` }],
  };
}

function sourcePlaybook({ evidence }: WriterContext): AgentDraft {
  const { site, sources, overview } = evidence;
  if (!sources.length) return { title: `${site.name} 인용 출처 공략`, summary: '이 범위의 답변에는 측정할 수 있는 인용이 없어요.', report: `## 인용 출처가 없어요\n\n${scopeLine(evidence)}\n\n웹 검색을 사용하는 모델(GPT, Claude, Perplexity)로 수집한 답변에서만 인용 출처를 측정해요. Gemini 일반 응답은 인용을 제공하지 않아요.`, proposals: [] };
  const byKind = (kind: string) => sources.filter(source => source.kind === kind);
  const rivalOnly = byKind('competitor').slice(0, 3), third = byKind('third_party').slice(0, 5), mine = byKind('own')[0];
  const kindLabel = { own: '자사', competitor: '경쟁사', third_party: '제3자' } as const;
  return {
    title: `${site.name} 인용 출처 공략`,
    summary: `인용 측정이 가능한 답변 ${overview.citationEligibleAnswerCount}개에서 도메인 ${sources.length}개가 인용됐어요. 자사 도메인 인용률은 ${mine ? rate(mine.rate) : '0%'}이고, 제3자 출처는 ${byKind('third_party').length}개예요.`,
    report: [
      `## 인용된 출처`, '', scopeLine(evidence), '',
      table(['도메인', '구분', '인용한 답변', '인용률'], sources.slice(0, 12).map(source => [source.domain, source.owner ? `${kindLabel[source.kind]} (${source.owner})` : kindLabel[source.kind], `${source.answers} / ${overview.citationEligibleAnswerCount}`, rate(source.rate)])), '',
      `## 출처별 조치`, '',
      mine ? `- **자사 (${mine.domain})**: 인용률 ${rate(mine.rate)}. 인용된 페이지가 질문에 직접 답하는지, 최신 정보인지 확인하세요.` : `- **자사**: 인용된 적이 없어요. 질문에 직접 답하는 페이지가 공개되어 있고 검색 엔진이 읽을 수 있는지 먼저 확인하세요.`,
      rivalOnly.length ? `- **경쟁사 도메인**: ${rivalOnly.map(source => `${source.domain}(${rate(source.rate)})`).join(', ')}. 같은 질문에 답하는 자사 자료가 있는지 비교하세요.` : '',
      third.length ? `- **제3자 출처**: ${third.map(source => source.domain).join(', ')}. 해당 글에 ${site.name}가 빠져 있다면 정보 제공이나 게재 제안을 검토하세요.` : `- **제3자 출처**: 인용된 리뷰, 커뮤니티, 매체가 없어요. 실제 검색 관측을 기록하면 더 넓은 출처를 볼 수 있어요.`,
      footer(evidence),
    ].filter(Boolean).join('\n'),
    proposals: [
      ...(third[0] ? [{ kind: 'task' as const, priority: 'medium' as const, title: `${third[0].domain}에 ${site.name} 정보 확인`, detail: `관측: ${third[0].domain}이 답변 ${third[0].answers}개에서 인용됐어요.\n할 일: 인용된 글(${third[0].url})에 ${site.name}가 소개되어 있는지 확인하고, 빠져 있으면 정보 제공을 검토하세요.` }] : []),
      ...(rivalOnly[0] ? [{ kind: 'task' as const, priority: 'medium' as const, title: `${rivalOnly[0].owner} 인용 페이지와 자사 자료 비교`, detail: `관측: ${rivalOnly[0].domain}이 답변 ${rivalOnly[0].answers}개에서 인용됐습니다(${rate(rivalOnly[0].rate)}).\n할 일: 인용된 페이지(${rivalOnly[0].url})가 다루는 질문을 확인하고, 같은 질문에 답하는 자사 페이지를 준비하세요.` }] : []),
    ],
  };
}

const writers: Record<string, (context: WriterContext) => AgentDraft> = {
  'brand-health': brandHealth, 'weekly-report': weeklyReport, 'fact-check': factCheck, 'gap-analysis': gapAnalysis, 'competitor-insight': competitorInsight,
  'prompt-discovery': promptDiscovery, 'content-brief': contentBrief, 'content-draft': contentDraft, 'faq-schema': faqSchema, 'source-playbook': sourcePlaybook,
};

/** Aggregation-only result: used for sample workspaces and when no AI request can complete. */
export function writeFromEvidence(agentId: string, context: WriterContext): AgentDraft {
  const writer = writers[agentId];
  if (!writer) throw new Error(`Unknown agent: ${agentId}`);
  return writer(context);
}

/** Sample workspaces answer chat questions from the aggregated numbers instead of a model. */
export function sampleChatReply(message: string, context: WriterContext): string {
  const { evidence } = context, { overview, site } = evidence;
  if (!overview.answerCount) return emptyDraft('질문', evidence).summary;
  const about = (pattern: RegExp) => pattern.test(message);
  const pick = about(/경쟁|비교|라이벌/) ? 'competitor-insight' : about(/출처|인용|링크/) ? 'source-playbook' : about(/콘텐츠|글|브리프|작성/) ? 'content-brief' : about(/주간|이번 주|지난주|변화/) ? 'weekly-report' : 'gap-analysis';
  const draft = writeFromEvidence(pick, context), gaps = gapQuestions(evidence, 3);
  const lines = [`샘플 데이터 기준으로 ${scopeLine(evidence)}예요. ${site.name}의 브랜드 언급률은 ${rate(overview.mentionRate)}(언급 ${overview.mentionCount} / ${overview.answerCount}), 인용률은 ${rate(overview.citationRate)}예요.`, '', draft.summary, ''];
  if (pick === 'gap-analysis' && gaps.length) lines.push('**먼저 볼 질문**', ...gaps.map((question, index) => `${index + 1}. ${question.text} — 경쟁사만 언급 ${question.competitorOnlyCount} / ${question.answerCount}개`), '');
  if (pick === 'competitor-insight') lines.push(table(['브랜드', '언급률', '점유율'], evidence.brands.map(brand => [brand.isOwn ? `**${brand.name}** (자사)` : brand.name, rate(brand.mentionRate), rate(brand.shareOfVoice)])), '');
  if (pick === 'source-playbook' && evidence.sources.length) lines.push(table(['도메인', '인용률'], evidence.sources.slice(0, 5).map(source => [source.domain, rate(source.rate)])), '');
  lines.push(`더 자세한 결과는 **${{ 'competitor-insight': '경쟁사 인사이트', 'source-playbook': '인용 출처 공략', 'content-brief': '콘텐츠 브리프', 'weekly-report': '주간 AEO 리포트', 'gap-analysis': '질문 격차 분석' }[pick]}** 에이전트를 실행해 보세요. ${site.name}의 샘플 데이터를 집계한 답이며, AI 모델은 사용하지 않았어요.`);
  return lines.join('\n');
}
