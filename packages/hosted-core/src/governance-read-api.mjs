/**
 * Week 7 hosted governance: READ-ONLY, explicitly feature-gated operator API.
 * Staff identity is verified by Supabase Auth and current platform_staff rows.
 * Roles are loaded server-side, never trusted from user_metadata or request data.
 * Actual records are returned only to the corresponding least-privilege scope.
 *
 * No payout, privacy deletion, user verification, settlement, or mutable staff
 * assignment is offered here. Those require atomic server-only SQL RPC review.
 * This remains unusable until the founder enables the staging governance gate,
 * provisions a real active staff Auth account and approves an actual deployment.
 */
import {readSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {GOVERNANCE_ROLES} from '../../local-core/src/governance.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const BEARER=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const HEADERS={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const respond=(status,data)=>Response.json(data,{status,headers:HEADERS});
const denied=(status,code)=>respond(status,{error:code});
const fault=(status,code)=>Object.assign(new Error(code),{status,code});

function selectRows(rows,fields) {
 if(!Array.isArray(rows)||rows.length>100)throw fault(503,'GOVERNANCE_PROVIDER_ERROR');
 return rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw fault(503,'GOVERNANCE_PROVIDER_ERROR');
  return Object.fromEntries(fields.map(([name,alias=name])=>[alias,row[name]??null]));
 });
}
export function createHostedGovernanceHandler({getEnv=()=>process.env,fetcher=fetch}={}){
 if(typeof getEnv!=='function'||typeof fetcher!=='function')throw new TypeError('Invalid governance dependencies');
 return async function handle(request,{segments=[]}={}){
  const verb=request.method.toUpperCase(),path=segments.join('/');
  if(verb!=='GET')return denied(405,'METHOD_NOT_ALLOWED');
  if(!Array.isArray(segments)||segments.length!==1||
    !['permissions','dashboard','incidents','roles','retention','history'].includes(path))
    return denied(404,'NOT_FOUND');
  try {
   const env=getEnv();
   if(env?.STUDENT_CREATORS_GOVERNANCE_ENABLED!=='true'||env?.APP_DATA_MODE!=='hosted')
     return denied(503,'GOVERNANCE_DISABLED');
   const config=readSupabaseRuntimeConfig(env,{server:true});
   if(!config)return denied(503,'GOVERNANCE_DISABLED');
   const match=BEARER.exec(request.headers.get('authorization')??'');
   if(!match||match[1].length>8192)return denied(401,'AUTH_REQUIRED');
   const userResponse=await fetcher(config.url+'/auth/v1/user',{method:'GET',headers:{
     apikey:config.publishableKey,Authorization:'Bearer '+match[1],accept:'application/json'},
     cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
   if([401,403].includes(userResponse.status))return denied(401,'AUTH_REQUIRED');
   if(!userResponse.ok)return denied(503,'AUTH_PROVIDER_UNAVAILABLE');
   const user=await userResponse.json();
   if(!UUID.test(user?.id??'')||user?.is_anonymous===true||!user.email_confirmed_at)
     return denied(403,'STAFF_REQUIRED');
   async function getRows(table,params) {
     const dest=new URL(config.url+'/rest/v1/'+table);
     for(const [key,value] of Object.entries(params))dest.searchParams.set(key,String(value));
     const res=await fetcher(dest,{method:'GET',headers:{
       ...supabaseServerHeaders(config.serverKey),accept:'application/json'},
       cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
     if(!res.ok)throw fault(503,'GOVERNANCE_PROVIDER_ERROR');
     const rows=await res.json();
     if(!Array.isArray(rows))throw fault(503,'GOVERNANCE_PROVIDER_ERROR');
     return rows;
   }
   const staff=await getRows('platform_staff',{user_id:'eq.'+user.id,active:'eq.true',select:'user_id,role,active',limit:1});
   if(staff.length!==1||staff[0].user_id!==user.id||staff[0].active!==true||
      !['admin','moderator'].includes(staff[0].role))return denied(403,'STAFF_REQUIRED');
   const grants=await getRows('governance_staff_role_grants',{user_id:'eq.'+user.id,select:'role',limit:15});
   const capabilities=[...new Set(grants.flatMap(x=>Object.hasOwn(GOVERNANCE_ROLES,x.role)?GOVERNANCE_ROLES[x.role]:[]))].sort();
   if(!capabilities.length)return denied(403,'GOVERNANCE_FORBIDDEN');
   const required={
     permissions:'dashboard.read',dashboard:'dashboard.read',incidents:'incident.read',
     roles:'staff.assign',retention:'retention.review',history:'audit.read'
   }[path];
   if(!capabilities.includes(required))return denied(403,'GOVERNANCE_FORBIDDEN');
   if(path==='permissions')return respond(200,{capabilities});
   const configs={
     incidents:{table:'governance_incidents',select:'id,category,severity,summary,state,created_at,updated_at',
       fields:[['id'],['category'],['severity'],['summary'],['state'],['created_at','createdAt'],['updated_at','updatedAt']]},
     roles:{table:'governance_staff_role_grants',select:'user_id,role,granted_at',
       fields:[['user_id','userId'],['role'],['granted_at','grantedAt']]},
     retention:{table:'governance_retention_proposals',select:'id,dataset,days,state,created_at',
       fields:[['id'],['dataset'],['days'],['state'],['created_at','createdAt']]},
     history:{table:'audit_events',select:'id,actor_id,action,target_kind,target_id,created_at',
       fields:[['id'],['actor_id','actorId'],['action'],['target_kind','targetKind'],['target_id','targetId'],['created_at','createdAt']]}
   };
   if(path!=='dashboard'){
     const {table,select,fields}=configs[path];
     const rows=await getRows(table,{select,order:'created_at.desc',limit:50});
     const resource={incidents:'incidents',roles:'roles',retention:'proposals',history:'events'}[path];
     return respond(200,{[resource]:selectRows(rows,fields)});
   }
   // Counts only. No rows, legal ID evidence, message bodies or ledger entries.
   async function count(table) {
     const url=new URL(config.url+'/rest/v1/'+table);
     url.searchParams.set('select','id');url.searchParams.set('limit','1');
     const res=await fetcher(url,{method:'HEAD',headers:{
       ...supabaseServerHeaders(config.serverKey),prefer:'count=exact'},
       cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
     if(!res.ok)throw fault(503,'GOVERNANCE_PROVIDER_ERROR');
     const value=res.headers.get('content-range');
     const m=/^(?:\*|\d+-\d+)\/(\d+)$/.exec(value??'');
     if(!m)throw fault(503,'GOVERNANCE_PROVIDER_ERROR');
     return Number(m[1]);
   }
   const [incidents,retention,audit]=await Promise.all([
     count('governance_incidents'),count('governance_retention_proposals'),count('audit_events')
   ]);
   return respond(200,{dashboard:{
     incidentCases:incidents,retentionProposals:retention,auditEvents:audit,
     generatedAt:new Date().toISOString(),automaticDeletionEnabled:false,
     livePayoutsEnabled:false,policyApproved:false}});
  }catch{
   // Never serialize the secret key, provider URL, JWT, raw identity or request body.
   return denied(503,'GOVERNANCE_PROVIDER_ERROR');
  }
 };
}
