import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {verifyMuxTestVideo} from '../../../scripts/verify-mux-test-video.mjs';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_MUX_ACCEPTANCE_ENABLED:'true',STUDENT_CREATORS_MUX_TEST_VIDEO_ENABLED:'true',
 supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server',
 MUX_TOKEN_ID:'fixture_token',MUX_TOKEN_SECRET:'fixture_secret',STUDENT_CREATORS_MUX_UPLOAD_ORIGIN:'https://preview.example.invalid',
 MUX_PLAYBACK_SIGNING_KEY_ID:'fixture_signing_key',MUX_PLAYBACK_PRIVATE_KEY_BASE64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};
function fixture({unsignedAllowed=false,foreign=false,cleanupFailure=false}={}){
 let reservation,uploaded=false,deleted=false;const calls=[];
 const fetcher=async(url,opts)=>{
  const u=new URL(url);calls.push({host:u.hostname,path:u.pathname,method:opts.method,auth:!!opts.headers?.authorization});
  if(u.hostname==='storage.googleapis.com'){uploaded=true;return new Response(null,{status:200});}
  if(u.hostname==='stream.mux.com')return u.searchParams.has('token')||unsignedAllowed?new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10000\nstream.m3u8'):new Response(null,{status:403});
  if(u.pathname==='/video/v1/uploads'){const body=JSON.parse(opts.body);assert.equal(body.test,true);reservation=body.new_asset_settings.passthrough;}
  const upload={id:'fixture_upload',test:true,status:uploaded?'asset_created':'waiting',...(uploaded?{asset_id:'fixture_asset'}:{url:'https://storage.googleapis.com/test?sig=synthetic'}),new_asset_settings:{passthrough:reservation,playback_policies:['signed'],test:true}};
  if(u.pathname.startsWith('/video/v1/uploads'))return Response.json({data:upload});
  if(u.pathname==='/video/v1/assets/fixture_asset'){
   if(opts.method==='DELETE'){if(cleanupFailure)return new Response(null,{status:500});deleted=true;return new Response(null,{status:204});}
   if(deleted)return new Response(null,{status:404});
   return Response.json({data:{id:'fixture_asset',upload_id:'fixture_upload',passthrough:foreign?'foreign':reservation,test:true,status:'ready',playback_ids:[{id:'fixture_playback',policy:'signed'}]}});
  }
  throw Error('unexpected');
 };
 const run=(e=env)=>verifyMuxTestVideo({env:e,fetcher,makeClip:()=>Buffer.from('0000ftyp00000000'),pause:async()=>{},maxPolls:2});
 return {run,calls,get deleted(){return deleted;}};
}
test('provider acceptance verifies test upload, signed manifest, unsigned rejection and exact cleanup',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{status:'passed',testUpload:true,signedManifest:true,unsignedDenied:true,cleanupVerified:true,applicationEntitlementVerified:false,browserPlaybackVerified:false});
 assert.equal(f.deleted,true);assert.equal(f.calls.find(c=>c.host==='storage.googleapis.com').auth,false);assert.equal(f.calls.filter(c=>c.host==='stream.mux.com').every(c=>!c.auth),true);
});
test('unsigned access failure still deletes only verified test asset; foreign binding never deletes',async()=>{
 const f=fixture({unsignedAllowed:true});await assert.rejects(f.run(),{code:'UNSIGNED_MANIFEST_NOT_DENIED'});assert.equal(f.deleted,true);
 const g=fixture({foreign:true});await assert.rejects(g.run(),{code:'TEST_RESOURCE_CLEANUP_UNVERIFIED'});assert.equal(g.deleted,false);
});
test('cleanup failure and disabled acceptance never report success',async()=>{
 const f=fixture({cleanupFailure:true});await assert.rejects(f.run(),{code:'TEST_RESOURCE_CLEANUP_UNVERIFIED'});
 const g=fixture();await assert.rejects(g.run({...env,STUDENT_CREATORS_MUX_ACCEPTANCE_ENABLED:'false'}),{code:'ACCEPTANCE_DISABLED'});assert.equal(g.calls.length,0);
});
