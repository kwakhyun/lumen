import type { Citation } from './product-types';
import { safeHttpUrl } from './metrics';
/** Accept citations only from the provider's typed annotations, never URLs extracted from generated prose. */
export function parseProviderResponse(value:unknown){
  const data=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  const texts:string[]=[];const citations:Citation[]=[];let offset=0;
  for(const item of Array.isArray(data.output)?data.output:[]){
    if(item?.type!=='message'||!Array.isArray(item.content))continue;
    for(const part of item.content){if(part?.type!=='output_text'||typeof part.text!=='string')continue;
      const text=part.text;for(const a of Array.isArray(part.annotations)?part.annotations:[]){if(a?.type!=='url_citation'||typeof a.url!=='string')continue;const u=safeHttpUrl(a.url);if(!u)continue;
        citations.push({url:u.href,title:typeof a.title==='string'?a.title:u.hostname,domain:u.hostname.toLowerCase().replace(/^www\./,''),startIndex:offset+Math.max(0,Math.min(text.length,Number.isFinite(a.start_index)?a.start_index:0)),endIndex:offset+Math.max(0,Math.min(text.length,Number.isFinite(a.end_index)?a.end_index:0)),provenance:'provider_annotation'});
      }texts.push(text);offset+=text.length+2;
    }
  }
  const usage=(data.usage&&typeof data.usage==='object'?data.usage:{}) as Record<string,unknown>;
  return {text:texts.join('\n\n'),citations,inputTokens:typeof usage.input_tokens==='number'?usage.input_tokens:0,outputTokens:typeof usage.output_tokens==='number'?usage.output_tokens:0,providerResponseId:typeof data.id==='string'?data.id:null};
}
