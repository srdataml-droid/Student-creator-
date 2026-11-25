import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedGovernanceHandler} from '../src/governance-read-api.mjs';

const staffId='99999999-9999-4999-8999-999999999999';
const otherId='49b89226-570e-4d53-a76a-64a2579a1276';
const goodToken='e30.'+Buffer.from(JSON.stringify({sub:staffId,session_id:staffId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signaturebase64';
const env={
 APP_DATA_MODE:'hosted',STUDENT_CREATORS_GOVERNANCE_ENABLED:'true',STUDENT_CREATORS_ENVIRONMENT:'production',STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_PAYSTACK_TEST_ENABLED:'false',
 STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',
 SUPABASE_URL:'https://jnkqmlbkkvccnxrgkpno.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_syntheticpublic123456',
 SUPABASE_SECRET_KEY:'sb_secret_syntheticserver123456'
};
function request(path,headers={}) {
 return new Request('https://app.example.test/api/governance/'+path,{method:'GET',headers:{
   authorization:'Bearer '+goodToken,...headers
 }});
}
function simulate({staff=true,roles=['governance_owner'],authenticatedId=staffId,confirmed=true,fail=false,session=true}={}){
 const calls=[];
 async function fetcher(input,options={}){
  if(fail)throw new Error('Synthetic server private credential failure');
  const u=new URL(input);calls.push({url:u.toString(),headers:options.headers,method:options.method});
  if(u.pathname==='/auth/v1/user')return Response.json({id:authenticatedId,email:'fixture@example.invalid',email_confirmed_at:confirmed?'2026-11-01T00:00:00Z':null,
   is_anonymous:false,user_metadata:{role:'admin',is_platform_owner:true}});
  if(u.pathname==='/rest/v1/rpc/student_creators_session_active')return Response.json(session);
  if(u.pathname.includes('/rest/v1/platform_staff'))return Response.json(staff?[{user_id:authenticatedId,role:'moderator',active:true}]:[]);
  if(u.pathname.includes('/rest/v1/governance_staff_role_grants')){
   if(u.searchParams.get('select')==='role')return Response.json(roles.map(role=>({role})));
   return Response.json([{user_id:staffId,role:'verification_reviewer',granted_at:'2026-11-20T00:00:00Z'}]);
  }
  if(options.method==='HEAD')return new Response(null,{status:200,headers:{'content-range':'*/0'}});
  if(u.pathname.includes('/rest/v1/governance_incidents'))
   return Response.json([{id:'11111111-1111-4111-8111-111111111111',severity:'high',
    category:'unauthorized_access',summary:'Synthetic incident with no real identities',state:'open',created_at:'2026-11-20',updated_at:'2026-11-20',private_evidence_path:'DO_NOT_RETURN'}]);
  if(u.pathname.startsWith('/rest/v1/rpc/week7_'))return Response.json({id:otherId,state:'open',policyApproved:false,automaticDeletion:false});
  if(u.pathname.includes('/rest/v1/governance_retention_proposals'))return Response.json([]);
  if(u.pathname.includes('/rest/v1/audit_events'))return Response.json([{id:staffId,actor_id:staffId,
   action:'security.incident.opened',target_kind:'governance_incident',target_id:otherId,created_at:'2026-11-20',
   reason:'Private incident evidence not to return'}]);
  throw Error('Unexpected mock provider access: '+u.pathname);
 }
 return {handler:createHostedGovernanceHandler({getEnv:()=>({...env}),fetcher}),calls};
}
test('disabled hosted governance does not contact Supabase at all',async()=>{
 const calls=[];
 const handler=createHostedGovernanceHandler({getEnv:()=>({...env,STUDENT_CREATORS_GOVERNANCE_ENABLED:'false'}),
  fetcher:async()=>{calls.push('called');throw Error('unexpected')}});
 const response=await handler(request('permissions'),{segments:['permissions']});
 assert.equal(response.status,503);
 assert.equal(calls.length,0);
 assert.equal((await response.json()).error,'GOVERNANCE_DISABLED');
});
test('authenticated active staff gets only stored role capabilities; metadata has no effect',async()=>{
 const {handler,calls}=simulate({roles:['verification_reviewer']});
 const response=await handler(request('permissions'),{segments:['permissions']});
 assert.equal(response.status,200,JSON.stringify({error:(await response.clone().json()).error,paths:calls.map(x=>new URL(x.url).pathname)}));
 const body=await response.json();
 assert.deepEqual(body.capabilities,['dashboard.read','verification.review']);
 assert.equal((await handler(request('incidents'),{segments:['incidents']})).status,403);
 assert.equal((await handler(request('roles'),{segments:['roles']})).status,403);
 assert.ok(calls.some(x=>x.url.includes('/auth/v1/user')));
 assert.equal(calls.every(x=>!x.url.includes('private_evidence')),true);
 assert.equal(JSON.stringify(body).includes(env.SUPABASE_SECRET_KEY),false);
 const s=calls.filter(x=>x.url.includes('platform_staff'))[0];
 assert.equal(s.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(Object.hasOwn(s.headers,'authorization'),false); // Opaque sb_secret_ is not JWT.
});
test('anonymous, unconfirmed and inactive staff are rejected with zero governance row disclosure',async()=>{
 const x=simulate();
 assert.equal((await x.handler(new Request('https://app.example.test/api/governance/permissions'),
  {segments:['permissions']})).status,401);
 const unconfirmed=simulate({confirmed:false});
 assert.equal((await unconfirmed.handler(request('permissions'),{segments:['permissions']})).status,401);
 const disabled=simulate({staff:false});
 assert.equal((await disabled.handler(request('dashboard'),{segments:['dashboard']})).status,403);
 assert.equal(disabled.calls.some(x=>x.url.includes('/rest/v1/governance_staff_role_grants')),false);
});
test('owner can see role-scoped metadata, incident queue and audit history without evidence payloads',async()=>{
 const x=simulate();
 const roles=await x.handler(request('roles'),{segments:['roles']});
 assert.equal(roles.status,200,JSON.stringify({error:(await roles.clone().json()).error,paths:x.calls.map(y=>new URL(y.url).pathname)}));
 assert.equal((await roles.json()).roles[0].role,'verification_reviewer');
 const rights=await x.handler(request('incidents'),{segments:['incidents']});
 assert.equal(rights.status,200);
 const incidentBody=await rights.json();
 assert.equal(incidentBody.incidents.length,1);
 assert.equal(JSON.stringify(incidentBody).includes('DO_NOT_RETURN'),false);
 const history=await x.handler(request('history'),{segments:['history']});
 assert.equal(history.status,200);
 assert.equal(JSON.stringify(await history.json()).includes('Private incident evidence'),false);
 const dashboards=await x.handler(request('dashboard'),{segments:['dashboard']});
 assert.equal(dashboards.status,200);
 assert.equal((await dashboards.json()).dashboard.livePayoutsEnabled,false);
 assert.equal(x.calls.filter(c=>c.method==='HEAD').length,3);
});
test('hosted API fails closed on unknown path, unsupported mutation and spoofed request actor',async()=>{
 const x=simulate({roles:['auditor']});
 assert.equal((await x.handler(request('roles?userId='+otherId),{segments:['roles']})).status,403);
 assert.equal((await x.handler(request('audit-extra'),{segments:['audit-extra']})).status,404);
 const post=new Request('https://app.example.test/api/governance/incidents',{method:'POST',
  headers:{authorization:'Bearer '+goodToken,'content-type':'application/json'},
  body:JSON.stringify({role:'governance_owner',actorId:staffId,category:'fraud'})});
 assert.equal((await x.handler(post,{segments:['incidents']})).status,403);
 const cap=await x.handler(request('permissions',{'x-user-id':otherId}),{segments:['permissions']});
 assert.equal((await cap.json()).capabilities.includes('staff.assign'),false);
});
test('provider errors remain sanitized and no server key or token leaks',async()=>{
 const x=simulate({fail:true});
 const response=await x.handler(request('permissions'),{segments:['permissions']});
 assert.equal(response.status,503);
 const json=await response.json();
 assert.equal(json.error,'GOVERNANCE_PROVIDER_ERROR');
 assert.equal(JSON.stringify(json).includes('syntheticserver'),false);
 assert.equal(JSON.stringify(json).includes(goodToken),false);
});


test('hosted operator changes only via scoped atomic RPC with verified actor ID',async()=>{
 const x=simulate();
 const post=(segments,body,headers={})=>x.handler(new Request('https://app.example.test/api/governance/'+segments.join('/'),{
  method:'POST',headers:{authorization:'Bearer '+goodToken,'content-type':'application/json',...headers},
  body:JSON.stringify(body)
 }),{segments});
 const incident=await post(['incidents'],{category:'data_exposure',severity:'high',
  summary:'Synthetic notification for an internal staging security drill.'});
 assert.equal(incident.status,201);
 const call=x.calls.find(c=>c.url.endsWith('/rpc/week7_open_incident'));
 assert.ok(call);
 assert.equal(call.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(Object.hasOwn(call.headers,'authorization'),false);
 const bad=await post(['incidents'],{category:'data_exposure',severity:'high',
  summary:'Synthetic notification for an internal staging security drill.',
  actorId:otherId,staffRole:'governance_owner'});
 assert.equal(bad.status,422);
 const mismatched=await post(['roles','assign'],{userId:otherId,role:'invented_owner'});
 assert.equal(mismatched.status,422);
 const grant=await post(['roles','assign'],{userId:otherId,role:'verification_reviewer'});
 assert.equal(grant.status,200,JSON.stringify({response:await grant.clone().json(),rpcPaths:x.calls.filter(c=>c.url.includes('/rpc/week7_')).map(c=>new URL(c.url).pathname)}));
 const retention=await post(['retention'],{dataset:'verification_evidence',days:30,
  rationale:'Propose evidence minimization pending legal and founder approval.'});
 assert.equal(retention.status,201);
 const n=await post(['incidents',otherId,'transition'],{state:'investigating',
  note:'Review the affected synthetic staging route.'});
 assert.equal(n.status,200);
 assert.equal((await post(['incidents',otherId,'transition'],{state:'resolved',note:'Bypass state'})).status,200);
 // Backend only validates allowed state values; PostgreSQL RPC enforces order.
 assert.equal((await post(['retention',otherId,'reject'],{note:'Proposed duration not accepted.'})).status,200);
 assert.equal((await post(['student-id-export'],{userId:otherId})).status,404);
 assert.equal((await post(['incidents'],{category:'other',severity:'low',
  summary:'Cross-site submission must fail before RPC.'},{origin:'https://evil.invalid'})).status,403);
 const allRpc=x.calls.filter(v=>v.url.includes('/rpc/week7_'));
 assert.equal(allRpc.length,6);
});

test('revoked staff session fails before reading governance data',async()=>{const x=simulate({session:false});assert.equal((await x.handler(request('permissions'),{segments:['permissions']})).status,401);assert.equal(x.calls.some(c=>c.url.includes('/rest/v1/platform_staff')),false);});

test('scoped review queues validate bounded limits independently of identity decisions',async()=>{for(const [role,path,rpc] of [['content_moderator','copyright/claims','week7_copyright_queue'],['privacy_reviewer','privacy/requests','week7_privacy_queue'],['finance_reviewer','finance/access-reviews','week7_paid_access_queue'],['finance_reviewer','finance/payouts','week7_payout_queue'],['privacy_reviewer','privacy/fulfilment','week7_privacy_fulfilment_queue']]){const {handler,calls}=simulate({roles:[role]});const send=body=>handler(new Request('https://app.example.test/api/governance/'+path,{method:'POST',headers:{authorization:'Bearer '+goodToken,'content-type':'application/json',origin:'https://app.example.test'},body:JSON.stringify(body)}),{segments:path.split('/')});assert.equal((await send({limit:25})).status,200);assert.ok(calls.some(c=>c.url.endsWith('/rpc/'+rpc)));assert.equal((await send({limit:101})).status,422);assert.equal((await send({decision:'approve',days:20})).status,422);}});

test('both existing privacy fulfilment route families retain scoped commands',async()=>{const p=simulate({roles:['privacy_reviewer']});const f=simulate({roles:['finance_reviewer']});for(const [path,body,rpc] of [['privacy/requests/'+otherId+'/record-fulfilment',{reference:'evidence-reference',summary:'Synthetic independent evidence record'},'week7_record_privacy_fulfilment'],['privacy/fulfilment/'+otherId+'/record',{reference:'evidence-reference',summary:'Synthetic independent evidence record'},'week7_record_privacy_fulfilment'],['privacy/requests/'+otherId+'/confirm-fulfilment',{note:'Synthetic confirmation'},'week7_confirm_privacy_fulfilment'],['privacy/fulfilment/'+otherId+'/confirm',{note:'Synthetic confirmation'},'week7_confirm_privacy_fulfilment']]){const send=x=>x.handler(new Request('https://app.example.test/api/governance/'+path,{method:'POST',headers:{authorization:'Bearer '+goodToken,'content-type':'application/json',origin:'https://app.example.test'},body:JSON.stringify(body)}),{segments:path.split('/')});assert.equal((await send(p)).status,200);assert.equal((await send(f)).status,403);assert.ok(p.calls.some(c=>c.url.endsWith('/rpc/'+rpc)));}});

test('payout review has no transfer action and is finance scoped',async()=>{const send=(x,decision)=>x.handler(new Request('https://app.example.test/api/governance/finance/payouts/'+otherId+'/review',{method:'POST',headers:{authorization:'Bearer '+goodToken,'content-type':'application/json',origin:'https://app.example.test'},body:JSON.stringify({decision,note:'Synthetic review note'})}),{segments:['finance','payouts',otherId,'review']});const f=simulate({roles:['finance_reviewer']});assert.equal((await send(f,'reserve')).status,200);assert.equal((await send(f,'transfer')).status,422);assert.equal((await send(simulate({roles:['privacy_reviewer']}),'reserve')).status,403);});

test('payout liability report is read only, rejects injected inputs and requires finance scope',async()=>{
 const send=(x,body)=>x.handler(new Request('https://app.example.test/api/governance/finance/payout-liabilities',{method:'POST',headers:{authorization:'Bearer '+goodToken,'content-type':'application/json',origin:'https://app.example.test'},body:JSON.stringify(body)}),{segments:['finance','payout-liabilities']});
 const f=simulate({roles:['finance_reviewer']});assert.equal((await send(f,{})).status,200);assert.ok(f.calls.some(c=>c.url.endsWith('/rpc/week7_payout_liability_report')));
 assert.equal((await send(f,{_actor:otherId})).status,422);assert.equal((await send(simulate({roles:['privacy_reviewer']}),{})).status,403);
});

test('payout transfer authorization and bank review are finance scoped and reject direct provider fields',async()=>{
 const send=(x,body)=>x.handler(new Request('https://app.example.test/api/governance/finance/payouts/'+otherId+'/transfer',{method:'POST',headers:{authorization:'Bearer '+goodToken,'content-type':'application/json',origin:'https://app.example.test'},body:JSON.stringify(body)}),{segments:['finance','payouts',otherId,'transfer']});
 const f=simulate({roles:['finance_reviewer']});assert.equal((await send(f,{action:'authorize'})).status,200);assert.ok(f.calls.some(c=>c.url.endsWith('/rpc/week7_manage_payout_transfer')));
 assert.equal((await send(f,{action:'confirm_paid'})).status,422);assert.equal((await send(f,{action:'authorize',amount:2000})).status,422);assert.equal((await send(simulate({roles:['privacy_reviewer']}),{action:'authorize'})).status,403);
});
