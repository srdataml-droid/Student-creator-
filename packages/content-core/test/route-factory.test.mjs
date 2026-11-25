import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDraftRoute,buildCatalogRoute} from '../src/route-factory.mjs';
const session='99999999-9999-4999-8999-999999999999';
const makeToken=id=>'e30.'+Buffer.from(JSON.stringify({sub:id,session_id:session,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service-jwt'};
const student='11111111-1111-4111-8111-111111111111',school='22222222-2222-4222-8222-222222222222',course='33333333-3333-4333-8333-333333333333';
test('unconfigured routes fail closed without a provider request',async()=>{
 let called=0;const fetcher=async()=>{called++;throw new Error('should not run')};
 const d=buildDraftRoute({getEnv:()=>({}),fetcher});const c=buildCatalogRoute({getEnv:()=>({}),fetcher});
 assert.equal((await d(new Request('https://example.com/api/lessons/drafts',{method:'POST'}))).status,503);
 assert.equal((await c(new Request('https://example.com/api/lessons'))).status,503);
 assert.equal(called,0);
});
test('draft route maps authenticated identity and server persisted draft',async()=>{
 const fetched=[];const fetcher=async(url,options)=>{
  const u=new URL(url);fetched.push({path:u.pathname,method:options.method??'GET',headers:options.headers});
  if(u.pathname==='/auth/v1/user')return Response.json({id:student,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
  if(u.pathname.endsWith('/student_creators_session_active')||u.pathname.endsWith('/affiliation_eligible'))return Response.json(true);
  if(u.pathname.endsWith('/student_profiles'))return Response.json([{user_id:student,institution_id:school,verified_at:'2026-11-19',suspended:false}]);
  if(u.pathname.endsWith('/courses'))return Response.json([{id:course,institution_id:school,active:true}]);
  if(u.pathname.endsWith('/content_items')&&options.method==='POST')return Response.json([{id:'44444444-4444-4444-8444-444444444444',creator_id:student,course_id:course,topic_id:null,title:'Integration basics',status:'draft',creation_hash:JSON.parse(options.body).creation_hash}],{status:201});
  throw new Error('Unknown provider path '+u.pathname);
 };
 const handler=buildDraftRoute({getEnv:()=>env,fetcher});
 const request=new Request('https://site.example/api/lessons/drafts',{method:'POST',headers:{Authorization:'Bearer '+makeToken(student),'Idempotency-Key':'client-draft-attempt-1','Content-Type':'application/json'},body:JSON.stringify({courseId:course,title:'Integration basics',description:'Explain substitution',previewText:'Method explanation',rightsAttested:true})});
 const response=await handler(request);const data=await response.json();
 assert.equal(response.status,201);assert.equal(data.draft.status,'draft');
 assert.equal(fetched[0].headers.apikey,'public');
 assert.equal(fetched.find(x=>x.method==='POST').headers.apikey,'service-jwt');
});
test('catalog route uses public-only credentials and rejects nonpublished',async()=>{
 const keySeen=[];const fetcher=async(url,opts)=>{
  keySeen.push(opts.headers.apikey);const u=new URL(url);
  if(u.pathname.endsWith('/courses'))return Response.json([{id:course,active:true}]);
  return Response.json([{id:'44444444-4444-4444-8444-444444444444',course_id:course,creator_id:student,title:'Valid public lesson',description:'A note',preview_text:'A public preview',published_at:'2026-11-19',status:'published'}]);
 };
 const handler=buildCatalogRoute({getEnv:()=>({SUPABASE_URL:env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:env.SUPABASE_PUBLISHABLE_KEY}),fetcher});
 const res=await handler(new Request('https://site.example/api/lessons?courseId='+course));const json=await res.json();
 assert.equal(res.status,200);assert.equal(json.items.length,1);assert.deepEqual(keySeen,['public','public']);
});
