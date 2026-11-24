import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {issueAuthorizedMuxPlayback} from '../src/mux-playback.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const privateKeyBase64=Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64');
const lesson={id:'lesson_1234',status:'published',videoStatus:'ready',playbackPolicy:'signed',playbackId:'mux_playback_1234'};
let seen;
const permitted={viewer:{id:'viewer_1'},lessonId:lesson.id,
 loadLesson:async id=>{seen=id;return lesson;},authorizeViewer:async()=>true,
 signingKeyId:'mux_key_1234',privateKeyBase64,nowSeconds:1_800_000_000,ttlSeconds:600};
const err=code=>({code});

test('signs verified RS256 Mux video JWT with server-stored playback ID and bounded expiry',async()=>{
 const {url,expiresAt}=await issueAuthorizedMuxPlayback(permitted);
 assert.equal(seen,lesson.id);
 const parsed=new URL(url);
 assert.equal(parsed.origin,'https://stream.mux.com');
 assert.equal(parsed.pathname,'/'+lesson.playbackId+'.m3u8');
 const token=parsed.searchParams.get('token');
 const [h,p,s]=token.split('.');
 const header=JSON.parse(Buffer.from(h,'base64url').toString());
 const claims=JSON.parse(Buffer.from(p,'base64url').toString());
 assert.deepEqual(header,{alg:'RS256',typ:'JWT',kid:permitted.signingKeyId});
 assert.deepEqual(claims,{sub:lesson.playbackId,aud:'v',exp:1_800_000_600,kid:permitted.signingKeyId});
 assert.equal(expiresAt,1_800_000_600);
 assert.equal(verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')),true);
 assert.equal(JSON.stringify({url,expiresAt}).includes(privateKeyBase64),false);
});
test('rejects missing viewer before database access',async()=>{
 let called=false;
 await assert.rejects(issueAuthorizedMuxPlayback({...permitted,viewer:null,loadLesson:async()=>{called=true;}}),err('AUTH_REQUIRED'));
 assert.equal(called,false);
});
test('refuses lessons not found or owned by another ID',async()=>{
 for(const bad of [null,{...lesson,id:'different_1234'}])
  await assert.rejects(issueAuthorizedMuxPlayback({...permitted,loadLesson:async()=>bad}),err('LESSON_NOT_FOUND'));
});
test('refuses draft, unprocessed, public-policy and missing playback IDs',async()=>{
 for(const change of [{status:'draft'},{videoStatus:'processing'},{playbackPolicy:'public'},{playbackId:''}])
  await assert.rejects(issueAuthorizedMuxPlayback({...permitted,loadLesson:async()=>({...lesson,...change})}),err('PLAYBACK_UNAVAILABLE'));
});
test('refuses absent and nonaffirmative entitlement checks',async()=>{
 for(const verdict of [false,null,undefined,'true'])
  await assert.rejects(issueAuthorizedMuxPlayback({...permitted,authorizeViewer:async()=>verdict}),err('PLAYBACK_FORBIDDEN'));
 await assert.rejects(issueAuthorizedMuxPlayback({...permitted,authorizeViewer:undefined}),err('PLAYBACK_BACKEND_UNAVAILABLE'));
});
test('propagates authoritative revocation denial, never signs a token',async()=>{
 await assert.rejects(issueAuthorizedMuxPlayback({...permitted,authorizeViewer:async()=>{throw err('PURCHASE_REVOKED');}}),err('PURCHASE_REVOKED'));
});
test('rejects unsigned keys, weak keys and invalid lifetime',async()=>{
 await assert.rejects(issueAuthorizedMuxPlayback({...permitted,privateKeyBase64:''}),err('MUX_SIGNING_UNAVAILABLE'));
 const weak=generateKeyPairSync('rsa',{modulusLength:1024}).privateKey.export({type:'pkcs8',format:'pem'});
 await assert.rejects(issueAuthorizedMuxPlayback({...permitted,privateKeyBase64:Buffer.from(weak).toString('base64')}),err('MUX_SIGNING_UNAVAILABLE'));
 for(const ttlSeconds of [1,59,901,1.5])
  await assert.rejects(issueAuthorizedMuxPlayback({...permitted,ttlSeconds}),err('INVALID_PLAYBACK_LIFETIME'));
});
