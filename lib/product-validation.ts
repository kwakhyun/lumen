import { z } from 'zod';
import { normalizeDomain } from './metrics';
export class ProductError extends Error { status:number; code:string; constructor(status:number,message:string,code='request_failed'){super(message);this.status=status;this.code=code;} }
export const domainInput=z.string().trim().min(3).max(253).transform((v,ctx)=>{const d=normalizeDomain(v);if(!d){ctx.addIssue({code:z.ZodIssueCode.custom,message:'Enter a public website domain, such as example.com.'});return z.NEVER;}return d;});
export const siteInput=z.object({name:z.string().trim().min(2).max(100),domain:domainInput,description:z.string().trim().max(2000).default(''),industry:z.string().trim().max(100).default(''),language:z.string().trim().min(2).max(50).default('English'),country:z.string().trim().length(2).transform(s=>s.toUpperCase()).default('US')}).strict();
export const promptInput=z.object({text:z.string().trim().min(5).max(1000),topic:z.string().trim().min(1).max(80).default('General'),intent:z.enum(['informational','comparison','transactional']).default('informational'),active:z.boolean().default(true),pinned:z.boolean().default(false)}).strict();
export const competitorInput=z.object({name:z.string().trim().min(2).max(100),domain:domainInput}).strict();
export const personaInput=z.object({name:z.string().trim().min(2).max(100),description:z.string().trim().max(1000).default(''),promptPrefix:z.string().trim().max(500).default('')}).strict();
export const taskInput=z.object({title:z.string().trim().min(3).max(200),description:z.string().trim().max(2000).default(''),status:z.enum(['todo','in_progress','done']).default('todo'),priority:z.enum(['high','medium','low']).default('medium')}).strict();
export const documentInput=z.object({kind:z.enum(['report','content']),topic:z.string().trim().min(3).max(500).optional(),format:z.enum(['article','comparison','faq','report','listicle','how-to']).default('article')}).strict();
export const documentPatch=z.object({title:z.string().trim().min(3).max(200).optional(),content:z.string().trim().min(1).max(60000).optional()}).strict();
export const runInput=z.object({models:z.array(z.string().max(60)).min(1).max(3),mode:z.enum(['live','demo']),promptIds:z.array(z.string().uuid()).min(1).max(20).optional()}).strict();
export function assertSameOrigin(request:Request){
  const origin=request.headers.get('origin');
  const own=new URL(request.url).origin;
  if(!origin || origin!==own || request.headers.get('sec-fetch-site')==='cross-site')throw new ProductError(403,'This action must be sent from this application. Reload the page and try again.','invalid_origin');
}
export async function readJson<S extends z.ZodTypeAny>(request:Request,schema:S,maxBytes=32768):Promise<z.output<S>>{
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ProductError(415,'Send application/json.','invalid_content_type');
  if(Number(request.headers.get('content-length')||0)>maxBytes)throw new ProductError(413,'Request is too large.','body_too_large');
  // Stream with an actual byte bound; Content-Length alone is attacker controlled.
  const reader=request.body?.getReader();if(!reader)throw new ProductError(400,'JSON body is required.','invalid_json');
  let length=0;const chunks:Uint8Array[]=[];
  try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new ProductError(413,'Request is too large.','body_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  const combined=new Uint8Array(length);let offset=0;for(const c of chunks){combined.set(c,offset);offset+=c.length;}
  let data:unknown;try{data=JSON.parse(new TextDecoder().decode(combined));}catch{throw new ProductError(400,'Invalid JSON body.','invalid_json');}
  const parsed=schema.safeParse(data);if(!parsed.success)throw new ProductError(400,parsed.error.issues.map(i=>`${i.path.join('.')||'Input'}: ${i.message}`).join('; '),'invalid_input');return parsed.data;
}
