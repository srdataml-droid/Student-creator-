import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHmac,randomUUID} from 'node:crypto';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {createClassTokenIssuer} from '../src/livekit-class-tokens.mjs';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'week06-learning-'));
  const clock={ms:Date.now()};
  const entitlements=new Set();
  const store=openLocalStore(join(dir,'local.sqlite'),{
    learningClock:()=>clock.ms,
    paymentEntitlements:{hasActiveEntitlement:({buyerId,resourceKind,resourceId})=>entitlements.has(buyerId+':'+resourceKind+':'+resourceId)},
    providerPresenceVerifier:{verify:async e=>e?.syntheticVerifiedSecret==='test-provider-signature'}
  });
  const secret='a-private-synthetic-secret-more-than-16';
  const issuer=createClassTokenIssuer({url:'wss://rooms.example.invalid',apiKey:'test-livekit-key-123',apiSecret:secret,clock:()=>clock.ms});
  const handle=createLocalHandler(store,{classTokenIssuer:issuer});
  async function call(route,method='GET',body,token){
    const url='http://localhost:3000/api/local/'+route;
    const request=new Request(url,{
      method,
      headers:{...(method==='POST'?{origin:'http://localhost:3000'}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...(token?{cookie:'campus_local_session='+token}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const response=await handle(request,route.split('/'));
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  async function prepare(){
    store.bootstrapAdmin('admin@week06.invalid','Strong Synthetic Admin Password 2026');
    const admin=(await call('auth/login','POST',{email:'admin@week06.invalid',password:'Strong Synthetic Admin Password 2026'})).cookie;
    const school=(await call('admin/institutions','POST',{name:'Original Week Six Campus'},admin)).body.institution.id;
    const other=(await call('admin/institutions','POST',{name:'Isolated Other Campus'},admin)).body.institution.id;
    const course=(await call('admin/courses','POST',{institutionId:school,code:'W6101',title:'Interactive Study'},admin)).body.course.id;
    const people={};
    for(const [name,inst] of [['host',school],['viewer',school],['second',school],['other',other]]){
      const email=name+'@week06.invalid',password='Strong Synthetic Student Password 2026';
      const id=(await call('auth/register','POST',{email,password,institutionId:inst})).body.user.id;
      const cookie=(await call('auth/login','POST',{email,password})).cookie;
      assert.equal((await call('admin/verify','POST',{userId:id},admin)).status,200);
      people[name]={id,cookie};
    }
    return {admin,school,course,...people};
  }
  function schedule(course,tag,priceKobo=0){
    return {title:'Original night revision class '+tag,description:'Detailed explanations and student questions',
      startsAt:new Date(clock.ms+8*60000).toISOString(),endsAt:new Date(clock.ms+68*60000).toISOString(),
      capacity:2,priceKobo,creationKey:'week06-class-key-'+tag+'-2026'};
  }
  return {store,clock,entitlements,issuer,call,prepare,schedule,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});},secret};
}
function claims(token,secret){
  const parts=token.split('.');
  assert.equal(parts.length,3);
  assert.equal(createHmac('sha256',secret).update(parts[0]+'.'+parts[1]).digest('base64url'),parts[2]);
  return JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
}

test('class lifecycle: verified creator, replay safety, enrollment cap, room roles, presence and revocation',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const route='courses/'+a.course+'/classes',data=x.schedule(a.course,'free');
    assert.equal((await x.call(route,'POST',data)).status,401);
    const created=await x.call(route,'POST',data,a.host.cookie);
    assert.equal(created.status,201);
    assert.equal((await x.call(route,'POST',x.schedule(a.course,'overlapping'),a.host.cookie)).status,409);
    const id=created.body.class.id;
    assert.equal((await x.call(route,'POST',data,a.host.cookie)).body.class.id,id);
    assert.equal((await x.call(route,'POST',{...data,priceKobo:30000},a.host.cookie)).status,409);
    assert.equal((await x.call(route,'GET',undefined,a.other.cookie)).status,404);
    assert.equal((await x.call(route,'GET',undefined,a.viewer.cookie)).body.classes.length,1);
    assert.equal((await x.call('classes/'+id+'/enroll','POST',{},a.viewer.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/enroll','POST',{},a.viewer.cookie)).body.enrollment.replayed,true);
    assert.equal((await x.call('classes/'+id+'/enroll','POST',{},a.second.cookie)).status,409);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,409);
    assert.equal((await x.call('classes/'+id+'/open','POST',{},a.viewer.cookie)).status,403);
    x.clock.ms+=4*60000;
    const opened=await x.call('classes/'+id+'/open','POST',{},a.host.cookie);
    assert.equal(opened.status,200);
    assert.equal(opened.body.class.streamingVerified,false);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.second.cookie)).status,403);
    const hostToken=(await x.call('classes/'+id+'/room-token','POST',{},a.host.cookie));
    const viewerToken=(await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie));
    assert.equal(hostToken.status,200);assert.equal(viewerToken.status,200);
    const host=claims(hostToken.body.room.token,x.secret),viewer=claims(viewerToken.body.room.token,x.secret);
    assert.equal(host.video.room,'wk-class-'+id);
    assert.equal(host.video.canPublish,true);
    assert.equal(viewer.video.canPublish,false);
    assert.equal(viewer.video.canSubscribe,true);
    assert.equal(viewer.video.roomAdmin,false);
    assert.ok(viewer.exp-viewer.iat<=600);
    const again=await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie);
    assert.equal(again.status,200); // reconnect requires a fresh authorization decision
    const present={eventId:randomUUID(),classId:id,userId:a.viewer.id,kind:'joined',syntheticVerifiedSecret:'test-provider-signature'};
    assert.equal((await x.store.recordVerifiedPresence({...present,syntheticVerifiedSecret:'forgery'}).catch(e=>e.status)),403);
    const attendance=await x.store.recordVerifiedPresence(present);
    assert.equal(attendance.recorded,true);
    assert.equal((await x.store.recordVerifiedPresence(present)).replayed,true);
    assert.equal((await x.call('classes/'+id+'/attendance','GET',undefined,a.viewer.cookie)).status,403);
    assert.equal((await x.call('classes/'+id+'/attendance','GET',undefined,a.host.cookie)).body.attendance.length,1);
    assert.equal((await x.call('classes/'+id+'/cancel','POST',{reason:'The tutor is unavailable today'},a.viewer.cookie)).status,403);
    assert.equal((await x.call('classes/'+id+'/cancel','POST',{reason:'The tutor is unavailable today'},a.host.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,409);
    assert.equal((await x.call('classes/'+id+'/cancel','POST',{reason:'The tutor is unavailable today'},a.host.cookie)).body.class.replayed,true);
  }finally{x.close();}
});

test('paid class and negotiated tutoring fail closed without Week 5 settlement; cancellations open reviews only',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const cls=await x.call('courses/'+a.course+'/classes','POST',x.schedule(a.course,'paid',25000),a.host.cookie);
    assert.equal(cls.status,201);
    const id=cls.body.class.id;
    assert.equal((await x.call('classes/'+id+'/enroll','POST',{},a.viewer.cookie)).body.enrollment.paid,false);
    x.clock.ms+=4*60000;
    assert.equal((await x.call('classes/'+id+'/open','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,402);
    x.entitlements.add(a.viewer.id+':class:'+id);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,200);
    const cancelled=await x.call('classes/'+id+'/cancel','POST',{reason:'Original class must be postponed'},a.host.cookie);
    assert.equal(cancelled.body.class.refundReviews,1);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,409);
    const refund=(await x.call('admin/learning-refund-reviews','GET',undefined,a.admin));
    assert.equal(refund.status,200);assert.equal(refund.body.reviews.length,1);
    assert.equal(refund.body.reviews[0].status,'pending_review');
    assert.equal((await x.call('admin/learning-refund-reviews','GET',undefined,a.viewer.cookie)).status,403);

    const availability=await x.call('me/creator-availability','POST',{slots:[{day:2,start:'19:00',end:'21:00'}]},a.host.cookie);
    assert.equal(availability.status,200);
    assert.equal((await x.call('creators/'+a.host.id+'/availability','GET',undefined,a.other.cookie)).status,404);
    const request={
      creatorId:a.host.id,kind:'assignment_explanation',
      description:'Please explain how to approach this mathematical assignment and help me understand the method without submitting my work for me.',
      budgetKobo:30000,integrityAttested:true,creationKey:'week06-help-unique-1234'
    };
    assert.equal((await x.call('learning-requests','POST',{...request,description:'Do my assignment for me'},a.viewer.cookie)).status,422);
    const item=await x.call('learning-requests','POST',request,a.viewer.cookie);
    assert.equal(item.status,201);
    const requestId=item.body.request.id;
    assert.equal((await x.call('learning-requests','POST',request,a.viewer.cookie)).body.request.replayed,true);
    assert.equal((await x.call('learning-requests/'+requestId+'/quote','POST',{quoteKobo:34000},a.second.cookie)).status,404);
    assert.equal((await x.call('learning-requests/'+requestId+'/quote','POST',{quoteKobo:34000},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+requestId+'/accept','POST',{expectedQuoteKobo:33000},a.viewer.cookie)).status,409);
    assert.equal((await x.call('learning-requests/'+requestId+'/accept','POST',{expectedQuoteKobo:34000},a.viewer.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+requestId+'/start','POST',{},a.host.cookie)).status,402);
    x.entitlements.add(a.viewer.id+':service:'+requestId);
    assert.equal((await x.call('learning-requests/'+requestId+'/start','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+requestId+'/submit','POST',{},a.host.cookie)).status,200);
    const disputed=await x.call('learning-requests/'+requestId+'/dispute','POST',{reason:'The explanation did not match the agreed project guidance.'},a.viewer.cookie);
    assert.equal(disputed.status,200);
    assert.equal((await x.call('learning-requests/'+requestId+'/dispute','POST',{reason:'The explanation did not match the agreed project guidance.'},a.viewer.cookie)).body.dispute.replayed,true);
    assert.equal((await x.call('admin/learning-disputes','GET',undefined,a.admin)).body.disputes.length,1);
    assert.equal((await x.call('admin/learning-refund-reviews','GET',undefined,a.admin)).body.reviews.length,2);
    assert.equal((await x.call('learning-requests/'+requestId+'/confirm','POST',{},a.viewer.cookie)).status,409);
    assert.equal((await x.call('admin/learning-disputes/'+disputed.body.dispute.id+'/resolve','POST',{resolution:'The operator reviewed the learning dispute without issuing a refund.'},a.admin)).status,200);
    const notices=await x.call('me/learning-notifications','GET',undefined,a.viewer.cookie);
    assert.equal(notices.status,200);assert.ok(notices.body.notifications.length>=2);
    const notice=notices.body.notifications[0];
    assert.equal((await x.call('learning-notifications/'+notice.id+'/read','POST',{},a.other.cookie)).status,404);
    assert.equal((await x.call('learning-notifications/'+notice.id+'/read','POST',{},a.viewer.cookie)).status,200);
  }finally{x.close();}
});

test('free guidance progresses through student confirmation; unexpected fields and forged room tokens fail closed',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const one=await x.call('learning-requests','POST',{
      creatorId:a.host.id,kind:'project_guidance',
      description:'Please walk me through the reasoning and practical design decisions for an original project.',
      integrityAttested:true,creationKey:'week06-free-help-unique'},a.viewer.cookie);
    assert.equal(one.status,201);
    const id=one.body.request.id;
    assert.equal((await x.call('learning-requests/'+id+'/quote','POST',{quoteKobo:0},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/accept','POST',{expectedQuoteKobo:0},a.viewer.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/start','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/submit','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/confirm','POST',{},a.host.cookie)).status,403);
    assert.equal((await x.call('learning-requests/'+id+'/confirm','POST',{},a.viewer.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/confirm','POST',{},a.viewer.cookie)).body.request.replayed,true);
    const data=x.schedule(a.course,'token');
    assert.equal((await x.call('courses/'+a.course+'/classes','POST',{...data,role:'host'},a.host.cookie)).status,400);
    const cls=await x.call('courses/'+a.course+'/classes','POST',data,a.host.cookie);
    assert.equal(cls.status,201);
    assert.equal((await x.call('classes/'+cls.body.class.id+'/room-token','POST',{role:'host'},a.viewer.cookie)).status,400);
  }finally{x.close();}
});


test('paid room grants are revoked by creator blocks and entitlement reversal; reconnect issues unique IDs',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const created=await x.call('courses/'+a.course+'/classes','POST',x.schedule(a.course,'revocation',22000),a.host.cookie);
    assert.equal(created.status,201);
    const id=created.body.class.id;
    assert.equal((await x.call('classes/'+id+'/enroll','POST',{},a.viewer.cookie)).status,200);
    x.clock.ms+=4*60000;
    assert.equal((await x.call('classes/'+id+'/open','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,402);
    const paidKey=a.viewer.id+':class:'+id;
    x.entitlements.add(paidKey);
    const first=await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie);
    const second=await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie);
    assert.equal(first.status,200);
    assert.equal(second.status,200);
    assert.notEqual(claims(first.body.room.token,x.secret).jti,claims(second.body.room.token,x.secret).jti);
    assert.equal(claims(first.body.room.token,x.secret).video.roomJoin,true);
    assert.equal(claims(first.body.room.token,x.secret).video.canPublish,false);
    x.store.setCreatorRestrictions({id:a.host.id,role:'student',verifiedAt:new Date().toISOString(),institutionId:a.school},
      a.host.id,a.viewer.id,{view:true,comment:false,message:false});
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,403);
    x.store.setCreatorRestrictions({id:a.host.id,role:'student',verifiedAt:new Date().toISOString(),institutionId:a.school},
      a.host.id,a.viewer.id,{view:false,comment:false,message:false});
    x.entitlements.delete(paidKey);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,402);
    x.entitlements.add(paidKey);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,200);
    x.clock.ms+=70*60000;
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,409);
  }finally{x.close();}
});

test('room deletion worker retries provider errors and only administrators can drain outbox',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const created=await x.call('courses/'+a.course+'/classes','POST',x.schedule(a.course,'closedroom'),a.host.cookie);
    const id=created.body.class.id;
    assert.equal(created.status,201);
    x.clock.ms+=4*60000;
    assert.equal((await x.call('classes/'+id+'/open','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/cancel','POST',{reason:'Creator unavailable for a live lesson'},a.host.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.host.cookie)).status,409);
    const student={id:a.viewer.id,role:'student',verifiedAt:new Date().toISOString(),institutionId:a.school};
    assert.equal(await x.store.drainRoomClosures(student,{deleteRoom:async()=>{}}).catch(e=>e.status),403);
    const admin=x.store.login('admin@week06.invalid','Strong Synthetic Admin Password 2026').user;
    assert.equal(await x.store.drainRoomClosures(admin,null).catch(e=>e.status),503);
    let failedOnce=true,callCount=0;
    const provider={async deleteRoom(name){
      assert.equal(name,'wk-class-'+id);callCount++;
      if(failedOnce){failedOnce=false;throw Error('transient provider timeout');}
    }};
    const first=await x.store.drainRoomClosures(admin,provider);
    assert.deepEqual({completed:first.completed,failed:first.failed,remaining:first.remaining},{completed:0,failed:1,remaining:1});
    const next=await x.store.drainRoomClosures(admin,provider);
    assert.deepEqual({completed:next.completed,failed:next.failed,remaining:next.remaining},{completed:1,failed:0,remaining:0});
    assert.equal((await x.store.drainRoomClosures(admin,provider)).completed,0);
    assert.equal(callCount,2);
  }finally{x.close();}
});

test('cancellation, refused service progress after entitlement reversal, and reminder deduplication',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const request={
      creatorId:a.host.id,kind:'tutoring',description:'Please explain how to reason about these original mathematical examples, without completing any assessment.',
      integrityAttested:true,creationKey:'wk06-reminder-help-unique-01'
    };
    const created=await x.call('learning-requests','POST',request,a.viewer.cookie);
    const id=created.body.request.id;
    assert.equal(created.status,201);
    assert.equal((await x.call('learning-requests/'+id+'/quote','POST',{quoteKobo:24000},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/accept','POST',{expectedQuoteKobo:24000},a.viewer.cookie)).status,200);
    x.entitlements.add(a.viewer.id+':service:'+id);
    assert.equal((await x.call('learning-requests/'+id+'/start','POST',{},a.host.cookie)).status,200);
    x.entitlements.delete(a.viewer.id+':service:'+id);
    assert.equal((await x.call('learning-requests/'+id+'/submit','POST',{},a.host.cookie)).status,402);
    assert.equal((await x.call('learning-requests/'+id+'/cancel','POST',{reason:'Unable to provide the agreed explanation'},a.host.cookie)).status,200);
    assert.equal((await x.call('learning-requests/'+id+'/cancel','POST',{reason:'Unable to provide the agreed explanation'},a.host.cookie)).body.request.replayed,true);
    const reviews=await x.call('admin/learning-refund-reviews','GET',undefined,a.admin);
    assert.equal(reviews.status,200);
    assert.equal(reviews.body.reviews.filter(x=>x.resourceId===id).length,1);
    assert.equal((await x.call('learning-requests/'+id+'/submit','POST',{},a.host.cookie)).status,409);

    const cls=await x.call('courses/'+a.course+'/classes','POST',x.schedule(a.course,'reminder'),a.host.cookie);
    const classId=cls.body.class.id;
    assert.equal((await x.call('classes/'+classId+'/enroll','POST',{},a.viewer.cookie)).status,200);
    assert.equal((await x.call('admin/learning-reminders/queue','POST',{},a.viewer.cookie)).status,403);
    const one=await x.call('admin/learning-reminders/queue','POST',{},a.admin);
    const two=await x.call('admin/learning-reminders/queue','POST',{},a.admin);
    assert.equal(one.status,200);
    assert.equal(two.status,200);
    const notifications=await x.call('me/learning-notifications','GET',undefined,a.viewer.cookie);
    assert.equal(notifications.body.notifications.filter(x=>x.kind==='class_reminder'&&x.resourceId===classId).length,1);
  }finally{x.close();}
});


test('host participant removal revokes fresh room grants and retries provider disconnect',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const room=await x.call('courses/'+a.course+'/classes','POST',x.schedule(a.course,'participant-removal'),a.host.cookie);
    assert.equal(room.status,201);
    const id=room.body.class.id;
    assert.equal((await x.call('classes/'+id+'/enroll','POST',{},a.viewer.cookie)).status,200);
    const payload={studentId:a.viewer.id,reason:'Host removed this student after a documented behavior report'};
    assert.equal((await x.call('classes/'+id+'/remove-participant','POST',payload,a.viewer.cookie)).status,403);
    const kicked=await x.call('classes/'+id+'/remove-participant','POST',payload,a.host.cookie);
    assert.equal(kicked.status,200);
    assert.equal(kicked.body.removal.providerRemovalQueued,true);
    assert.equal(kicked.body.removal.providerRemoved,false);
    assert.equal((await x.call('classes/'+id+'/remove-participant','POST',payload,a.host.cookie)).body.removal.replayed,true);
    const admin=x.store.login('admin@week06.invalid','Strong Synthetic Admin Password 2026').user;
    let attempts=0;
    const provider={async removeParticipant(roomName,identity,options){
      assert.equal(roomName,'wk-class-'+id);
      assert.equal(identity,'student-'+a.viewer.id);
      assert.ok(options.revokeTokenTs>0);
      attempts++;
      if(attempts===1)throw Error('synthetic temporary provider outage');
    }};
    const first=await x.store.drainParticipantRemovals(admin,provider);
    assert.deepEqual({completed:first.completed,failed:first.failed,remaining:first.remaining},
      {completed:0,failed:1,remaining:1});
    const next=await x.store.drainParticipantRemovals(admin,provider);
    assert.deepEqual({completed:next.completed,failed:next.failed,remaining:next.remaining},
      {completed:1,failed:0,remaining:0});
    assert.equal((await x.store.drainParticipantRemovals(admin,provider)).remaining,0);
    x.clock.ms+=4*60000;
    assert.equal((await x.call('classes/'+id+'/open','POST',{},a.host.cookie)).status,200);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.viewer.cookie)).status,403);
    assert.equal((await x.call('classes/'+id+'/room-token','POST',{},a.host.cookie)).status,200);
    assert.equal(attempts,2);
  }finally{x.close();}
});


test('admin expiry prevents abandoned live rooms and queues financial review for unopened paid classes',async()=>{
  const x=fixture();
  try{
    const a=await x.prepare();
    const paid=await x.call('courses/'+a.course+'/classes','POST',x.schedule(a.course,'expired-paid',25000),a.host.cookie);
    // The real scheduling contract rejects overlapping classes for one host.
    const later=x.schedule(a.course,'expired-open');
    later.startsAt=new Date(x.clock.ms+90*60000).toISOString();
    later.endsAt=new Date(x.clock.ms+150*60000).toISOString();
    const open=await x.call('courses/'+a.course+'/classes','POST',later,a.host.cookie);
    assert.equal(paid.status,201);assert.equal(open.status,201);
    const paidId=paid.body.class.id,openId=open.body.class.id;
    assert.equal((await x.call('classes/'+paidId+'/enroll','POST',{},a.viewer.cookie)).status,200);
    x.clock.ms+=86*60000;
    assert.equal((await x.call('classes/'+openId+'/open','POST',{},a.host.cookie)).status,200);
    x.clock.ms+=70*60000;
    assert.equal((await x.call('admin/learning-classes/expire','POST',{},a.viewer.cookie)).status,403);
    const expiry=await x.call('admin/learning-classes/expire','POST',{},a.admin);
    assert.equal(expiry.status,200);
    assert.deepEqual(expiry.body.expiry,{completed:1,cancelled:1,refundReviews:1,roomDeletionsQueued:2});
    assert.equal((await x.call('classes/'+paidId,'GET',undefined,a.viewer.cookie)).body.class.status,'cancelled');
    assert.equal((await x.call('classes/'+openId,'GET',undefined,a.host.cookie)).body.class.status,'completed');
    assert.equal((await x.call('classes/'+openId+'/room-token','POST',{},a.host.cookie)).status,409);
    const refund=(await x.call('admin/learning-refund-reviews','GET',undefined,a.admin)).body.reviews;
    assert.equal(refund.filter(item=>item.resourceId===paidId).length,1);
    const notices=(await x.call('me/learning-notifications','GET',undefined,a.viewer.cookie)).body.notifications;
    assert.ok(notices.some(item=>item.kind==='class_cancelled'&&item.resourceId===paidId));
    const again=await x.call('admin/learning-classes/expire','POST',{},a.admin);
    assert.equal(again.status,200);assert.equal(again.body.expiry.roomDeletionsQueued,0);
    const admin=x.store.login('admin@week06.invalid','Strong Synthetic Admin Password 2026').user;
    const cleared=await x.store.drainRoomClosures(admin,{deleteRoom:async()=>{}});
    assert.equal(cleared.completed,2);
    assert.equal(cleared.remaining,0);
  }finally{x.close();}
});
