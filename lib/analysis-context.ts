import { filterDashboardAnswers, type DashboardScope } from './dashboard-scope';
import { computeMetrics, measuredCitations } from './metrics';
import type { SiteState } from './product-types';

/** The observation model is independent of the model used to generate a draft. */
export type AnalysisScopeMetadata = DashboardScope & {
  from: string;
  asOf: string;
  answerCount: number;
  totalAnswerCount: number;
  failedAnswerCount: number;
  pendingAnswerCount: number;
  citationEligibleAnswerCount: number;
  evidenceAnswerCount: number;
  truncated: boolean;
  sourceWindow: { days: number; answersReturned: number; totalAnswers: number };
};

/** Keep the metric sample identical to the dashboard; only prose excerpts are capped. */
export function buildAnalysisContext(
  state: SiteState,
  requestedScope: DashboardScope,
  asOf = Date.now(),
  { answerLimit = 6, textLimit = 2000 } = {},
) {
  const answers = filterDashboardAnswers(state.answers, requestedScope, asOf, state.site);
  const metrics = computeMetrics(state.site, state.competitors, answers, state.prompts);
  const completed = answers.filter(answer => answer.status === 'completed');
  const evidence = completed.slice(0, answerLimit).map(answer => ({
    id: answer.id,
    promptId: answer.promptId,
    question: answer.promptText,
    model: answer.model,
    completedAt: answer.completedAt || answer.createdAt,
    text: answer.text.slice(0, textLimit),
    citations: measuredCitations(answer),
  }));
  const scope: AnalysisScopeMetadata = {
    ...requestedScope,
    from: new Date(asOf - Number(requestedScope.period) * 86_400_000).toISOString(),
    asOf: new Date(asOf).toISOString(),
    answerCount: metrics.answerCount,
    totalAnswerCount: metrics.totalAnswerCount,
    failedAnswerCount: metrics.failedAnswerCount,
    pendingAnswerCount: metrics.pendingAnswerCount,
    citationEligibleAnswerCount: metrics.citationEligibleAnswerCount,
    evidenceAnswerCount: evidence.length,
    truncated: state.dataWindow?.truncated ?? false,
    sourceWindow: {
      days: state.dataWindow?.days ?? 30,
      answersReturned: state.dataWindow?.answersReturned ?? state.answers.length,
      totalAnswers: state.dataWindow?.totalAnswers ?? state.answers.length,
    },
  };
  return { scope, metrics, evidence, questions: [...new Set(completed.map(answer => answer.promptText))].slice(0, 20) };
}

/** Persist a server-authored scope snapshot even if the generated prose omits it. */
export function analysisScopeMarkdown(scope: AnalysisScopeMetadata): string {
  const window = scope.sourceWindow;
  return [
    '## 분석 기준',
    '',
    `- 기간: 최근 ${scope.period}일`,
    `- 관측 모델: ${scope.model === 'all' ? '전체 모델' : `\`${scope.model}\``}`,
    `- 집계 구간: ${scope.from} ~ ${scope.asOf} (UTC)`,
    `- 완료 답변: ${scope.answerCount}개 / 범위 내 답변: ${scope.totalAnswerCount}개 (실패 ${scope.failedAnswerCount}개, 대기 또는 수집 중 ${scope.pendingAnswerCount}개)`,
    `- 인용률 분모: 인용을 제공하는 완료 답변 ${scope.citationEligibleAnswerCount}개`,
    `- 개별 답변 근거: ${scope.evidenceAnswerCount}개 발췌. 지표는 범위 내 완료 답변 전체를 기준으로 계산합니다.`,
    scope.truncated
      ? `- 조회 한도: 최근 ${window.days}일 전체 답변 ${window.totalAnswers}개 중 ${window.answersReturned}개를 불러왔습니다. 선택 조건의 답변도 일부 누락될 수 있습니다.`
      : `- 조회 범위: 최근 ${window.days}일 답변 ${window.answersReturned}개를 불러왔으며 조회 한도에 따른 누락은 없습니다.`,
    '- 관측 모델은 수집된 답변의 모델이며, 문서를 생성하는 모델과 다를 수 있습니다.',
  ].join('\n');
}

export const EMPTY_ANALYSIS_MESSAGE = '이 조건에서 완료한 답변이 없어 브랜드 언급률, 인용률과 개선 우선순위를 분석할 수 없습니다. 선택한 기간과 모델을 확인하거나 해당 조건의 답변 수집을 완료해 주세요. 다른 기간이나 모델의 답변은 근거로 사용하지 않았습니다.';
