import type { ImpactArm, ImpactComparison, ImpactOutcome, ImpactPhase, ImpactSearch, ImpactStudy, ImpactSearchComparison, ImpactSearchCoverage } from './impact-types';
const arms = ['treatment', 'control'] as const, phases = ['before', 'after'] as const;
const difference = (a: number | null, b: number | null) => a === null || b === null ? null : b - a;
const percent = (a: number, b: number) => b ? a / b * 100 : null;
function ownCitation(row: ImpactSearch, domain: string) { return row.citations.some(citation => { if (citation.relation !== 'original_citation') return false; try { const host = new URL(citation.url).hostname.toLowerCase().replace(/^www\./, ''), own = domain.toLowerCase().replace(/^www\./, ''); return host === own || host.endsWith(`.${own}`); } catch { return false; } }); }
function eligible(row: ImpactSearch | undefined, metric: 'mention' | 'citation'): row is ImpactSearch { return !!row && !row.voidedAt && row.result === 'answer' && row.searchConfirmed && (metric === 'mention' ? row.brandMention !== 'uncertain' : row.citationReview === 'complete'); }
export function compareImpact(study: ImpactStudy, allSearches: ImpactSearch[], allOutcomes: ImpactOutcome[]): ImpactComparison {
  const searches = allSearches.filter(row => !row.voidedAt), outcomes = allOutcomes.filter(row => !row.voidedAt), { plan } = study;
  const coverage = {} as ImpactComparison['coverage'];
  for (const arm of arms) {
    coverage[arm] = {} as Record<ImpactPhase, ImpactSearchCoverage>;
    const queryIds = new Set(plan.queries.filter(query => query.arm === arm).map(query => query.id));
    for (const phase of phases) {
      const rows = searches.filter(row => row.phase === phase && queryIds.has(row.queryId)), planned = queryIds.size * plan.repetitions;
      coverage[arm][phase] = { planned, recorded: rows.length, missing: planned - rows.length, errors: rows.filter(row => row.result === 'error').length, noAiAnswer: rows.filter(row => row.result === 'no_ai_answer').length, unconfirmedSearch: rows.filter(row => row.result === 'answer' && !row.searchConfirmed).length, uncertainMention: rows.filter(row => row.result === 'answer' && row.brandMention === 'uncertain').length, unreviewedCitations: rows.filter(row => row.result === 'answer' && row.citationReview === 'not_reviewed').length };
    }
  }
  const search = {} as ImpactComparison['search'];
  for (const metric of ['mention', 'citation'] as const) {
    const result = {} as Record<ImpactArm, ImpactSearchComparison>;
    for (const arm of arms) {
      const queries = plan.queries.filter(query => query.arm === arm); let paired = 0, before = 0, after = 0;
      for (const query of queries) for (let repetition = 1; repetition <= plan.repetitions; repetition++) {
        const a = searches.find(row => row.queryId === query.id && row.repetition === repetition && row.phase === 'before'), b = searches.find(row => row.queryId === query.id && row.repetition === repetition && row.phase === 'after');
        if (!eligible(a, metric) || !eligible(b, metric)) continue;
        paired++; before += Number(metric === 'mention' ? a.brandMention === 'present' : ownCitation(a, study.brand.domain)); after += Number(metric === 'mention' ? b.brandMention === 'present' : ownCitation(b, study.brand.domain));
      }
      const beforeRate = percent(before, paired), afterRate = percent(after, paired);
      result[arm] = { paired, planned: queries.length * plan.repetitions, before: { numerator: before, denominator: paired, rate: beforeRate }, after: { numerator: after, denominator: paired, rate: afterRate }, deltaPp: difference(beforeRate, afterRate) };
    }
    search[metric] = { ...result, differenceInDifferencesPp: difference(result.control.deltaPp, result.treatment.deltaPp) };
  }
  const cells = (arm: ImpactArm, phase: ImpactPhase) => outcomes.find(row => row.arm === arm && row.phase === phase);
  const completeCells = arms.flatMap(arm => phases.map(phase => cells(arm, phase))).filter(Boolean).length;
  const comparable = completeCells === 4 && new Set(outcomes.map(row => JSON.stringify([row.source, row.sourceId]))).size === 1 && outcomes.every(row => row.currency === plan.currency);
  const conversionRate = {} as ImpactComparison['business']['conversionRate'], revenuePerSession = {} as ImpactComparison['business']['revenuePerSession'], revenueTotals = {} as ImpactComparison['business']['revenueTotals'];
  for (const arm of arms) {
    const before = cells(arm, 'before'), after = cells(arm, 'after');
    const conversion = (row?: ImpactOutcome) => comparable && row && row.convertingSessions !== null && row.sessions !== null ? percent(row.convertingSessions, row.sessions) : null;
    const revenue = (row?: ImpactOutcome) => comparable && row && row.revenueMinor !== null && row.sessions !== null && row.sessions > 0 ? row.revenueMinor / row.sessions : null;
    conversionRate[arm] = { before: conversion(before), after: conversion(after), deltaPp: difference(conversion(before), conversion(after)) };
    revenuePerSession[arm] = { before: revenue(before), after: revenue(after), deltaMinor: difference(revenue(before), revenue(after)) };
    revenueTotals[arm] = { before: before?.revenueMinor ?? null, after: after?.revenueMinor ?? null, deltaMinor: comparable ? difference(before?.revenueMinor ?? null, after?.revenueMinor ?? null) : null };
  }
  const caveats = [
    '직접 입력한 실제 서비스 관측 기록입니다. Lumen이 답변의 진위나 검색 실행을 독립 검증한 결과는 아닙니다.',
    '언급률과 인용률은 같은 질문과 회차에서 전후 모두 검색 확인된 AI 답변만 비교합니다. 오류, AI 답변 없음, 미확인 기록은 제외되므로 전체 이용자의 노출 확률과 다릅니다.',
    '비교 대상의 변화를 뺀 차이는 기술통계이며 콘텐츠 개선의 인과효과나 통계적 유의성을 증명하지 않습니다. 질문의 대표성, 비교 대상의 추세, 광고와 모델 변경을 함께 확인하세요.',
    '동일 질문의 반복 관측은 서로 독립적인 고객 표본이 아닙니다. 관측 횟수를 사용자 수로 해석하지 마세요.',
    '매출과 전환은 사용자가 같은 출처 ID, UTC 기간, 계획의 유입 범위와 귀속 규칙을 확인한 집계입니다. Lumen이 원본 보고서와 일치하는지 검증한 값은 아닙니다. AI 답변을 보고 나중에 직접 방문한 구매 등은 누락될 수 있습니다.',
  ];
  if (study.registration === 'retrospective') caveats.push('관측 기간이 시작된 뒤 등록한 사후 계획입니다. 결과를 보고 질문이나 기간을 선택했을 가능성을 배제할 수 없습니다.');
  if (Object.values(coverage).some(group => Object.values(group).some(row => row.missing > 0))) caveats.push('아직 기록하지 않은 관측이 있습니다. 누락을 0으로 계산하지 않습니다.');
  if (allSearches.some(row => row.voidedAt) || allOutcomes.some(row => row.voidedAt)) caveats.push('제외한 기록이 있습니다. 원본과 제외 사유를 확인해 선택적 제외가 있었는지 검토하세요.');
  if (!comparable) caveats.push('성과 비교에는 같은 출처와 속성·스토어 ID로 기록한 개선 대상과 비교 대상 전후 집계 4개가 필요합니다. UTC 기간과 계획의 귀속 규칙을 확인해야 하며, 출처가 다르거나 누락되면 비교값을 계산하지 않습니다.');
  if (outcomes.some(row => row.confounders.trim())) caveats.push('광고, 가격, 계절성 등 함께 달라진 조건이 기록되어 있습니다. 매출 변화의 다른 원인을 검토하세요.');
  return { coverage, search, business: { completeCells, comparable, conversionRate, conversionDifferenceInDifferencesPp: difference(conversionRate.control.deltaPp, conversionRate.treatment.deltaPp), revenuePerSession, revenueDifferenceInDifferencesMinor: difference(revenuePerSession.control.deltaMinor, revenuePerSession.treatment.deltaMinor), revenueTotals }, caveats };
}
