import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedSocialClient} from '../src/hosted-social-api.mjs';
const projectRef='abcdefghij1234567890',publishableKey='sb_publishable_TESTONLY_EXAMPLE_123456789',accessToken='e30.eyJzdWIiOiJ0ZXN0In0.SIGNATUREonly';
const actor='80c0c4f0-847e-4779-a83c-2ff1993f1921',peer='11111111-1111-4111-8111-111111111111';
const user={id:actor,email:'verified@example.test',email_confirmed_at:'2026-11-24T00:00:00Z',is_anonymous:false};
function fixture({session=true,eligible=true,reply={ok:true},status=200}={}){
 const calls=[];
 const client=createHostedSocialClient({projectRef,publishableKey,isCurrentSession:async()=>session,authorizeStudent:async()=>eligible,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/auth/v1/user'))return Response.json(user);
  return status===204?new Response(null,{status}):Response.json(reply,{status});
 }});
 return {calls,run:(operation,input={})=>client.execute({accessToken,operation,input})};
}
test('hosted social uses verified user bearer and explicit RPC args, never service credentials',async()=>{
 const x=fixture();await x.run('send',{peerId:peer,text:'  question  '});
 assert.equal(x.calls.length,2);
 const {url,options}=x.calls[1];
 assert.equal(url,'https://'+projectRef+'.supabase.co/rest/v1/rpc/social_message_action');
 assert.deepEqual(JSON.parse(options.body),{_action:'send',_peer:peer,_body:'question'});
 assert.equal(options.headers.Authorization,'Bearer '+accessToken);assert.equal(options.headers.apikey,publishableKey);
 assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
});
test('session revocation, ineligible users, forged fields and arbitrary routes fail before social IO',async()=>{
 for(const config of [{session:false},{eligible:false}]){
  const x=fixture(config);await assert.rejects(x.run('inbox'),{status:config.session===false?401:403});assert.equal(x.calls.length,1);
 }
 for(const [op,input] of [['send',{peerId:peer,text:'hello',senderId:peer}],['thread',{peerId:'bad'}],['readMessages',{peerId:peer,messageIds:[peer,peer]}],['feed',{limit:101}],['rpc/arbitrary',{}],['updateNotificationPreferences',{messages:true,social:true,community:'yes'}]]){
  const x=fixture();await assert.rejects(x.run(op,input));assert.equal(x.calls.length,1);
 }
});
test('reads use bounded allowlisted columns and likes derive actor from verified Auth',async()=>{
 const x=fixture();
 await x.run('notifications');let url=new URL(x.calls[1].url);
 assert.equal(url.pathname,'/rest/v1/social_notifications');assert.equal(url.searchParams.get('select'),'id,kind,target_id,created_at,read_at');
 await x.run('comments',{contentId:peer});url=new URL(x.calls[3].url);
 assert.equal(url.searchParams.get('content_id'),'eq.'+peer);assert.equal(url.searchParams.get('select').includes('creation_hash'),false);
 await x.run('like',{contentId:peer});assert.deepEqual(JSON.parse(x.calls[5].options.body),{_content:peer,_enabled:true});assert.ok(x.calls[5].url.endsWith('/rpc/social_like_action'));
});
test('database errors map to safe client outcomes without exposing provider detail',async()=>{
 for(const [code,status,expected] of [['42501',403,403],['P0002',404,404],['23505',409,409],['22023',400,422],['P0001',400,429]]){
  const x=fixture({status,reply:{code,message:code==='P0001'?'MESSAGE_RATE_LIMIT':'Sensitive provider detail'}});
  await assert.rejects(x.run('send',{peerId:peer,text:'question'}),err=>err.status===expected&&!err.message.includes('Sensitive'));
 }
});

test('creator restriction mutation derives owner from verified token and rejects spoofing',async()=>{
 const x=fixture();await x.run('setCreatorRestrictions',{viewerId:peer,view:true,comment:false,message:false});assert.deepEqual(JSON.parse(x.calls[1].options.body),{_viewer:peer,_view:true,_comment:false,_message:false});
 const y=fixture();await assert.rejects(y.run('setCreatorRestrictions',{creatorId:peer,viewerId:actor,view:true,comment:false,message:false}),{status:422});assert.equal(y.calls.length,1);
});

test('own-account payout and copyright requests use current Auth, never client actor or transfer instructions',async()=>{const x=fixture({eligible:false});await x.run('myPayouts');assert.deepEqual(JSON.parse(x.calls[1].options.body),{_action:'list'});await x.run('cancelPayout',{requestId:peer});assert.deepEqual(JSON.parse(x.calls[3].options.body),{_action:'cancel',_id:peer});await x.run('copyrightClaim',{id:peer,reason:'Synthetic claim details for contract testing'});assert.equal(JSON.parse(x.calls[5].options.body)._action,'submit');await assert.rejects(x.run('requestPayout',{amountKobo:1000,requestKey:'fixture-request-key'}),{status:403});await assert.rejects(fixture().run('requestPayout',{amountKobo:1,requestKey:'fixture-request-key',creatorId:peer}),{status:422});await assert.rejects(fixture().run('transferPayout',{requestId:peer}),{status:404});await assert.rejects(fixture({session:false}).run('myPayouts'),{status:401});});

test('community membership and available class discovery retain own-account and eligibility boundaries',async()=>{
 const x=fixture();await x.run('myCommunities');
 let url=new URL(x.calls[1].url);assert.equal(url.pathname,'/rest/v1/social_community_members');assert.equal(url.searchParams.get('user_id'),'eq.'+actor);assert.equal(url.searchParams.get('course.active'),'eq.true');
 await x.run('availableClasses',{classId:peer,limit:3});url=new URL(x.calls[3].url);assert.equal(url.pathname,'/rest/v1/interactive_classes');assert.equal(url.searchParams.get('id'),'eq.'+peer);assert.equal(url.searchParams.get('status'),'in.(scheduled,room_open)');assert.equal(url.searchParams.get('limit'),'3');assert.match(url.searchParams.get('ends_at'),/^gt\.\d{4}-/);assert.equal(url.searchParams.get('select').includes('room_name'),false);assert.equal(x.calls[3].options.headers.Authorization,'Bearer '+accessToken);
 for(const op of ['myCommunities','availableClasses']){const y=fixture({eligible:false});await assert.rejects(y.run(op),{status:403});assert.equal(y.calls.length,1);const z=fixture();await assert.rejects(z.run(op,{userId:peer}),{status:422});assert.equal(z.calls.length,1);}
});

test('short draft format and exact likes use actor-bound authenticated operations',async()=>{const x=fixture();await x.run('setDraftFormat',{contentId:peer,format:'short'});assert.equal(new URL(x.calls[1].url).pathname,'/rest/v1/rpc/creator_draft_format');assert.deepEqual(JSON.parse(x.calls[1].options.body),{_content:peer,_format:'short'});await x.run('isLiked',{contentId:peer});const url=new URL(x.calls[3].url);assert.equal(url.searchParams.get('user_id'),'eq.'+actor);assert.equal(url.searchParams.get('content_id'),'eq.'+peer);assert.equal(url.searchParams.get('limit'),'1');await assert.rejects(fixture().run('setDraftFormat',{contentId:peer,format:'photo'}),{status:422});await assert.rejects(fixture({eligible:false}).run('setDraftFormat',{contentId:peer,format:'short'}),{status:403});await assert.rejects(fixture().run('isLiked',{contentId:peer,userId:peer}),{status:422});});

test('student activity dashboard binds identity to verified bearer and rejects arbitrary windows',async()=>{const x=fixture();await x.run('myActivityDashboard');assert.equal(x.calls[1].url,'https://'+projectRef+'.supabase.co/rest/v1/rpc/my_activity_dashboard');assert.deepEqual(JSON.parse(x.calls[1].options.body),{_days:7});await x.run('myActivityDashboard',{days:28});assert.deepEqual(JSON.parse(x.calls[3].options.body),{_days:28});await assert.rejects(fixture().run('myActivityDashboard',{days:365}),{status:422});await assert.rejects(fixture().run('myActivityDashboard',{userId:peer}),{status:422});await assert.rejects(fixture({eligible:false}).run('myActivityDashboard'),{status:403});});

test('watch reports only accept a bounded session sequence, position and boolean playback signals',async()=>{const x=fixture();const b={watchSessionId:peer,sequence:1,positionMs:10000,playing:true,continuous:true};await x.run('recordWatchProgress',b);assert.deepEqual(JSON.parse(x.calls[1].options.body),{_id:peer,_seq:1,_position_ms:10000,_playing:true,_continuous:true});for(const bad of [{...b,userId:peer},{...b,positionMs:-1},{...b,sequence:0},{...b,playing:'true'}])await assert.rejects(fixture().run('recordWatchProgress',bad),{status:422});});

test('watch privacy controls bind to the caller and accept only explicit booleans',async()=>{const x=fixture();await x.run('getWatchPreference');assert.deepEqual(JSON.parse(x.calls[1].options.body),{});await x.run('setWatchPreference',{enabled:false});assert.deepEqual(JSON.parse(x.calls[3].options.body),{_enabled:false});await assert.rejects(x.run('setWatchPreference',{enabled:'false'}),{status:422});await assert.rejects(x.run('setWatchPreference',{enabled:false,viewerId:peer}),{status:422});});

test('retention, recommendations and own watch exports use bounded allowlisted RPCs',async()=>{const x=fixture();await x.run('creatorVideoRetention',{contentId:peer});assert.deepEqual(JSON.parse(x.calls[1].options.body),{_content:peer});await x.run('myRecommendations');assert.deepEqual(JSON.parse(x.calls[3].options.body),{_limit:20});await x.run('myWatchExport',{kind:'daily',afterContentId:peer,afterDay:'2026-11-01',limit:10});assert.deepEqual(JSON.parse(x.calls[5].options.body),{_kind:'daily',_after_content:peer,_after_day:'2026-11-01',_limit:10});for(const input of [{kind:'daily',afterContentId:peer},{kind:'daily',afterContentId:peer,afterDay:'2026-02-30'},{kind:'progress',viewerId:peer}])await assert.rejects(fixture().run('myWatchExport',input),{status:422});await assert.rejects(fixture().run('myRecommendations',{limit:51}),{status:422});await assert.rejects(fixture().run('creatorVideoRetention',{contentId:peer,viewerId:actor}),{status:422});});

test('class creation rejects ambiguous timezone, invalid date, capacity and duration before database mutation',async()=>{const b={courseId:peer,startsAt:'2026-12-01T20:00:00+01:00',endsAt:'2026-12-01T22:00:00+01:00',capacity:12,title:'Evening class',creationKey:'fixture-class-create-1',priceKobo:20000};const x=fixture();await x.run('createClass',b);const input=JSON.parse(x.calls[1].options.body)._input;assert.equal(input.startsAt,'2026-12-01T19:00:00.000Z');assert.equal(input.endsAt,'2026-12-01T21:00:00.000Z');for(const patch of [{capacity:1},{startsAt:'2026-12-01T20:00:00'},{startsAt:'2026-11-31T20:00:00Z'},{startsAt:'2026-12-01T24:00:00Z'},{endsAt:b.startsAt},{endsAt:'2026-12-02T03:00:00+01:00'},{priceKobo:19999}]){const y=fixture();await assert.rejects(y.run('createClass',{...b,...patch}),{status:422});assert.equal(y.calls.length,1);}});
test('tutoring quote and acceptance enforce free or minimum paid price before mutation',async()=>{for(const op of ['quoteHelp','acceptHelp']){for(const quoteKobo of [0,20000,1000000000]){const x=fixture();await x.run(op,{requestId:peer,quoteKobo});assert.equal(JSON.parse(x.calls[1].options.body)._input.quoteKobo,quoteKobo);}for(const quoteKobo of [1,19999,-1,20000.5,1000000001]){const x=fixture();await assert.rejects(x.run(op,{requestId:peer,quoteKobo}),{status:422});assert.equal(x.calls.length,1);}}});
