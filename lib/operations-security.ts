import { env } from 'cloudflare:workers';
import { ProductError } from './product-validation';
const configuredSecret=()=> (env as typeof env & {LUMEN_AUTOMATION_SECRET?:string}).LUMEN_AUTOMATION_SECRET?.trim()||'';
export function automationSecretConfigured(){return configuredSecret().length>=32;}
/** This bearer grants only the dedicated due-work tick endpoint, never user CRUD. */
export async function requireAutomationService(request:Request){
  const expected=configuredSecret();if(expected.length<32)throw new ProductError(503,'정기 수집 서비스 인증이 아직 설정되지 않았습니다.','automation_unconfigured');
  const authorization=request.headers.get('authorization')||'';
  const presented=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!presented||presented.length>512)throw new ProductError(401,'서비스 인증이 필요합니다.','invalid_service_auth');
  const [a,b]=await Promise.all([expected,presented].map(s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];if(diff!==0)throw new ProductError(401,'서비스 인증이 필요합니다.','invalid_service_auth');
}
