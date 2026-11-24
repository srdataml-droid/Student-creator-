import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveKitRoomService} from '../src/livekit-room-service.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {createClassTokenIssuer} from '../src/livekit-class-tokens.mjs';

const API_KEY='server-key-week-six-2026';
const SECRET='a-private-very-long-synthetic-signing-secret-for-tests';
const API_URL='https://student-live.example.invalid';
const clock={value:Date.now()};
const enc=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
function signEvent(body,overrides={}){
 const n=Math.floor(clock.value/1000);
 const payload={iss:API_KEY,iat:n,nbf:n-2,exp:n+100,sha256:createHash('sha256').update(body).digest('base64'),...overrides};
 const input=enc({alg:'HS256',typ:'JWT'})+'.'+enc(payload);
 return input+'.'+createHmac('sha256',SECRET).update(input).digest('base64url');
}
function withGateway(fetchImpl=async()=>Response.json({name:'ok'})){
 return createLiveKitRoomService({url:API_URL,apiKey:API_KEY,apiSecret:SECRET,clock:()=>clock.value,fetchImpl});
}

test('LiveKit Twirp grants create, delete and remove participant with server-only signing',async()=>{
 const seen=[];
 const gateway=withGateway(async(url,opts)=>{
   assert.match(url,/^https:\/\/student-live\.example\.invalid\/twirp\/livekit\.RoomService\//);
   assert.equal(opts.method,'POST');
   const bearer=opts.headers.authorization;
   assert.ok(bearer.startsWith('Bearer '));
   const [header,claims,signature]=bearer.slice(7).split('.');
   assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'HS256');
   const payload=JSON.parse(Buffer.from(claims,'base64url'));
   assert.equal(payload.iss,API_KEY);
   const expected=createHmac('sha256',SECRET).update(header+'.'+claims).digest('base64url');
   assert.equal(signature,expected);
   assert.ok(payload.exp-payload.iat<=90);
   seen.push({action:url.split('/').at(-1),body:JSON.parse(opts.body),video:payload.video});
   return Response.json({name:'ok'});
 });
 const room='wk-class-'+randomUUID(),identity='student-'+randomUUID();
 await gateway.createRoom(room,{capacity:4});
 await gateway.removeParticipant(room,identity);
 await gateway.deleteRoom(room);
 assert.deepEqual(seen.map(x=>x.action),['CreateRoom','RemoveParticipant','DeleteRoom']);
 assert.deepEqual(seen[0].body,{name:room,maxParticipants:4,emptyTimeout:900,departureTimeout:90});
 assert.equal(seen[0].video.roomCreate,true);
 assert.equal(seen[1].video.roomAdmin,true);
 assert.equal(seen[1].video.room,room);
 assert.equal(seen[2].video.roomCreate,true);
 await assert.rejects(()=>gateway.createRoom('https://attacker.example'),{code:'INVALID_ROOM_GRANT'});
 assert.throws(()=>createLiveKitRoomService({url:'http://127.0.0.1/admin',apiKey:API_KEY,apiSecret:SECRET}),{code:'LIVEKIT_NOT_CONFIGURED'});
});

test('raw webhook verification requires exact signed body, correct issuer, expiry and signature',()=>{
 const service=withGateway();
 const data=JSON.stringify({id:randomUUID(),event:'participant_joined',
   room:{name:'wk-class-'+randomUUID()},participant:{identity:'student-'+randomUUID()}});
 const token=signEvent(data);
 assert.equal(service.verifyWebhook(data,token).event,'participant_joined');
 assert.equal(service.verifyWebhook(Buffer.from(data),'Bearer '+token).event,'participant_joined');
 for(const invalid of [
   signEvent(data,{iss:'bad-issuer'}),signEvent(data,{sha256:'incorrect-body-hash'}),
   signEvent(data,{exp:Math.floor(clock.value/1000)-3600}),
   token.slice(0,-5)+'12345','untrusted',''
 ])assert.throws(()=>service.verifyWebhook(data,invalid),{code:'LIVEKIT_WEBHOOK_UNVERIFIED'});
 assert.throws(()=>service.verifyWebhook(data+' ',token),{code:'LIVEKIT_WEBHOOK_UNVERIFIED'});
 assert.throws(()=>service.verifyWebhook(data,'Bearer '+token.slice(0,10)),{code:'LIVEKIT_WEBHOOK_UNVERIFIED'});
});

test('signed LiveKit webhook alone can record verified attendance; paid and unverified participants denied',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wk06-livekit-webhook-'));
 const entitled=new Set(),events=[];
 const store=openLocalStore(join(dir,'app.sqlite'),{
   paymentEntitlements:{hasActiveEntitlement:({buyerId,resourceKind,resourceId})=>entitled.has(buyerId+':'+resourceKind+':'+resourceId)}
 });
 const roomSvc=withGateway(async (url,opts)=>{events.push(url.split('/').at(-1));return Response.json({name:'ok'});});
 const handle=createLocalHandler(store,{liveKitRoomService:roomSvc,
   classTokenIssuer:createClassTokenIssuer({url:'wss://student-live.example.invalid',apiKey:API_KEY,apiSecret:SECRET})});
 async function request(path,method='GET',body,token,headers={}){
   const res=await handle(new Request('http://localhost:3000/api/local/'+path,{
      method,
      headers:{...(method==='POST'?{origin:'http://localhost:3000'}:{}),
        ...(token?{cookie:'campus_local_session='+token}:{}),
        ...(body!==undefined?{'content-type':'application/json'}:{}),...headers},
      ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),path.split('/'));
   return {status:res.status,data:await res.json()};
 }
 try{
   store.bootstrapAdmin('admin@livekit.invalid','Admin Synthetic Password 2026');
   const admin=store.login('admin@livekit.invalid','Admin Synthetic Password 2026');
   const school=store.createInstitution(admin.user,'Streaming Test Campus');
   const course=store.createCourse(admin.user,{institutionId:school.id,code:'W6123',title:'Night Streaming'});
   const users=[];
   for(let i=0;i<3;i++){
     const name='student'+i+'@livekit.invalid',pw='Student Synthetic Password 2026';
     const u=store.register({email:name,password:pw,institutionId:school.id});
     store.verifyStudent(admin.user,u.id);
     users.push(store.login(name,pw));
   }
   const [host,viewer,outsider]=users,starts=new Date(Date.now()+6*60000).toISOString(),ends=new Date(Date.now()+66*60000).toISOString();
   const cls=await request('courses/'+course.id+'/classes','POST',{
      title:'Validated LiveKit night session',description:'Synthetic two-person session',
      startsAt:starts,endsAt:ends,capacity:3,priceKobo:20000,creationKey:'wk06-signed-provider-key-2026'
   },host.token);
   assert.equal(cls.status,201);
   const id=cls.data.class.id;
   assert.equal((await request('classes/'+id+'/enroll','POST',{},viewer.token)).status,200);
   assert.equal((await request('classes/'+id+'/open','POST',{},outsider.token)).status,403);
   // Provider cannot be created for an unauthorized host: only approved creator can open.
   const opened=await request('classes/'+id+'/open','POST',{},host.token);
   assert.equal(opened.status,200);
   assert.deepEqual(events,['CreateRoom']);
   assert.equal((await request('classes/'+id+'/room-token','POST',{},viewer.token)).status,402);
   entitled.add(viewer.user.id+':class:'+id);
   assert.equal((await request('classes/'+id+'/room-token','POST',{},viewer.token)).status,200);
   const event={id:randomUUID(),event:'participant_joined',room:{name:'wk-class-'+id},
     participant:{identity:'student-'+viewer.user.id}};
   const raw=JSON.stringify(event),sig=signEvent(raw);
   async function webhook(body,auth,mime='application/webhook+json'){
     return request('livekit/webhook','POST',body,null,{'content-type':mime,'authorization':auth});
   }
   assert.equal((await webhook(raw,'invalid')).status,401);
   assert.equal((await webhook(raw+' ',sig)).status,401);
   assert.equal((await webhook(raw,sig,'application/json')).status,415);
   const first=await webhook(raw,sig);
   assert.equal(first.status,200);assert.equal(first.data.recorded,true);
   const retry=await webhook(raw,sig);
   assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);
   assert.equal((await request('classes/'+id+'/attendance','GET',undefined,host.token)).data.attendance.length,1);
   // A signed event about an uninvolved student is not proof of course enrollment.
   const forgedJoin=JSON.stringify({...event,id:randomUUID(),
     participant:{identity:'student-'+outsider.user.id}});
   assert.equal((await webhook(forgedJoin,signEvent(forgedJoin))).status,403);
   entitled.delete(viewer.user.id+':class:'+id);
   const afterRefund=JSON.stringify({...event,id:randomUUID()});
   assert.equal((await webhook(afterRefund,signEvent(afterRefund))).status,402);
   const cancel=await request('classes/'+id+'/cancel','POST',{reason:'Host canceled the class due to a connectivity issue'},host.token);
   assert.equal(cancel.status,200);assert.equal(cancel.data.class.providerClosed,true);
   assert.deepEqual(events,['CreateRoom','DeleteRoom']);
   assert.equal((await request('classes/'+id+'/room-token','POST',{},host.token)).status,409);
   const late=JSON.stringify({...event,id:randomUUID()});
   assert.equal((await webhook(late,signEvent(late))).status,409);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
