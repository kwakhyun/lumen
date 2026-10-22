import type { Answer, BrandMention, Citation, Competitor, Metrics, Prompt, Site } from './product-types';
export const METRICS_VERSION = 'lumen-metrics-v2';

/** Host matching intentionally does not accept suffix lookalikes such as brand.com.attacker.test. */
export function domainMatches(candidate: string, domain: string): boolean {
  const a = candidate.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  const b = domain.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  return a === b || a.endsWith(`.${b}`);
}
export function safeHttpUrl(value: string): URL | null {
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u : null;}catch{return null;}
}
export function normalizeDomain(value: string): string | null {
  const u=safeHttpUrl(value.includes('://')?value:`https://${value}`);
  if(!u || u.port || !u.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)||u.hostname.includes(':')) return null;
  const host=u.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  if (!/^[a-z0-9.-]+$/.test(host) || host.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-'))) return null;
  return host;
}
function firstMention(text:string,name:string,domain:string):number|null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Unicode-aware boundaries avoid matching, for example, Linear inside multilinear.
  const particles='으로|에서|에게|이라는|라는|입니다|이랑|보다|처럼|까지|부터|은|는|이|가|을|를|의|와|과|로|도|만|랑';
  const match = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_]|(?:${particles})(?=$|[^\\p{L}\\p{N}_]))`,'iu').exec(text);
  const brandPosition=match?match.index+match[1].length:null;
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const dm=new RegExp(`(^|[^a-z0-9.-])((?:[a-z0-9-]+\\.)*${escapedDomain})(?=$|[^a-z0-9.-])`,'i').exec(text);
  const domainPosition=dm?dm.index+dm[1].length:null;
  return brandPosition===null?domainPosition:domainPosition===null?brandPosition:Math.min(brandPosition,domainPosition);
}
/** Measure visible prose, not hidden link targets or analytics parameters. Keep offsets stable. */
function visibleMentionText(text:string):string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi,(raw:string,offset:number)=>{
    // Markdown target URLs are hidden; their visible labels remain in the surrounding text.
    if(/\]\(\s*$/.test(text.slice(0,offset)))return ' '.repeat(raw.length);
    const url=safeHttpUrl(raw);if(!url)return ' '.repeat(raw.length);
    // A visible bare URL can identify a brand by host, but its path/query/hash cannot.
    const host=url.hostname,at=raw.toLowerCase().indexOf(host.toLowerCase());
    return at<0?' '.repeat(raw.length):' '.repeat(at)+host+' '.repeat(Math.max(0,raw.length-at-host.length));
  });
}
export function extractMentions(text:string,citations:Citation[],brands:{name:string;domain:string}[]):BrandMention[] {
  const visible=visibleMentionText(text);
  const seen = new Set<string>();
  const uniqueBrands = brands.filter(brand => { const key = canonicalDomain(brand.domain); if (seen.has(key)) return false; seen.add(key); return true; });
  const result=uniqueBrands.map(brand=>{const pos=firstMention(visible,brand.name,brand.domain);return {name:brand.name,domain:brand.domain,mentioned:pos!==null,firstPosition:pos,rank:null as number|null,cited:citations.some(c=>domainMatches(c.domain,brand.domain))};});
  const ordered=result.filter(x=>x.mentioned).sort((a,b)=>a.firstPosition!-b.firstPosition!);
  ordered.forEach((x,i)=>{x.rank=i+1;});return result;
}
const pct = (n: number, d: number) => d ? Math.round(n / d * 1000) / 10 : 0;
const canonicalDomain = (domain: string) => domain.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

/** These collection adapters request web search. Unknown adapters fail closed. */
export function citationMeasurementAvailable(answer: Pick<Answer, 'mode' | 'model'>): boolean {
  return answer.mode === 'demo' || (answer.mode === 'live' && ['gpt-4.1-mini', 'perplexity/sonar'].includes(answer.model));
}

/** Do not promote generated URLs, synthetic live citations, or mismatched hosts into evidence. */
export function measuredCitations(answer: Pick<Answer, 'mode' | 'model' | 'citations'>): Citation[] {
  if (!citationMeasurementAvailable(answer)) return [];
  const provenance = answer.mode === 'demo' ? 'synthetic' : 'provider_annotation';
  return answer.citations.filter(citation => {
    const url = safeHttpUrl(citation.url);
    return citation.provenance === provenance && url !== null && canonicalDomain(url.hostname) === canonicalDomain(citation.domain);
  });
}
function uniqueAnswers(answers: Answer[]): Answer[] {
  const seen = new Set<string>();
  return answers.filter(answer => {
    if (!answer.id) return true;
    if (seen.has(answer.id)) return false;
    seen.add(answer.id);
    return true;
  });
}
function brandMention(answer: Answer, domain: string): BrandMention | undefined {
  // One answer contributes at most one mention for each domain, even with duplicate input records.
  return answer.mentions.filter(m => canonicalDomain(m.domain) === canonicalDomain(domain) && m.mentioned)
    .sort((a, b) => (a.firstPosition ?? Infinity) - (b.firstPosition ?? Infinity) || (a.rank ?? Infinity) - (b.rank ?? Infinity))[0];
}
export function computeMetrics(site: Pick<Site, 'name' | 'domain'> & Partial<Pick<Site, 'mode'>>, competitors: Pick<Competitor, 'name' | 'domain'>[], answers: Answer[], prompts: Pick<Prompt, 'id' | 'active'>[], history: Answer[] = answers): Metrics {
  const dataMode = site.mode ?? (answers.length > 0 && answers.every(a => a.mode === 'demo') ? 'demo' : 'live');
  const scoped = answers.filter(a => a.mode === dataMode);
  const unique = uniqueAnswers(scoped);
  const completed = unique.filter(a => a.status === 'completed');
  const eligible = completed.filter(citationMeasurementAvailable);
  const evidence = new Map(completed.map(a => [a, measuredCitations(a)]));
  const active = new Set(prompts.filter(p => p.active).map(p => p.id));
  const answered = new Set(completed.filter(a => active.has(a.promptId)).map(a => a.promptId));
  const mentioned = new Set(completed.filter(a => active.has(a.promptId) && brandMention(a, site.domain)).map(a => a.promptId));
  const uniqueBrands = new Map<string, { name: string; domain: string; isOwn: boolean }>();
  [site, ...competitors].forEach((brand, i) => {
    const key = canonicalDomain(brand.domain);
    if (!uniqueBrands.has(key)) uniqueBrands.set(key, { ...brand, isOwn: i === 0 });
  });
  const brandList = [...uniqueBrands.values()];
  const brands = brandList.map(brand => {
    const found = completed.flatMap(a => { const m = brandMention(a, brand.domain); return m ? [m] : []; });
    const ranked = found.filter(m => m.rank !== null);
    const citations = eligible.filter(a => evidence.get(a)!.some(c => domainMatches(c.domain, brand.domain))).length;
    return { name: brand.name, domain: brand.domain, isOwn: brand.isOwn, mentions: found.length, citations, mentionRate: pct(found.length, completed.length), citationRate: eligible.length ? pct(citations, eligible.length) : null, shareOfVoice: 0, averageRank: ranked.length ? Math.round(ranked.reduce((sum, m) => sum + m.rank!, 0) / ranked.length * 10) / 10 : null };
  });
  const own = brands.find(brand => brand.isOwn)!;
  const totalBrandMentions = brands.reduce((sum, brand) => sum + brand.mentions, 0);
  brands.forEach(brand => { brand.shareOfVoice = pct(brand.mentions, totalBrandMentions); });
  const dateMap = new Map<string, Answer[]>();
  for (const answer of uniqueAnswers(history.filter(a => a.mode === dataMode && a.status === 'completed'))) {
    const date = (answer.completedAt || answer.createdAt).slice(0, 10);
    dateMap.set(date, [...(dateMap.get(date) || []), answer]);
  }
  const series = [...dateMap].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
    const citationRows = rows.filter(citationMeasurementAvailable);
    const mentionCount = rows.filter(a => brandMention(a, site.domain)).length;
    const citationCount = citationRows.filter(a => measuredCitations(a).some(c => domainMatches(c.domain, site.domain))).length;
    return { date, answerCount: rows.length, mentionCount, citationCount, citationEligibleAnswerCount: citationRows.length, mentionRate: pct(mentionCount, rows.length), citationRate: citationRows.length ? pct(citationCount, citationRows.length) : null };
  });
  const sourceMap = new Map<string, { domain: string; citations: number; url: string; title: string }>();
  for (const answer of eligible) for (const citation of new Map(evidence.get(answer)!.map(c => [canonicalDomain(c.domain), c])).values()) {
    const domain = canonicalDomain(citation.domain);
    const previous = sourceMap.get(domain);
    sourceMap.set(domain, { domain, citations: (previous?.citations || 0) + 1, url: citation.url, title: citation.title });
  }
  return {
    metricsVersion: METRICS_VERSION, dataMode, totalAnswerCount: unique.length, answerCount: completed.length,
    failedAnswerCount: unique.filter(a => a.status === 'failed').length, pendingAnswerCount: unique.filter(a => ['pending', 'processing'].includes(a.status)).length,
    excludedModeAnswerCount: answers.length - scoped.length, duplicateAnswerCount: scoped.length - unique.length,
    promptCount: active.size, completedPromptCount: answered.size, mentionedPromptCount: mentioned.size,
    coverage: pct(answered.size, active.size), brandQuestionCoverage: active.size ? pct(mentioned.size, active.size) : null,
    mentionCount: own.mentions, citationCount: own.citations, totalBrandMentions,
    citationEligibleAnswerCount: eligible.length, citationExcludedAnswerCount: completed.length - eligible.length,
    mentionRate: own.mentionRate, citationRate: own.citationRate, shareOfVoice: own.shareOfVoice, averageRank: own.averageRank,
    brands, series, sources: [...sourceMap.values()].sort((a, b) => b.citations - a.citations),
  };
}
export function csvCell(value: unknown):string {
  let v=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(v))v=`'${v}`;return `"${v.replace(/"/g,'""')}"`;
}
export function trafficSource(referrer:string):string {
  const host=safeHttpUrl(referrer)?.hostname||'';
  const known:Record<string,string>={'chatgpt.com':'ChatGPT','chat.openai.com':'ChatGPT','perplexity.ai':'Perplexity','claude.ai':'Claude','gemini.google.com':'Gemini','copilot.microsoft.com':'Copilot','bing.com':'Bing','google.com':'Google'};
  return Object.entries(known).find(([domain])=>domainMatches(host,domain))?.[1] || (host?'Other':'Direct');
}
