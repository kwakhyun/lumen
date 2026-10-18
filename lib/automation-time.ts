/** Wall-clock schedules use one occurrence per local calendar date, including DST folds. */
export type ScheduleTiming={frequency:'daily'|'weekly';timezone:string;hour:number;minute:number;weekdays?:number[]};
const formatters=new Map<string,Intl.DateTimeFormat>();
export function isValidTimeZone(timezone:string):boolean {
  if(typeof timezone!=='string'||timezone.length>80||!(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timezone)||timezone==='UTC'))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(0);return true;}catch{return false;}
}
function localParts(timestamp:number,timezone:string){
  let fmt=formatters.get(timezone);if(!fmt){fmt=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});if(formatters.size>100)formatters.clear();formatters.set(timezone,fmt);}
  const parts=Object.fromEntries(fmt.formatToParts(new Date(timestamp)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return {year:parts.year,month:parts.month,day:parts.day,hour:parts.hour,minute:parts.minute};
}
export function nextOccurrence(timing:ScheduleTiming,afterMs:number):number {
  if(!isValidTimeZone(timing.timezone)||!Number.isInteger(timing.hour)||timing.hour<0||timing.hour>23||!Number.isInteger(timing.minute)||timing.minute<0||timing.minute>59||!Number.isFinite(afterMs)||!['daily','weekly'].includes(timing.frequency))throw new RangeError('Invalid schedule timing.');
  const weekdays=[...new Set(timing.weekdays||[])];if(timing.frequency==='weekly'&&(!weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)))throw new RangeError('Weekly schedules need valid weekdays.');
  const local=localParts(afterMs,timing.timezone);
  for(let dayOffset=0;dayOffset<15;dayOffset++){
    const date=new Date(Date.UTC(local.year,local.month-1,local.day+dayOffset));if(timing.frequency==='weekly'&&!weekdays.includes(date.getUTCDay()))continue;
    const wall=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),timing.hour,timing.minute);
    const offsets=new Set<number>();
    for(let hours=-36;hours<=36;hours+=6){const sample=wall+hours*3600000,p=localParts(sample,timing.timezone);offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)-sample);}
    const matches=[...offsets].map(offset=>wall-offset).filter(candidate=>{const p=localParts(candidate,timing.timezone);return p.year===date.getUTCFullYear()&&p.month===date.getUTCMonth()+1&&p.day===date.getUTCDate()&&p.hour===timing.hour&&p.minute===timing.minute;}).sort((a,b)=>a-b);
    // Nonexistent spring-forward times are skipped. A repeated fall-back time runs only at its first occurrence.
    if(matches.length&&matches[0]>afterMs)return matches[0];
  }
  throw new RangeError('Unable to find the next schedule occurrence.');
}
