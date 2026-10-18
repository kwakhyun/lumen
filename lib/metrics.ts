import type { Answer, BrandMention, Citation, Competitor, Metrics, Prompt, Site } from './product-types';

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
  const result=brands.map(brand=>{const pos=firstMention(visible,brand.name,brand.domain);return {...brand,mentioned:pos!==null,firstPosition:pos,rank:null as number|null,cited:citations.some(c=>domainMatches(c.domain,brand.domain))};});
  const ordered=result.filter(x=>x.mentioned).sort((a,b)=>a.firstPosition!-b.firstPosition!);
  ordered.forEach((x,i)=>{x.rank=i+1;});return result;
}
const pct=(n:number,d:number)=>d?Math.round(n/d*1000)/10:0;
export function computeMetrics(site:Pick<Site,'name'|'domain'>, competitors:Pick<Competitor,'name'|'domain'>[], answers:Answer[], prompts:Pick<Prompt,'id'|'active'>[], history:Answer[]=answers):Metrics {
  const completed=answers.filter(a=>a.status==='completed');
  const active=new Set(prompts.filter(p=>p.active).map(p=>p.id));
  const answered=new Set(completed.filter(a=>active.has(a.promptId)).map(a=>a.promptId));
  const brands=[site,...competitors].map((brand,i)=>{
    const mentions=completed.flatMap(a=>a.mentions.filter(m=>m.domain===brand.domain));
    const found=mentions.filter(m=>m.mentioned), ranked=found.filter(m=>m.rank!==null);
    return {name:brand.name,domain:brand.domain,isOwn:i===0,mentions:found.length,citations:mentions.filter(m=>m.cited).length,mentionRate:pct(found.length,completed.length),citationRate:pct(mentions.filter(m=>m.cited).length,completed.length),shareOfVoice:0,averageRank:ranked.length?Math.round(ranked.reduce((s,m)=>s+m.rank!,0)/ranked.length*10)/10:null};
  });
  const all=brands.reduce((s,b)=>s+b.mentions,0);brands.forEach(b=>{b.shareOfVoice=pct(b.mentions,all);});
  const dateMap=new Map<string,Answer[]>();for(const a of history.filter(x=>x.status==='completed')){const d=(a.completedAt||a.createdAt).slice(0,10);dateMap.set(d,[...(dateMap.get(d)||[]),a]);}
  const series=[...dateMap].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({date,answerCount:rows.length,mentionRate:pct(rows.filter(a=>a.mentions.some(m=>m.domain===site.domain&&m.mentioned)).length,rows.length),citationRate:pct(rows.filter(a=>a.mentions.some(m=>m.domain===site.domain&&m.cited)).length,rows.length)}));
  const sourceMap=new Map<string,{domain:string;citations:number;url:string;title:string}>();for(const a of completed)for(const c of new Map(a.citations.map(c=>[c.domain,c])).values()){const prev=sourceMap.get(c.domain);sourceMap.set(c.domain,{domain:c.domain,citations:(prev?.citations||0)+1,url:c.url,title:c.title});}
  return {answerCount:completed.length,promptCount:active.size,coverage:pct(answered.size,active.size),mentionRate:brands[0].mentionRate,citationRate:brands[0].citationRate,shareOfVoice:brands[0].shareOfVoice,averageRank:brands[0].averageRank,brands,series,sources:[...sourceMap.values()].sort((a,b)=>b.citations-a.citations)};
}
export function csvCell(value: unknown):string {
  let v=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(v))v=`'${v}`;return `"${v.replace(/"/g,'""')}"`;
}
export function trafficSource(referrer:string):string {
  const host=safeHttpUrl(referrer)?.hostname||'';
  const known:Record<string,string>={'chatgpt.com':'ChatGPT','chat.openai.com':'ChatGPT','perplexity.ai':'Perplexity','claude.ai':'Claude','gemini.google.com':'Gemini','copilot.microsoft.com':'Copilot','bing.com':'Bing','google.com':'Google'};
  return Object.entries(known).find(([domain])=>domainMatches(host,domain))?.[1] || (host?'Other':'Direct');
}
