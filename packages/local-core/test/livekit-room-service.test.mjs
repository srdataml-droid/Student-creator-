import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {createLiveKitRoomService} from '../src/livekit-room-service.mjs';

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

// The Week 6 local HTTP integration remains on PR #46. This hosted branch
// does not import its SQLite handlers; hosted attendance integration is tested
// by hosted-livekit-class.test.mjs and the hosted SQL contract.
