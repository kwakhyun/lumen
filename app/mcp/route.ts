import { z } from 'zod';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { sites } from '@/db/schema';
import { requireUser } from '@/lib/product-server';
import { ProductError } from '@/lib/product-validation';
import { limitedBody } from '@/lib/integration-security';
import { getUsageStatus } from '@/lib/usage';
import { getOperationsState } from '@/lib/operations-server';
import { tickDueSchedules } from '@/lib/automation-runner';

const tools = [
  { name: 'lumen_workspaces', description: 'List the authenticated user’s Lumen workspaces and remaining free AI call budget.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'lumen_operations', description: 'Read schedules, execution history, alerts and heartbeat for one owned Lumen workspace.', inputSchema: { type: 'object', properties: { siteId: { type: 'string', format: 'uuid' } }, required: ['siteId'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'lumen_collect_due', description: 'Resume pending collection and execute due schedules for the authenticated user. Only the exact server-configured operator identity can collect across all users; that response contains aggregate counts only. Enforces schedule end times, daily/monthly limits and persistent leases. Never creates schedules. If continuation is true, call again after retryAfterSeconds, at most 10 calls in one scheduled task.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 2 } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
];
const rpcInput = z.object({jsonrpc:z.literal('2.0'), id:z.union([z.string().max(200),z.number(),z.null()]).optional(), method:z.string().max(100),params:z.unknown().optional()}).strict();
const metadata = z.record(z.string(),z.unknown()).optional();
const callInput = z.object({name:z.string().min(1).max(100),arguments:z.unknown().optional(),_meta:metadata}).strict();
const empty = z.object({}).strict();
const noArguments = z.object({_meta:metadata}).strict();
const initializeInput = z.object({protocolVersion:z.string().min(1).max(100),capabilities:z.record(z.string(),z.unknown()),clientInfo:z.object({name:z.string().min(1).max(200),version:z.string().max(100)}).passthrough(),_meta:metadata}).strict();
// Sites discovery uses 2026-07-28; legacy initialize clients retain 2025-03-26.
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
const supportedVersions = ['2026-07-28','2025-03-26'];
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const rpcError=(id:unknown,code:number,message:string,status=200)=>json({jsonrpc:'2.0',id:id??null,error:{code,message}},status);

export async function POST(request:Request) {
  let id:unknown=null;
  let executingTool=false;
  let globalCollection=false;
  try {
    // The Site gateway supplies verified headers. Reject browser cross-origin submissions too.
    const origin=request.headers.get('origin');
    if(origin && origin!==new URL(request.url).origin) return rpcError(null,-32001,'Origin is not allowed.',403);
    const user=await requireUser();
    const protocol=request.headers.get('mcp-protocol-version');
    if(protocol && !supportedVersions.includes(protocol))return rpcError(null,-32600,'Unsupported MCP protocol version.',400);
    if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json') return rpcError(null,-32600,'application/json is required.',415);
    let input:unknown;try {input=JSON.parse(await limitedBody(request,32768));}catch(error){if(error instanceof ProductError)throw error;return rpcError(null,-32700,'Invalid JSON.',400);}
    const parsed=rpcInput.safeParse(input);if(!parsed.success)return rpcError(null,-32600,'Invalid request.',400);
    const rpc=parsed.data;id=rpc.id;
    if(rpc.method==='notifications/initialized'){
      if(id!==undefined||!noArguments.safeParse(rpc.params??{}).success)return rpcError(id,-32600,'Invalid initialized notification.',400);
      return new Response(null,{status:202,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(id===undefined)return rpcError(null,-32600,'An id is required for tool calls.',400);
    if(rpc.method==='server/discover'){noArguments.parse(rpc.params??{});return json({jsonrpc:'2.0',id,result:{supportedVersions:['2026-07-28'],capabilities:{tools:{}},serverInfo:{name:'lumen',version:'1.0.0'}}});}
    if(rpc.method==='initialize'){const init=initializeInput.parse(rpc.params);return json({jsonrpc:'2.0',id,result:{protocolVersion:supportedVersions.includes(init.protocolVersion)?init.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'lumen',version:'1.0.0'}}});}
    if(rpc.method==='ping'){noArguments.parse(rpc.params??{});return json({jsonrpc:'2.0',id,result:{}});}
    if(rpc.method==='tools/list'){noArguments.parse(rpc.params??{});return json({jsonrpc:'2.0',id,result:{tools}});}
    if(rpc.method!=='tools/call')return rpcError(id,-32601,'Method not found.');
    const call=callInput.safeParse(rpc.params);if(!call.success)return rpcError(id,-32602,'Invalid tool call.');
    let result:unknown;
    const args=call.data.arguments??{};
    if(call.data.name==='lumen_workspaces') {
      empty.parse(args);
      executingTool=true;
      const [rows,usage]=await Promise.all([getDb().select().from(sites).where(eq(sites.ownerId,user.userId)).limit(100),getUsageStatus(user.userId)]);
      result={workspaces:rows.map(s=>({id:s.id,name:s.name,domain:s.domain,mode:s.mode})),usage};
    } else if(call.data.name==='lumen_operations') {
      const {siteId}=z.object({siteId:z.string().uuid()}).strict().parse(args);
      executingTool=true;
      result=await getOperationsState(user.userId,siteId);
    } else if(call.data.name==='lumen_collect_due') {
      const {limit}=z.object({limit:z.number().int().min(1).max(2).default(1)}).strict().parse(args);
      executingTool=true;
      // Only Sites' trusted currentUser identity and server configuration grant this
      // capability. Arguments, email, request headers and whitespace never widen it.
      globalCollection=typeof env.LUMEN_OPERATOR_USER_ID==='string'&&env.LUMEN_OPERATOR_USER_ID.length>0&&env.LUMEN_OPERATOR_USER_ID===user.userId;
      const tick=await tickDueSchedules(globalCollection?{limit,entryPoint:'mcp_operator'}:{ownerId:user.userId,limit,entryPoint:'mcp_owner'});
      // An operator may advance work but cannot read another tenant's identifiers,
      // prompts, run data or errors through this endpoint. Keep a positive allowlist.
      result=globalCollection?{scope:'service',queued:tick.queued,processed:tick.processed,completed:tick.completed,failed:tick.failed,blocked:tick.blocked,continuation:tick.continuation,retryAfterSeconds:tick.retryAfterSeconds,skipped:tick.skipped}:tick;
    } else return rpcError(id,-32602,'Unknown tool.');
    return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}});
  } catch(error) {
    if(error instanceof z.ZodError)return rpcError(id,-32602,'Request parameters are invalid.');
    const code=error instanceof ProductError?error.code:'internal_error';
    const message=globalCollection?'Lumen could not complete this collection tick.':error instanceof ProductError?error.message:'Lumen could not complete this request.';
    if(error instanceof ProductError&&error.status===401)return rpcError(id,-32001,message,401);
    if(!executingTool)return rpcError(id,error instanceof ProductError?-32600:-32603,message,error instanceof ProductError?error.status:500);
    return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify({error:message,code:globalCollection?'collection_error':code})}],isError:true}});
  }
}
