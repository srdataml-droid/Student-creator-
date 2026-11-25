import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyHostedAuth} from '../../../scripts/verify-hosted-auth.mjs';
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const token=n=>'e30.'+Buffer.from(JSON.stringify({sub:id,session_id:sid,role:'authenticated',exp:Math.floor(Date.now()/1000)+600,n})).toString('base64url')+'.signature';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_AUTH_ACCEPTANCE_ENABLED:'true',
 STUDENT_CREATORS_AUTH_TEST_PASSWORD:'synthetic-password-12345',STUDENT_CREATORS_AUTH_ORIGIN:'https://staging.example.invalid',
 supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server'};
function fixture({staleAccess=false,rotate=true,settingsSafe=true}={}){
 let active=false,logouts=0;const calls=[];
 const user={id,email:'wk-auth-test@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false};
 const fetcher=async(url,opts)=>{
  const u=new URL(url),p=u.pathname;calls.push(p);
  if(p==='/auth/v1/settings')return Response.json({disable_signup:settingsSafe,mailer_autoconfirm:false,external:{anonymous_users:false,email:true}});
  if(p==='/auth/v1/token'){
   const refresh=u.searchParams.get('grant_type')==='refresh_token';active=true;
   return Response.json({user,access_token:token(refresh?2:1),refresh_token:refresh&&rotate?'synthetic_refresh_2':'synthetic_refresh_1',expires_in:600});
  }
  if(p==='/auth/v1/user')return Response.json(user);
  if(p.endsWith('/student_creators_session_active'))return Response.json(active);
  if(p==='/rest/v1/student_profiles')return Response.json(active||staleAccess?[{user_id:id}]:[]);
  if(p==='/auth/v1/logout'){active=false;logouts++;return new Response(null,{status:204});}
  throw Error('unexpected');
 };
 return {fetcher,calls,get active(){return active;},get logouts(){return logouts;}};
}
test('real Auth acceptance orchestration verifies login, refresh, revocation and direct RLS',async()=>{
 const f=fixture();const result=await verifyHostedAuth({env,fetcher:f.fetcher});
 assert.equal(result.status,'passed');assert.equal(result.staleAccessDenied,true);assert.equal(f.active,false);assert.equal(f.logouts,1);
});
test('stale Data API profile access fails despite successful logout',async()=>{
 const f=fixture({staleAccess:true});await assert.rejects(verifyHostedAuth({env,fetcher:f.fetcher}),{code:'STALE_TOKEN_PROFILE_ACCESS'});
 assert.equal(f.active,false);
});
test('refresh failure triggers local session cleanup; unsafe settings never log in',async()=>{
 const f=fixture({rotate:false});await assert.rejects(verifyHostedAuth({env,fetcher:f.fetcher}),{code:'REFRESH_ROTATION_FAILED'});
 assert.equal(f.active,false);assert.equal(f.logouts,1);
 const g=fixture({settingsSafe:false});await assert.rejects(verifyHostedAuth({env,fetcher:g.fetcher}));assert.deepEqual(g.calls,['/auth/v1/settings']);
});
test('acceptance runner is disabled without explicit approval',async()=>{
 const f=fixture();await assert.rejects(verifyHostedAuth({env:{...env,STUDENT_CREATORS_AUTH_ACCEPTANCE_ENABLED:'false'},fetcher:f.fetcher}),{code:'ACCEPTANCE_DISABLED'});
 assert.equal(f.calls.length,0);
});
