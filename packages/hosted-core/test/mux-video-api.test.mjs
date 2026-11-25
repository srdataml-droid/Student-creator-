import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createMuxTestClient,createMuxUploadHandler,createMuxPlaybackHandler,buildMuxVideoRoute,reconcileMuxUpload} from '../src/mux-video-api.mjs';
const creator='11111111-1111-4111-8111-111111111111',lessonId='22222222-2222-4222-8222-222222222222',reservation='33333333-3333-4333-8333-333333333333';
const origin='https://preview.example.invalid',uploadId='upload_123',assetId='asset_123',playbackId='playback_123';
const upload={id:uploadId,test:true,status:'waiting',url:'https://storage.googleapis.com/private/upload?sig=synthetic',new_asset_settings:{passthrough:reservation,playback_policies:['signed'],test:true}};
const asset={id:assetId,upload_id:uploadId,passthrough:reservation,test:true,status:'ready',playback_ids:[{id:playbackId,policy:'signed'}]};
const req=(method='POST',token='fixture',o=origin)=>new Request(origin+'/api/lesson',{method,headers:{origin:o,...(token?{authorization:'Bearer '+token}:{})}});
test('test-mode Mux creation sends only signed policy, bounded origin/expiry and no user metadata',async()=>{
 let seen;
 const mux=createMuxTestClient({tokenId:'fixture_token',tokenSecret:'fixture_secret',origin,fetcher:async(url,opts)=>{seen={url:String(url),opts};return Response.json({data:upload});}});
 await mux.create(reservation);
 assert.equal(seen.url,'https://api.mux.com/video/v1/uploads');assert.equal(seen.opts.redirect,'error');
 const body=JSON.parse(seen.opts.body);assert.equal(body.test,true);assert.equal(body.new_asset_settings.test,true);assert.deepEqual(body.new_asset_settings.playback_policies,['signed']);assert.equal(body.new_asset_settings.passthrough,reservation);assert.equal(body.cors_origin,origin);assert.equal(body.timeout,900);
});
test('owned reservation creates once; uncertain repeat never creates again',async()=>{
 let creates=0;let row={id:reservation,state:'initializing',uploadId:null,create:true};
 const store={reserve:async()=>row,get:async()=>row,apply:async s=>({id:reservation,state:s.state})};
 const mux={create:async()=>{creates++;return upload;},getUpload:async()=>upload};
 const h=createMuxUploadHandler({auth:{getUser:async()=>({id:creator})},store,mux,origin});
 const first=await h(req(),{lessonId});assert.equal(first.status,201);assert.equal((await first.json()).upload.uploadUrl,upload.url);
 row={id:reservation,state:'initializing',uploadId:null,create:false};
 assert.equal((await h(req(),{lessonId})).status,202);assert.equal(creates,1);
 row=null;assert.equal((await h(req(),{lessonId})).status,404);assert.equal(creates,1);
 assert.equal((await h(req('POST','fixture','https://evil.example'),{lessonId})).status,403);
});
test('provider ready state checks passthrough, test asset, signed-only policy and exact upload id',async()=>{
 const row={id:reservation,uploadId,state:'processing'};const finished={...upload,status:'asset_created',asset_id:assetId};let observed;
 const store={apply:async s=>{observed=s;return {id:reservation,state:s.state};}};
 assert.equal((await reconcileMuxUpload({mux:{getAsset:async()=>asset},store,row,upload:finished})).state,'ready');
 assert.equal(observed.playbackId,playbackId);
 for(const wrong of [{...asset,test:false},{...asset,upload_id:'wrong_upload'},{...asset,passthrough:creator},{...asset,playback_ids:[{id:playbackId,policy:'public'}]}]){
  assert.equal((await reconcileMuxUpload({mux:{getAsset:async()=>wrong},store,row,upload:finished})).state,'unsafe');assert.equal(observed.playbackId,null);
 }
 await assert.rejects(reconcileMuxUpload({mux:{},store,row,upload:{...upload,url:'https://evil.example/upload?sig=x'}}));
});
test('signed playback requires DB authorization plus current provider asset; expiry is short',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const lesson={id:lessonId,viewerId:creator,status:'published',videoStatus:'ready',playbackPolicy:'signed',assetId,playbackId,reservationId:reservation,uploadId};
 const deps={auth:{getUser:async()=>({id:creator})},store:{authorizedPlayback:async()=>lesson},mux:{getAsset:async()=>asset},signingKeyId:'key_fixture',privateKeyBase64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};
 const r=await createMuxPlaybackHandler(deps)(req('GET'),{lessonId});assert.equal(r.status,200);
 const grant=await r.json();assert.equal(new URL(grant.url).hostname,'stream.mux.com');assert.ok(grant.expiresAt<=Math.floor(Date.now()/1000)+120);
 const denied=await createMuxPlaybackHandler({...deps,store:{authorizedPlayback:async()=>null}})(req('GET'),{lessonId});assert.equal(denied.status,403);
 const changed=await createMuxPlaybackHandler({...deps,mux:{getAsset:async()=>({...asset,playback_ids:[{id:playbackId,policy:'public'}]})}})(req('GET'),{lessonId});assert.equal(changed.status,403);
});
test('disabled staging configuration contacts no provider',async()=>{
 let n=0;const h=buildMuxVideoRoute({getEnv:()=>({}),fetcher:async()=>{n++;}});
 assert.equal((await h(req(),{lessonId})).status,503);assert.equal(n,0);
});

test('missing or false provider test flag never releases direct upload URL or reconciles asset',async()=>{
 const row={id:reservation,uploadId,state:'waiting'};let applied=0;
 const store={apply:async()=>{applied++;}};
 for(const testFlag of [undefined,false,null])await assert.rejects(reconcileMuxUpload({mux:{},store,row,upload:{...upload,test:testFlag}}));
 assert.equal(applied,0);
});
