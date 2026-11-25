import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityEvidenceHandler,createPrivateIdentityProvider,buildIdentityEvidenceRoute,sha256,IDENTITY_MAX_BYTES} from '../src/private-identity-api.mjs';
const owner='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',upload='33333333-3333-4333-8333-333333333333';
const key='private/'+owner+'/'+requestId+'/'+upload+'.pdf';
const file=Buffer.from('%PDF-synthetic-test');
function req({body=file,method='POST',mime='application/pdf',token='synthetic',headers={}}={}){
 return new Request('https://example.invalid/api/identity/evidence/'+requestId,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':mime,...headers},...(method==='POST'?{body}:{})});
}
function fixture({user=owner,reservation={id:upload,objectKey:key,state:'reserved'},review=null,stored=file}={}){
 const calls=[];
 const auth={getUser:async()=>user?{id:user}:null};
 const store={reserve:async x=>{calls.push(['reserve',x]);return reservation;},markUploaded:async x=>{calls.push(['mark',x]);return true;},review:async x=>{calls.push(['review',x]);return review;}};
 const storage={writeImmutable:async(...x)=>{calls.push(['write',...x]);},read:async x=>{calls.push(['read',x]);return stored;}};
 return {handler:createIdentityEvidenceHandler({auth,store,storage}),calls};
}
test('owner upload is reserved, immutable and quarantined; path not returned',async()=>{
 const {handler,calls}=fixture();const r=await handler(req(),{requestId});
 assert.equal(r.status,202);assert.deepEqual(await r.json(),{received:true,uploadId:upload});
 assert.equal(calls[0][1].owner,owner);assert.equal(calls[0][1].digest,sha256(file));
 assert.equal(calls[1][1],key);assert.equal(calls[2][1].uploadId,upload);
});
test('auth, ownership, invalid bytes, invalid type, oversized body and injected key fail closed',async()=>{
 for(const [opts,request,status] of [[{user:null},req(),401],[{reservation:null},req(),404],
 [{},req({body:Buffer.from('not a pdf')}),422],[{},req({mime:'text/html'}),415],
 [{},req({body:Buffer.alloc(IDENTITY_MAX_BYTES+1)}),413],
 [{reservation:{id:upload,objectKey:'private/another.pdf',state:'reserved'}},req(),503]]){
  const {handler,calls}=fixture(opts);assert.equal((await handler(request,{requestId})).status,status);
  assert.equal(calls.some(x=>x[0]==='write'),false);
 }
});
test('same reserved upload retries safely; different file cannot overwrite',async()=>{
 const same=fixture({reservation:{id:upload,objectKey:key,state:'quarantined'}});
 assert.equal((await same.handler(req(),{requestId})).status,202);assert.equal(same.calls.length,1);
 const conflict=fixture({reservation:{conflict:true}});assert.equal((await conflict.handler(req(),{requestId})).status,409);
 assert.equal(conflict.calls.length,1);
});
test('review object must be explicitly authorized and match immutable digest, never inline',async()=>{
 const denied=fixture();assert.equal((await denied.handler(req({method:'GET'}),{requestId})).status,404);assert.equal(denied.calls.length,1);
 const metadata={id:upload,ownerId:owner,objectKey:key,mime:'application/pdf',bytes:file.length,digest:sha256(file)};
 const allowed=fixture({review:metadata});const r=await allowed.handler(req({method:'GET'}),{requestId});
 assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/^attachment/);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.deepEqual(Buffer.from(await r.arrayBuffer()),file);
 const mismatch=fixture({review:metadata,stored:Buffer.from('corrupt')});assert.equal((await mismatch.handler(req({method:'GET'}),{requestId})).status,503);
});
test('provider uses server-only immutable Storage API; conflict verified by full digest',async()=>{
 const seen=[];const p=createPrivateIdentityProvider({url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',serverKey:'sb_secret_fixture',
 fetcher:async(url,opts)=>{seen.push([String(url),opts]);return opts.method==='POST'?new Response(null,{status:409}):new Response(file);}});
 await p.storage.writeImmutable(key,'application/pdf',file,sha256(file));
 assert.match(seen[0][0],/storage\/v1\/object\/student-creators-private-identity\/private\//);
 assert.equal(seen[0][1].headers['x-upsert'],'false');assert.equal(seen[0][1].headers.apikey,'sb_secret_fixture');
 assert.match(seen[1][0],/object\/authenticated\/student-creators-private-identity/);assert.equal(seen[0][1].redirect,'error');
 await assert.rejects(p.storage.writeImmutable(key,'application/pdf',file,'0'.repeat(64)));
 await assert.rejects(p.storage.read('../other'));
});
test('staging/identity privacy gate prevents accidental upload activation',async()=>{
 let calls=0;const route=buildIdentityEvidenceRoute({getEnv:()=>({}),fetcher:async()=>{calls++;}});
 assert.equal((await route(req(),{requestId})).status,503);assert.equal(calls,0);
});

test('evidence is withheld if reviewer scope or current session is revoked during storage read',async()=>{const metadata={id:upload,ownerId:owner,objectKey:key,mime:'application/pdf',bytes:file.length,digest:sha256(file)};for(const revoked of ['session','grant']){let authChecks=0,grantChecks=0;const h=createIdentityEvidenceHandler({auth:{getUser:async()=>++authChecks===2&&revoked==='session'?null:{id:owner}},store:{review:async()=>++grantChecks===2&&revoked==='grant'?null:metadata},storage:{read:async()=>file}});const r=await h(req({method:'GET'}),{requestId});assert.equal(r.status,revoked==='session'?401:404);assert.equal((await r.text()).includes(file.toString()),false);}});
