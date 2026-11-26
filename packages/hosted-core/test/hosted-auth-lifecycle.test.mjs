import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedAuthHandler,createHostedAuthProvider,processHostedRecovery,buildHostedAuthRoute} from '../src/hosted-auth-lifecycle.mjs';
const origin='https://preview.example.invalid',pilotEmail='pilot@example.invalid',id='11111111-1111-4111-8111-111111111111',leaseId='22222222-2222-4222-8222-222222222222';
const inviteSecret='synthetic_invitation_secret_123456789',pepper='synthetic_private_pepper_123456789';
const token='e30.e30.signature',refreshToken='synthetic_refresh_123456',password='synthetic-password-123';
const session={accessToken:token,refreshToken,expiresIn:300,user:{id,email:pilotEmail}};
function req(action,data,headers={}){
 return new Request(origin+'/api/hosted-auth/'+action,{method:'POST',headers:{origin,'content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
}
function fixture({providerOverrides={},storeOverrides={}}={}){
 const calls=[];
 const provider={assertSafeSettings:async()=>true,invite:async e=>{calls.push(['invite',e]);return true;},signIn:async()=>session,refresh:async()=>session,
  verify:async()=>session,updatePassword:async()=>{calls.push(['password']);return true;},logout:async(t,g)=>{calls.push(['logout',g]);return true;},
  recover:async e=>{calls.push(['recover',e]);return true;},...providerOverrides};
 const store={admit:async x=>{calls.push(['admit',x]);return true;},claimInvite:async()=>true,finishInvite:async()=>true,
  enqueueRecovery:async x=>{calls.push(['queue',x]);return true;},claimRecovery:async()=>({id,leaseId}),
  finishRecovery:async x=>{calls.push(['finish',x]);return true;},...storeOverrides};
 const deps={provider,store,currentAuth:{getUser:async()=>({id})},origin,pilotEmail,inviteSecret,pepper};
 return {handler:createHostedAuthHandler(deps),deps,calls};
}
test('one approved invitation and exact secret; repeated reservation never resends',async()=>{
 let claimed=false;const d=fixture({storeOverrides:{claimInvite:async()=>{if(claimed)return false;claimed=true;return true;}}});
 assert.equal((await d.handler(req('invite',{inviteCode:'bad'}),{action:'invite'})).status,403);
 assert.equal((await d.handler(req('invite',{inviteCode:inviteSecret}),{action:'invite'})).status,202);
 assert.equal((await d.handler(req('invite',{inviteCode:inviteSecret}),{action:'invite'})).status,202);
 assert.equal(d.calls.filter(x=>x[0]==='invite').length,1);assert.equal(d.calls.find(x=>x[0]==='invite')[1],pilotEmail);
});
test('sign in and refresh issue access token only, refresh token stays Secure HttpOnly',async()=>{
 const {handler}=fixture();const r=await handler(req('sign-in',{email:pilotEmail,password}),{action:'sign-in'});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{accessToken:token,expiresIn:300,userId:id});
 const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.match(cookie,/Path=\/api\/hosted-auth/);
 const fresh=await handler(req('refresh',null,{cookie:'__Secure-wk_refresh='+refreshToken}),{action:'refresh'});
 assert.equal(fresh.status,200);assert.equal((await fresh.json()).accessToken,token);
 assert.equal((await handler(req('refresh',null,{cookie:'__Secure-wk_refresh='+refreshToken+'; __Secure-wk_refresh='+refreshToken}),{action:'refresh'})).status,401);
 const out=await handler(req('logout',null,{authorization:'Bearer '+token}),{action:'logout'});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
});
test('OTP completion never exposes session, updates password then globally revokes',async()=>{
 const {handler,calls}=fixture();
 const r=await handler(req('complete',{email:pilotEmail,code:'123456',purpose:'recovery',password}),{action:'complete'});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{completed:true,signInRequired:true});assert.deepEqual(calls.slice(-2),[['password'],['logout',true]]);
 assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
});
test('recovery responses are generic; only approved email job eligible and no provider call',async()=>{
 const {handler,calls}=fixture();
 const a=await handler(req('recover',{email:pilotEmail}),{action:'recover'}),b=await handler(req('recover',{email:'unknown@example.invalid'}),{action:'recover'});
 assert.equal(a.status,202);assert.equal(b.status,202);assert.deepEqual(await a.json(),await b.json());
 const queue=calls.filter(x=>x[0]==='queue');assert.equal(queue[0][1].eligible,true);assert.equal(queue[1][1].eligible,false);
 assert.equal(queue[0][1].recipient,queue[1][1].recipient);assert.equal(calls.some(x=>x[0]==='recover'),false);
});
test('recovery worker uses lease, fixed recipient and never retries uncertain request automatically',async()=>{
 const d=fixture({providerOverrides:{recover:async()=>{throw Error('provider unavailable');}}});
 assert.deepEqual(await processHostedRecovery(d.deps),{status:'uncertain'});assert.equal(d.calls.at(-1)[1].leaseId,leaseId);
 const ok=fixture();assert.deepEqual(await processHostedRecovery(ok.deps),{status:'requested'});assert.equal(ok.calls.find(x=>x[0]==='recover')[1],pilotEmail);
});
test('provider API uses exact project and separates server invite credentials from user sessions',async()=>{
 const seen=[];const p=createHostedAuthProvider({url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',publicKey:'public',serverKey:'sb_secret_fixture',origin,
 fetcher:async(url,opts)=>{seen.push({url:String(url),opts});return Response.json({access_token:token,refresh_token:refreshToken,expires_in:300,user:{id,email:pilotEmail}});}});
 await p.invite(pilotEmail);await p.signIn(pilotEmail,password);await p.verify(pilotEmail,'123456','signup');await p.logout(token,true);
 assert.match(seen[0].url,/auth\/v1\/invite\?redirect_to=/);assert.equal(seen[0].opts.headers.apikey,'sb_secret_fixture');
 assert.equal(seen[1].opts.headers.apikey,'public');assert.match(seen[1].url,/grant_type=password/);
 assert.equal(JSON.parse(seen[2].opts.body).type,'email');assert.equal(seen[3].opts.headers.authorization,'Bearer '+token);assert.match(seen[3].url,/scope=global/);
});
test('staging disabled or wrong origin fails without provider request',async()=>{
 let n=0;const h=buildHostedAuthRoute({getEnv:()=>({}),fetcher:async()=>{n++;}});
 assert.equal((await h(req('sign-in',{email:pilotEmail,password}),{action:'sign-in'})).status,503);assert.equal(n,0);
 const d=fixture();assert.equal((await d.handler(req('invite',{inviteCode:inviteSecret},{origin:'https://evil.example'}),{action:'invite'})).status,403);assert.equal(d.calls.length,0);
});

test('unsafe Auth settings deny invite before reservation, sign-in, OTP completion, refresh and recovery worker',async()=>{
 let claimed=0,providerCalls=0;
 const d=fixture({providerOverrides:{assertSafeSettings:async()=>false,invite:async()=>{providerCalls++;},signIn:async()=>{providerCalls++;},
 refresh:async()=>{providerCalls++;},verify:async()=>{providerCalls++;}},
 storeOverrides:{claimInvite:async()=>{claimed++;return true;},claimRecovery:async()=>{claimed++;return null;}}});
 for(const [action,body,headers] of [['invite',{inviteCode:inviteSecret},{}],['sign-in',{email:pilotEmail,password},{}],
 ['complete',{email:pilotEmail,code:'123456',purpose:'recovery',password},{}],['refresh',null,{cookie:'__Secure-wk_refresh='+refreshToken}]]){
  assert.equal((await d.handler(req(action,body,headers),{action})).status,503);
 }
 await assert.rejects(processHostedRecovery(d.deps));assert.equal(claimed,0);assert.equal(providerCalls,0);
 // Logout remains available for containment even if the provider settings drift.
 assert.equal((await d.handler(req('logout',null,{authorization:'Bearer '+token}),{action:'logout'})).status,200);
});
