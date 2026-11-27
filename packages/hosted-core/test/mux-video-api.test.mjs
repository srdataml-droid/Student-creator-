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

test('live Mux upload never creates test assets and rejects test asset playback',async()=>{
 let body;const liveUpload={...upload,test:false,new_asset_settings:{...upload.new_asset_settings,test:false}};
 const mux=createMuxTestClient({tokenId:'fixture_token',tokenSecret:'fixture_secret',origin,testAsset:false,fetcher:async(url,o)=>{body=JSON.parse(o.body);return Response.json({data:liveUpload});}});
 await mux.create(reservation);assert.equal(body.test,false);assert.equal(body.new_asset_settings.test,false);
 const row={id:reservation,uploadId,state:'processing'},finished={...liveUpload,status:'asset_created',asset_id:assetId};const store={apply:async s=>({id:reservation,state:s.state})};
 assert.equal((await reconcileMuxUpload({mux:{testAsset:false,getAsset:async()=>({...asset,test:false})},store,row,upload:finished})).state,'ready');
 assert.equal((await reconcileMuxUpload({mux:{testAsset:false,getAsset:async()=>asset},store,row,upload:finished})).state,'unsafe');
 await assert.rejects(reconcileMuxUpload({mux:{testAsset:false},store,row,upload}));
});

test('live playback fails closed on missing expiry and caps to fresh entitlement after provider check',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const lesson={id:lessonId,viewerId:creator,status:'published',videoStatus:'ready',playbackPolicy:'signed',assetId,playbackId,reservationId:reservation,uploadId};
 let current=lesson;
 const deps={auth:{getUser:async()=>({id:creator})},store:{authorizedPlayback:async()=>current},mux:{testAsset:false,getAsset:async()=>({...asset,test:false})},signingKeyId:'key_fixture',privateKeyBase64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};
 const handler=createMuxPlaybackHandler(deps);
 assert.equal((await handler(req('GET'),{lessonId})).status,403);
 current={...lesson,entitlementExpiresAt:Math.floor(Date.now()/1000)-1};
 assert.equal((await handler(req('GET'),{lessonId})).status,403);
 const expiry=Math.floor(Date.now()/1000)+30;
 current={...lesson,entitlementExpiresAt:expiry};
 const granted=await handler(req('GET'),{lessonId});assert.equal(granted.status,200);assert.equal((await granted.json()).expiresAt,expiry);
 current={...lesson,entitlementExpiresAt:null};assert.equal((await handler(req('GET'),{lessonId})).status,200);
});

test('live signed grant optionally registers bounded provider duration without making analytics a playback dependency',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const sessionId=reservation;
 const token='e30.'+Buffer.from(JSON.stringify({sub:creator,session_id:sessionId})).toString('base64url')+'.fixture';
 const lesson={id:lessonId,viewerId:creator,status:'published',videoStatus:'ready',playbackPolicy:'signed',assetId,playbackId,reservationId:reservation,uploadId,entitlementExpiresAt:null};let input;
 const deps={auth:{getUser:async()=>({id:creator})},store:{authorizedPlayback:async()=>lesson,registerWatchGrant:async v=>{input=v;return {id:reservation,nextSequence:1,durationMs:12345,resumePositionMs:5000,expiresAt:v.expiresAt};}},mux:{testAsset:false,getAsset:async()=>({...asset,test:false,duration:12.345})},signingKeyId:'key_fixture',privateKeyBase64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};
 let response=await createMuxPlaybackHandler(deps)(req('GET',token),{lessonId});assert.equal(response.status,200);assert.equal((await response.json()).watchSession.resumePositionMs,5000);assert.equal(input.durationMs,12345);assert.equal(input.sessionId,sessionId);
 deps.store.registerWatchGrant=async()=>{throw Error('telemetry offline');};response=await createMuxPlaybackHandler(deps)(req('GET',token),{lessonId});assert.equal(response.status,200);assert.equal(Object.hasOwn(await response.json(),'watchSession'),false);
});

test('thumbnail grant rechecks viewer and provider access and cannot create a watch session',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const expiry=Math.floor(Date.now()/1000)+90;
 const lesson={id:lessonId,viewerId:creator,status:'published',videoStatus:'ready',playbackPolicy:'signed',assetId,playbackId,reservationId:reservation,uploadId,entitlementExpiresAt:expiry};
 let checks=0,watch=0,allowed=true;
 const deps={thumbnail:true,auth:{getUser:async()=>({id:creator})},store:{authorizedPlayback:async()=>{checks++;return allowed?lesson:null;},registerWatchGrant:async()=>{watch++;}},mux:{testAsset:false,getAsset:async()=>({...asset,test:false,duration:30})},signingKeyId:'key_fixture',privateKeyBase64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};
 const handler=createMuxPlaybackHandler(deps);
 const response=await handler(req('GET'),{lessonId});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const grant=await response.json(),u=new URL(grant.url),claims=JSON.parse(Buffer.from(u.searchParams.get('token').split('.')[1],'base64url'));
 assert.equal(u.origin,'https://image.mux.com');assert.equal(u.pathname,'/'+playbackId+'/thumbnail.jpg');assert.equal(claims.aud,'t');assert.equal(claims.width,320);assert.equal(claims.time,0);assert.equal(grant.expiresAt,expiry);assert.equal(checks,2);assert.equal(watch,0);assert.equal('watchSession' in grant,false);
 allowed=false;assert.equal((await handler(req('GET'),{lessonId})).status,403);assert.equal((await handler(req('GET',''),{lessonId})).status,401);
 allowed=true;const changed=createMuxPlaybackHandler({...deps,mux:{testAsset:false,getAsset:async()=>{allowed=false;return {...asset,test:false};}}});assert.equal((await changed(req('GET'),{lessonId})).status,403);
});
