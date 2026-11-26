import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyHostedStorage} from '../../../scripts/verify-hosted-storage.mjs';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_STORAGE_ACCEPTANCE_ENABLED:'true',
 supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server',
 STUDENT_CREATORS_STORAGE_TEST_TOKEN_A:'e30.e30.signatureA',STUDENT_CREATORS_STORAGE_TEST_TOKEN_B:'e30.e30.signatureB'};
function fixture({leak=false,badActor=false,cleanupFailure=false}={}){
 const objects=new Map(),calls=[];const denied=()=>Response.json({statusCode:'403'},{status:400});
 const fetcher=async(url,opts)=>{
  const path=new URL(url).pathname,server=opts.headers.apikey===env.supabase_secret_key;
  calls.push({path,method:opts.method,server});
  if(path==='/auth/v1/user'){
   const a=opts.headers.authorization.endsWith('A');
   return Response.json({id:a?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',
    email:badActor?'real@example.com':'wk-storage-test-'+(a?'a':'b')+'@example.invalid',email_confirmed_at:'2026-01-01'});
  }
  const parts=path.split('/'),operation=parts[4],data=typeof opts.body==='string'?JSON.parse(opts.body):null;
  if(operation==='list')return Response.json(server?[...objects.keys()].filter(k=>k.startsWith(parts[5]+'/'+data.prefix)).map(k=>({name:k})):[]);
  if(opts.method==='DELETE'){
   if(cleanupFailure)return Response.json({}, {status:500});
   for(const key of data.prefixes)objects.delete(parts[4]+'/'+key);
   return Response.json([]);
  }
  if(opts.method==='POST'&&operation!=='sign'){
   if(!server&&!leak)return denied();
   objects.set(parts.slice(4).join('/'),Buffer.from(opts.body));return Response.json({Key:'fixture'});
  }
  if(opts.method==='GET'&&server){
   const key=parts.slice(operation==='authenticated'?5:4).join('/');
   return new Response(objects.get(key),{status:200});
  }
  return denied();
 };
 return {fetcher,objects,calls};
}
test('acceptance runner checks both buckets and all three actors and cleans only fixture keys',async()=>{
 const f=fixture();const result=await verifyHostedStorage({env,fetcher:f.fetcher});
 assert.deepEqual(result,{status:'passed',buckets:2,actors:3,checks:10,cleanupVerified:true});assert.equal(f.objects.size,0);
 assert.equal(f.calls.filter(x=>x.method==='DELETE').length,2);
});
test('unexpected unauthorized writes fail, even after cleanup',async()=>{
 const f=fixture({leak:true});await assert.rejects(verifyHostedStorage({env,fetcher:f.fetcher}),{code:'UNAUTHORIZED_UPLOAD_SUCCEEDED'});
 assert.equal(f.objects.size,0);
});
test('wrong or real identities, missing approval and unverified cleanup fail closed',async()=>{
 const f=fixture({badActor:true});await assert.rejects(verifyHostedStorage({env,fetcher:f.fetcher}),{code:'SYNTHETIC_ACCOUNT_REQUIRED'});
 assert.equal(f.calls.some(x=>x.method==='POST'),false);
 const g=fixture();await assert.rejects(verifyHostedStorage({env:{...env,STUDENT_CREATORS_STORAGE_ACCEPTANCE_ENABLED:'false'},fetcher:g.fetcher}),{code:'ACCEPTANCE_DISABLED'});
 assert.equal(g.calls.length,0);
 const h=fixture({cleanupFailure:true});await assert.rejects(verifyHostedStorage({env,fetcher:h.fetcher}),{code:'FIXTURE_CLEANUP_UNVERIFIED'});
});
