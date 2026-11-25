// Real self-hosted LiveKit server and Chromium peers, no cloud credentials.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import {createClassTokenIssuer} from '../../../packages/local-core/src/livekit-class-tokens.mjs';
import {createLiveKitRoomService} from '../../../packages/local-core/src/livekit-room-service.mjs';
const require=createRequire(import.meta.url);
const sdkPath=require.resolve('livekit-client');
const key=process.env.WK_LIVEKIT_FIXTURE_KEY,secret=process.env.WK_LIVEKIT_FIXTURE_SECRET;
assert.equal(key,'wk_fixture_key');assert.match(secret??'',/^[a-f0-9]{64}$/);
const room='wk-class-'+randomUUID(),host='student-'+randomUUID(),viewer='student-'+randomUUID();
const remote='wss://fixture.example.invalid',local='ws://127.0.0.1:7880';
const issuer=createClassTokenIssuer({url:remote,apiKey:key,apiSecret:secret,ttlSeconds:120});
// Explicit test-only transport maps the fixed pretend HTTPS endpoint to the
// isolated server. Production TLS/SSRF validation remains unchanged.
const rooms=createLiveKitRoomService({url:remote,apiKey:key,apiSecret:secret,fetchImpl:(url,opts)=>{
 const u=new URL(url);assert.equal(u.origin,'https://fixture.example.invalid');assert.match(u.pathname,/^\/twirp\/livekit\.RoomService\//);
 return fetch('http://127.0.0.1:7880'+u.pathname,opts);
}});
const grant=(identity,role,clock)=> (clock?createClassTokenIssuer({url:remote,apiKey:key,apiSecret:secret,ttlSeconds:60,clock}):issuer).issue({room,identity,role}).token;
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
let browser;
try{
 const created=await rooms.createRoom(room,{capacity:4});assert.equal(created.name,room);
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 async function peer(){
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.addScriptTag({path:sdkPath});
  await page.evaluate(()=>{
   const sdk=globalThis.LivekitClient; if(!sdk?.Room)throw Error('LiveKit SDK missing');
   globalThis.r=new sdk.Room({adaptiveStream:false,dynacast:false});
   globalThis.received=0;
   r.on(sdk.RoomEvent.TrackSubscribed,track=>{
    if(track.kind==='video'){
     const video=track.attach();video.muted=true;video.autoplay=true;document.body.appendChild(video);
     video.play().catch(()=>{});
     const count=()=>{received++;video.requestVideoFrameCallback(count);};
     if(typeof video.requestVideoFrameCallback==='function')video.requestVideoFrameCallback(count);
    }
   });
   globalThis.publish=async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;document.body.appendChild(canvas);
    const ctx=canvas.getContext('2d');let n=0;
    const draw=()=>{ctx.fillStyle=n++%2?'#205090':'#903020';ctx.fillRect(0,0,320,240);};draw();
    setInterval(draw,100);
    const track=canvas.captureStream(10).getVideoTracks()[0];
    try{return await r.localParticipant.publishTrack(track,{source:sdk.Track.Source.Camera});}catch(e){track.stop();throw e;}
   };
  });
  return {page,context};
 }
 async function connect(p,token){
  await p.page.evaluate(async({local,token})=>{
   await Promise.race([r.connect(local,token,{autoSubscribe:true}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Connect timeout')),15000))]);
  },{local,token});
 }
 const h=await peer(),v=await peer(),bad=await peer();
 const expired=grant('student-'+randomUUID(),'participant',()=>Date.now()-300000);
 await assert.rejects(connect(bad,expired));await bad.context.close();
 const invalid=await peer();const good=grant('student-'+randomUUID(),'participant');
 const parts=good.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
 await assert.rejects(connect(invalid,parts.join('.')));await invalid.context.close();
 await connect(h,grant(host,'host'));await connect(v,grant(viewer,'participant'));
 await h.page.evaluate(async()=>{await publish();});
 await v.page.waitForFunction(()=>received>=3&&[...document.querySelectorAll('video')].some(x=>x.videoWidth>0),{},{timeout:30000});
 // A participant's grant cannot publish. Check both SDK denial and absence
 // of remote participant publications on the receiving host.
 await assert.rejects(v.page.evaluate(async()=>{await Promise.race([publish(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Publish denied or timed out')),10000))]);}));
 const publications=await h.page.evaluate(identity=>r.remoteParticipants.get(identity)?.trackPublications.size??0,viewer);
 assert.equal(publications,0);
 await v.page.evaluate(async()=>{await r.disconnect();received=0;});
 await connect(v,grant(viewer,'participant'));
 await v.page.waitForFunction(()=>received>=3,{},{timeout:30000});
 await rooms.deleteRoom(room);
 await Promise.all([h,v].map(p=>p.page.waitForFunction(()=>r.state==='disconnected',{},{timeout:15000})));
 console.log('PASS: real LiveKit server and two Chromium peers, decoded video frames, invalid/expired token denial, participant publish denial, reconnect and room deletion.');
}finally{
 if(browser)await browser.close();
 try{await rooms.deleteRoom(room);}catch{}
 await new Promise(resolve=>server.close(resolve));
}
