import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCreatorRequest,validatePlaybackGrant,mergePrivateMessages} from './hosted-creator-client.mjs';
const id='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
test('submission sends no body and moderation accepts only decision and reason',()=>{
 const r=hostedCreatorRequest('submitReview',{lessonId:id,status:'published'});
 assert.equal(r.path,'/api/lessons/'+id+'/submit');assert.equal(r.body,undefined);
 assert.deepEqual(JSON.parse(hostedCreatorRequest('moderate',{lessonId:id,decision:'approve',reason:'Valid review',role:'admin'}).body),{decision:'approve',reason:'Valid review'});
 assert.throws(()=>hostedCreatorRequest('moderate',{lessonId:id,decision:'publish',reason:'Valid review'}));
});
test('playback grants must be signed Mux URLs with a bounded lifetime',()=>{
 const url='https://stream.mux.com/playback123.m3u8?token=one.two.three';
 assert.equal(validatePlaybackGrant({url,expiresAt:1120},1000).url,url);
 for(const value of [url.replace('stream.mux.com','stream.mux.com.evil.test'),url+'&x=1',url.replace('https:','http:'),url.replace('one.two.three','plain')])assert.throws(()=>validatePlaybackGrant({url:value,expiresAt:1120},1000));
 for(const expiresAt of [1000,1901,NaN])assert.throws(()=>validatePlaybackGrant({url,expiresAt},1000));
});
test('feed and interactions are bounded and cannot select an actor',()=>{
 assert.deepEqual(JSON.parse(hostedCreatorRequest('feed',{mode:'following',actor:other}).body),{mode:'following',q:'',limit:60});
 assert.throws(()=>hostedCreatorRequest('feed',{mode:'admin'}));
 assert.throws(()=>hostedCreatorRequest('comment',{contentId:id,text:'hi',creationKey:'valid-key-123456789'}));
 assert.equal(JSON.parse(hostedCreatorRequest('comment',{contentId:id,text:'Original question',creationKey:'valid-key-123456789',actor:other}).body).replyTo,null);
});
test('private thread merges only the current pair, deduplicates and rejects foreign messages',()=>{
 const message={id:other,senderId:peer,recipientId:id,body:'Original message',createdAt:'2026-11-25T10:00:00Z'};
 assert.deepEqual(mergePrivateMessages([message],[message],id,peer),[message]);
 assert.throws(()=>mergePrivateMessages([],[{...message,recipientId:other}],id,peer));
 assert.throws(()=>mergePrivateMessages([],[{...message,createdAt:'bad'}],id,peer));
});
test('message operations are scoped and read acknowledgments bounded',()=>{
 assert.deepEqual(JSON.parse(hostedCreatorRequest('send',{peerId:peer,text:'Hello',senderId:other}).body),{peerId:peer,text:'Hello'});
 assert.throws(()=>hostedCreatorRequest('readMessages',{peerId:peer,messageIds:[id,id]}));
 assert.throws(()=>hostedCreatorRequest('thread',{peerId:'../bad'}));
 assert.equal(hostedCreatorRequest('notifications').path,'/api/social/notifications');
});
