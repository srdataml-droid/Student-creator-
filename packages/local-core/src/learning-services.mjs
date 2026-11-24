/** Week 6: persistent local-only classes and legitimate creator guidance.
 * Existing student verification, creator permission and SQLite transaction primitives are injected.
 * Money remains a read-only Week 5 entitlement boundary: never treat a browser callback as settlement.
 */
import {randomUUID} from 'node:crypto';

const timestamp=()=>new Date().toISOString();
const idempotency=/^[A-Za-z0-9_-]{16,128}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badWork=/\b(?:do|finish|write|complete|submit|take)\s+(?:my|our|the)\s+(?:graded\s+)?(?:assignment|homework|exam|test|project|thesis)\s+(?:for\s+me|on\s+my\s+behalf|as\s+my\s+own)\b|\bimpersonat(?:e|ion)\b/i;
const rowClass=r=>({id:r.id,courseId:r.course_id,hostId:r.host_id,title:r.title,description:r.description,
  startsAt:r.starts_at,endsAt:r.ends_at,capacity:r.capacity,priceKobo:r.price_kobo,currency:'NGN',
  status:r.status,roomName:r.room_name,createdAt:r.created_at,updatedAt:r.updated_at});
const rowService=r=>({id:r.id,studentId:r.student_id,creatorId:r.creator_id,kind:r.kind,
  description:r.description,budgetKobo:r.budget_kobo,quoteKobo:r.quote_kobo,currency:'NGN',
  status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});
const valText=(value,min,max,error,code)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw error(code,422);return value.trim();};
const amount=(v,error,nullable=false)=>{
  if(nullable&&v===null)return null;
  if(!Number.isSafeInteger(v)||v<0||v>1000000000)throw error('INVALID_PRICE',422);
  return v;
};
const iso=x=>typeof x==='string'&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString()===x;
const requireKey=(x,error)=>{if(typeof x!=='string'||!idempotency.test(x))throw error('INVALID_IDEMPOTENCY_KEY',422);};

export function createLearningServices({db,transaction,audit,error,requireVerified,requireCreatorAction,
  paymentEntitlements=null,clock=()=>Date.now(),providerPresenceVerifier=null}){
  db.exec([
    "CREATE TABLE IF NOT EXISTS interactive_classes (id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),host_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 50),price_kobo INTEGER NOT NULL CHECK(price_kobo BETWEEN 0 AND 1000000000),status TEXT NOT NULL CHECK(status IN ('scheduled','room_open','completed','cancelled')),room_name TEXT NOT NULL UNIQUE,reason TEXT,creation_key TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(host_id,creation_key));",
    "CREATE INDEX IF NOT EXISTS interactive_classes_course_time ON interactive_classes(course_id,starts_at);",
    "CREATE TABLE IF NOT EXISTS interactive_class_enrollments (class_id TEXT NOT NULL REFERENCES interactive_classes(id),student_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('enrolled','withdrawn')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(class_id,student_id));",
    "CREATE TABLE IF NOT EXISTS interactive_class_presence (provider_event_id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES interactive_classes(id),student_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('joined','left')),created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS learning_room_closures (class_id TEXT PRIMARY KEY REFERENCES interactive_classes(id),room_name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done')),attempts INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS creator_availability (creator_id TEXT PRIMARY KEY REFERENCES users(id),slots_json TEXT NOT NULL,updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS learning_requests (id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES users(id),creator_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('tutoring','assignment_explanation','project_guidance')),description TEXT NOT NULL,budget_kobo INTEGER,quote_kobo INTEGER,status TEXT NOT NULL CHECK(status IN ('requested','quoted','accepted','in_progress','submitted','completed','rejected','cancelled','disputed')),creation_key TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(student_id,creation_key));",
    "CREATE TABLE IF NOT EXISTS learning_disputes (id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES learning_requests(id),reporter_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),resolution TEXT,created_at TEXT NOT NULL,reviewed_at TEXT,reviewed_by TEXT REFERENCES users(id));",
    "CREATE TABLE IF NOT EXISTS learning_refund_reviews (id TEXT PRIMARY KEY,resource_kind TEXT NOT NULL CHECK(resource_kind IN ('class','service')),resource_id TEXT NOT NULL,student_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','recorded')),reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(resource_kind,resource_id,student_id));",
    "CREATE TABLE IF NOT EXISTS learning_notifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,resource_id TEXT NOT NULL,body TEXT NOT NULL,seen_at TEXT,created_at TEXT NOT NULL,UNIQUE(user_id,kind,resource_id));"
  ].join('\n'));
  const now=()=>clock();
  const notice=(userId,kind,resourceId,body)=>{
    db.prepare('INSERT OR IGNORE INTO learning_notifications(id,user_id,kind,resource_id,body,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),userId,kind,resourceId,body,timestamp());
  };
  const identity=(actor,courseId)=>{
    requireVerified(actor);
    const row=db.prepare('SELECT id,institution_id FROM courses WHERE id=? AND active=1').get(courseId);
    if(!row||row.institution_id!==actor.institutionId)throw error('CLASS_NOT_FOUND',404);
    return row;
  };
  const classRow=(actor,classId)=>{
    requireVerified(actor);
    const row=db.prepare('SELECT * FROM interactive_classes WHERE id=?').get(classId);
    if(!row)throw error('CLASS_NOT_FOUND',404);
    identity(actor,row.course_id);
    requireCreatorAction(actor,row.host_id,'view');
    return row;
  };
  const member=(actor,classId)=>db.prepare("SELECT 1 FROM interactive_class_enrollments WHERE class_id=? AND student_id=? AND status='enrolled'").get(classId,actor.id);
  const paid=(actor,kind,id)=>{
    if(!paymentEntitlements||typeof paymentEntitlements.hasActiveEntitlement!=='function')return false;
    // Week 5 must supply a *trusted server-side* read; client state is never accepted here.
    return paymentEntitlements.hasActiveEntitlement({buyerId:actor.id,resourceKind:kind,resourceId:id})===true;
  };
  const refund=(resourceKind,resourceId,studentId,reason)=>{
    db.prepare('INSERT OR IGNORE INTO learning_refund_reviews(id,resource_kind,resource_id,student_id,reason,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),resourceKind,resourceId,studentId,reason,timestamp());
    notice(studentId,'refund_review',resourceId,'A financial review has been requested. No refund is guaranteed or paid yet.');
  };
  const requestRow=(actor,id)=>{
    requireVerified(actor);
    const row=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
    if(!row||![row.creator_id,row.student_id].includes(actor.id))throw error('REQUEST_NOT_FOUND',404);
    return row;
  };
  return {
    scheduleClass(actor,input={}){
      identity(actor,input.courseId);
      requireKey(input.creationKey,error);
      const title=valText(input.title,5,120,error,'INVALID_CLASS');
      const description=valText(input.description??'',0,1200,error,'INVALID_CLASS');
      if(!iso(input.startsAt)||!iso(input.endsAt))throw error('INVALID_SCHEDULE',422);
      const starts=Date.parse(input.startsAt),ends=Date.parse(input.endsAt);
      if(starts<now()+5*60000||starts>now()+90*86400000||ends-starts<15*60000||ends-starts>4*3600000)throw error('INVALID_SCHEDULE',422);
      if(!Number.isInteger(input.capacity)||input.capacity<2||input.capacity>50)throw error('INVALID_CAPACITY',422);
      const price=amount(input.priceKobo??0,error);
      if(price>0&&price<20000)throw error('BELOW_MINIMUM_PRICE',422);
      const normalized={courseId:input.courseId,title,description,startsAt:input.startsAt,endsAt:input.endsAt,capacity:input.capacity,priceKobo:price};
      return transaction(()=>{
        const old=db.prepare('SELECT * FROM interactive_classes WHERE host_id=? AND creation_key=?').get(actor.id,input.creationKey);
        if(old){
          const prior={courseId:old.course_id,title:old.title,description:old.description,startsAt:old.starts_at,endsAt:old.ends_at,capacity:old.capacity,priceKobo:old.price_kobo};
          if(JSON.stringify(prior)!==JSON.stringify(normalized))throw error('IDEMPOTENCY_CONFLICT',409);
          return {...rowClass(old),replayed:true};
        }
        const id=randomUUID(),date=timestamp();
        db.prepare("INSERT INTO interactive_classes(id,course_id,host_id,title,description,starts_at,ends_at,capacity,price_kobo,status,room_name,creation_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'scheduled',?,?,?,?)")
          .run(id,input.courseId,actor.id,title,description,input.startsAt,input.endsAt,input.capacity,price,'wk-class-'+id,input.creationKey,date,date);
        audit(actor.id,'class.scheduled',id,{priceKobo:price});
        return {...normalized,id,hostId:actor.id,status:'scheduled',currency:'NGN',roomName:'wk-class-'+id,createdAt:date,updatedAt:date,replayed:false};
      });
    },
    discoverClasses(actor,courseId){
      identity(actor,courseId);
      return db.prepare("SELECT * FROM interactive_classes WHERE course_id=? AND status IN ('scheduled','room_open') AND ends_at>? ORDER BY starts_at LIMIT 100")
        .all(courseId,new Date(now()).toISOString()).filter(x=>{
          try{requireCreatorAction(actor,x.host_id,'view');return true;}catch{return false;}
        }).map(x=>({...rowClass(x),enrolled:x.host_id===actor.id||Boolean(member(actor,x.id)),
          attendeeCount:db.prepare("SELECT COUNT(*) AS n FROM interactive_class_enrollments WHERE class_id=? AND status='enrolled'").get(x.id).n+1,
          accessEligible:x.host_id===actor.id||x.price_kobo===0||paid(actor,'class',x.id)}));
    },
    myClasses(actor){
      requireVerified(actor);
      const rows=db.prepare("SELECT DISTINCT c.* FROM interactive_classes c LEFT JOIN interactive_class_enrollments e ON e.class_id=c.id WHERE c.host_id=? OR (e.student_id=? AND e.status='enrolled') ORDER BY c.starts_at DESC LIMIT 100").all(actor.id,actor.id);
      return rows.filter(c=>{
        try{classRow(actor,c.id);return true;}catch{return false;}
      }).map(rowClass);
    },
    classDetail(actor,id){return rowClass(classRow(actor,id));},
    enrollClass(actor,id){
      const row=classRow(actor,id);
      if(row.host_id===actor.id)throw error('HOST_ALREADY_ENROLLED',409);
      return transaction(()=>{
        const current=db.prepare('SELECT * FROM interactive_class_enrollments WHERE class_id=? AND student_id=?').get(id,actor.id);
        if(current?.status==='enrolled')return {classId:id,enrolled:true,paid:row.price_kobo===0||paid(actor,'class',id),replayed:true};
        if(row.status!=='scheduled'||Date.parse(row.starts_at)<=now())throw error('CLASS_CLOSED',409);
        const count=db.prepare("SELECT count(*) AS n FROM interactive_class_enrollments WHERE class_id=? AND status='enrolled'").get(id).n;
        if(count+1>=row.capacity)throw error('CLASS_FULL',409);
        const date=timestamp();
        db.prepare("INSERT INTO interactive_class_enrollments(class_id,student_id,status,created_at,updated_at) VALUES(?,?,'enrolled',?,?) ON CONFLICT(class_id,student_id) DO UPDATE SET status='enrolled',updated_at=excluded.updated_at")
          .run(id,actor.id,date,date);
        notice(row.host_id,'class_enrollment',id,'A verified student enrolled in your class.');
        audit(actor.id,'class.enrolled',id);
        return {classId:id,enrolled:true,paid:row.price_kobo===0||paid(actor,'class',id),replayed:false};
      });
    },
    withdrawClass(actor,id){
      const row=classRow(actor,id);
      if(row.host_id===actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const change=db.prepare("UPDATE interactive_class_enrollments SET status='withdrawn',updated_at=? WHERE class_id=? AND student_id=? AND status='enrolled'")
          .run(timestamp(),id,actor.id).changes;
        if(change&&row.price_kobo>0)refund('class',id,actor.id,'Withdrawal from paid class: financial operator must verify charge and policy.');
        if(change)audit(actor.id,'class.withdrawn',id);
        return {classId:id,enrolled:false,replayed:change===0,refundReviewRequested:Boolean(change&&row.price_kobo>0)};
      });
    },
    preflightOpenClass(actor,id){
      const row=classRow(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      if(row.status!=='scheduled'&&row.status!=='room_open')throw error('CLASS_CLOSED',409);
      if(now()<Date.parse(row.starts_at)-15*60000||now()>Date.parse(row.ends_at))
        throw error('CLASS_NOT_READY',409);
      return {roomName:row.room_name,capacity:row.capacity,alreadyOpen:row.status==='room_open'};
    },
    openClass(actor,id){
      const row=classRow(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const current=db.prepare('SELECT status FROM interactive_classes WHERE id=?').get(id);
        if(current.status==='room_open')return {id,status:'room_open',replayed:true,streamingVerified:false};
        if(current.status!=='scheduled'||now()<Date.parse(row.starts_at)-15*60000||now()>Date.parse(row.ends_at))throw error('CLASS_NOT_READY',409);
        db.prepare("UPDATE interactive_classes SET status='room_open',updated_at=? WHERE id=?").run(timestamp(),id);
        audit(actor.id,'class.room.opened',id);
        return {id,status:'room_open',replayed:false,streamingVerified:false};
      });
    },
    finishClass(actor,id){
      const row=classRow(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const current=db.prepare('SELECT status FROM interactive_classes WHERE id=?').get(id);
        if(current.status==='completed')return {id,status:'completed',replayed:true};
        if(current.status!=='room_open')throw error('CLASS_NOT_LIVE',409);
        db.prepare("UPDATE interactive_classes SET status='completed',updated_at=? WHERE id=?").run(timestamp(),id);
        db.prepare("INSERT OR IGNORE INTO learning_room_closures(class_id,room_name,state,updated_at) VALUES(?,?,'pending',?)")
          .run(id,row.room_name,timestamp());
        audit(actor.id,'class.finished',id);
        return {id,status:'completed',replayed:false};
      });
    },
    async closeClassRoomProvider(actor,id,roomService){
      const row=classRow(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      if(!['cancelled','completed'].includes(row.status))throw error('CLASS_NOT_CLOSED',409);
      if(!roomService||typeof roomService.deleteRoom!=='function')throw error('LIVEKIT_ROOM_SERVICE_NOT_CONFIGURED',503);
      // Closing the provider room is best-effort, with durable retry on network failure.
      // Existing signed tokens may remain valid for their remaining TTL.
      await roomService.deleteRoom(row.room_name);
      return transaction(()=>{
        db.prepare("UPDATE learning_room_closures SET state='done',attempts=attempts+1,updated_at=? WHERE class_id=? AND state='pending'")
          .run(timestamp(),id);
        audit(actor.id,'class.room.provider_close.confirmed',id);
        return {providerClosed:true};
      });
    },
    // Only a trusted server worker can drain this durable outbox using Week 1 RoomService.
    async drainRoomClosures(actor,roomService){
      if(!actor||actor.role!=='admin'||actor.suspended)throw error('ADMIN_REQUIRED',403);
      if(!roomService||typeof roomService.deleteRoom!=='function')throw error('LIVEKIT_ROOM_SERVICE_NOT_CONFIGURED',503);
      const jobs=db.prepare("SELECT class_id,room_name FROM learning_room_closures WHERE state='pending' ORDER BY updated_at LIMIT 20").all();
      let completed=0,failed=0;
      for(const job of jobs){
        try{
          await roomService.deleteRoom(job.room_name);
          transaction(()=>{
            db.prepare("UPDATE learning_room_closures SET state='done',attempts=attempts+1,updated_at=? WHERE class_id=? AND state='pending'")
              .run(timestamp(),job.class_id);
            audit(actor.id,'class.room.provider_close.confirmed',job.class_id);
          });
          completed++;
        }catch{
          db.prepare("UPDATE learning_room_closures SET attempts=attempts+1,updated_at=? WHERE class_id=?")
            .run(timestamp(),job.class_id);
          failed++;
        }
      }
      return {completed,failed,remaining:db.prepare("SELECT count(*) AS n FROM learning_room_closures WHERE state='pending'").get().n};
    },
    cancelClass(actor,id,reason){
      const row=classRow(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      const explanation=valText(reason,8,500,error,'INVALID_REASON');
      return transaction(()=>{
        const status=db.prepare('SELECT status,reason FROM interactive_classes WHERE id=?').get(id);
        if(status.status==='cancelled'){
          if(status.reason!==explanation)throw error('CLASS_CLOSED',409);
          return {id,status:'cancelled',replayed:true};
        }
        if(status.status==='completed')throw error('CLASS_CLOSED',409);
        db.prepare("UPDATE interactive_classes SET status='cancelled',reason=?,updated_at=? WHERE id=?").run(explanation,timestamp(),id);
        db.prepare("INSERT OR IGNORE INTO learning_room_closures(class_id,room_name,state,updated_at) VALUES(?,?,'pending',?)")
          .run(id,row.room_name,timestamp());
        const enrolled=db.prepare("SELECT student_id FROM interactive_class_enrollments WHERE class_id=? AND status='enrolled'").all(id);
        for(const participant of enrolled){
          notice(participant.student_id,'class_cancelled',id,'The creator cancelled this class. Check your enrollment for next steps.');
          if(row.price_kobo>0)refund('class',id,participant.student_id,'Cancelled paid class: financial review required.');
        }
        audit(actor.id,'class.cancelled',id,{refundReviews:row.price_kobo>0?enrolled.length:0});
        return {id,status:'cancelled',refundReviews:row.price_kobo>0?enrolled.length:0,replayed:false};
      });
    },
    roomGrant(actor,id){
      const row=classRow(actor,id);
      if(row.status!=='room_open'||now()>Date.parse(row.ends_at)||now()<Date.parse(row.starts_at)-15*60000)throw error('CLASS_NOT_LIVE',409);
      const host=row.host_id===actor.id;
      if(!host&&!member(actor,id))throw error('NOT_ENROLLED',403);
      if(!host&&row.price_kobo>0&&!paid(actor,'class',id))throw error('PAYMENT_ENTITLEMENT_REQUIRED',402);
      return {room:row.room_name,identity:'student-'+actor.id,role:host?'host':'participant'};
    },
    async roomToken(actor,id,issuer){
      // A fresh server check is required for every connect/reconnect attempt.
      const grant=this.roomGrant(actor,id);
      if(!issuer||typeof issuer.issue!=='function')throw error('LIVEKIT_NOT_CONFIGURED',503);
      const result=await issuer.issue(grant);
      if(!result||typeof result.token!=='string'||typeof result.url!=='string')throw error('LIVEKIT_NOT_CONFIGURED',503);
      audit(actor.id,'class.room.token.issued',id,{role:grant.role});
      return {...result,role:grant.role,classId:id};
    },
    async recordVerifiedPresence(event){
      // Preexisting test-only provider adapter: never exposed as a browser route.
      if(!providerPresenceVerifier||typeof providerPresenceVerifier.verify!=='function'||!(await providerPresenceVerifier.verify(event)))
        throw error('LIVEKIT_WEBHOOK_UNVERIFIED',403);
      return this.persistProviderPresence(event);
    },
    persistProviderPresence(event){
      // Called only by trusted server code after a signed provider event is validated.
      const {eventId,classId,userId,kind}=event??{};
      if(typeof eventId!=='string'||eventId.length<8||eventId.length>128||
         !/^[A-Za-z0-9_-]+$/.test(eventId)||typeof classId!=='string'||!uuid.test(classId)||
         typeof userId!=='string'||!uuid.test(userId)||!['joined','left'].includes(kind))
        throw error('INVALID_PRESENCE_EVENT',422);
      const cls=db.prepare('SELECT c.status,c.host_id,c.price_kobo,s.institution_id FROM interactive_classes c JOIN courses s ON s.id=c.course_id WHERE c.id=?').get(classId);
      if(!cls||cls.status!=='room_open')throw error('CLASS_NOT_LIVE',409);
      const user=db.prepare('SELECT institution_id,verified_at,suspended FROM users WHERE id=? AND role=\'student\'').get(userId);
      if(!user||!user.verified_at||user.suspended||user.institution_id!==cls.institution_id)
        throw error('VERIFICATION_REQUIRED',403);
      if(userId!==cls.host_id){
        if(!db.prepare("SELECT 1 FROM interactive_class_enrollments WHERE class_id=? AND student_id=? AND status='enrolled'").get(classId,userId))
          throw error('NOT_ENROLLED',403);
        if(kind==='joined'&&cls.price_kobo>0&&!paid({id:userId},'class',classId))
          throw error('PAYMENT_ENTITLEMENT_REQUIRED',402);
        if(kind==='joined'&&db.prepare('SELECT 1 FROM creator_restrictions WHERE creator_id=? AND viewer_id=? AND deny_view=1').get(cls.host_id,userId))
          throw error('CREATOR_ACCESS_RESTRICTED',403);
      }
      return transaction(()=>{
        const changed=db.prepare('INSERT OR IGNORE INTO interactive_class_presence(provider_event_id,class_id,student_id,kind,created_at) VALUES(?,?,?,?,?)')
          .run(eventId,classId,userId,kind,timestamp()).changes;
        if(changed)audit(userId,'class.presence.'+kind,classId);
        return {recorded:Boolean(changed),replayed:!changed};
      });
    },
    async recordSignedLiveKitWebhook(rawBody,authorization,roomService){
      if(!roomService||typeof roomService.verifyWebhook!=='function')
        throw error('LIVEKIT_NOT_CONFIGURED',503);
      // Must authenticate exact raw bytes and JWT sha256 BEFORE any JSON fields are trusted.
      const event=roomService.verifyWebhook(rawBody,authorization);
      if(!['participant_joined','participant_left'].includes(event.event))
        return {accepted:true,ignored:true};
      const room=event.room?.name,identity=event.participant?.identity;
      if(typeof room!=='string'||!/^wk-class-[0-9a-f-]{36}$/i.test(room)||
         typeof identity!=='string'||!/^student-[0-9a-f-]{36}$/i.test(identity))
        return {accepted:true,ignored:true};
      const result=this.persistProviderPresence({
        eventId:event.id,classId:room.slice('wk-class-'.length),
        userId:identity.slice('student-'.length),kind:event.event==='participant_joined'?'joined':'left'
      });
      return {accepted:true,...result};
    },
    classAttendance(actor,id){
      const row=classRow(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      return db.prepare("SELECT student_id AS studentId,COUNT(*) AS providerEvents,MIN(created_at) AS firstObservedAt FROM interactive_class_presence WHERE class_id=? AND kind='joined' GROUP BY student_id ORDER BY firstObservedAt")
        .all(id);
    },
    setAvailability(actor,slots){
      requireVerified(actor);
      if(!Array.isArray(slots)||slots.length>14)throw error('INVALID_AVAILABILITY',422);
      const normalized=slots.map(s=>{
        if(!s||!Number.isInteger(s.day)||s.day<0||s.day>6||typeof s.start!=='string'||typeof s.end!=='string'||
          !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s.start)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s.end)||s.start>=s.end||
          Object.keys(s).sort().join(',')!=='day,end,start')throw error('INVALID_AVAILABILITY',422);
        return {day:s.day,start:s.start,end:s.end};
      }).sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start));
      if(normalized.some((s,i)=>i>0&&s.day===normalized[i-1].day&&s.start<normalized[i-1].end))throw error('INVALID_AVAILABILITY',422);
      return transaction(()=>{
        db.prepare('INSERT INTO creator_availability(creator_id,slots_json,updated_at) VALUES(?,?,?) ON CONFLICT(creator_id) DO UPDATE SET slots_json=excluded.slots_json,updated_at=excluded.updated_at')
          .run(actor.id,JSON.stringify(normalized),timestamp());
        audit(actor.id,'creator.availability.updated',actor.id);
        return {creatorId:actor.id,slots:normalized};
      });
    },
    availability(actor,creatorId){
      requireVerified(actor);
      if(actor.id!==creatorId)requireCreatorAction(actor,creatorId,'message');
      const owner=db.prepare("SELECT id,institution_id FROM users WHERE id=? AND role='student' AND verified_at IS NOT NULL AND suspended=0").get(creatorId);
      if(!owner||owner.institution_id!==actor.institutionId)throw error('CREATOR_UNAVAILABLE',404);
      return {creatorId,slots:JSON.parse(db.prepare('SELECT slots_json FROM creator_availability WHERE creator_id=?').get(creatorId)?.slots_json??'[]')};
    },
    requestHelp(actor,input={}){
      requireVerified(actor);
      requireKey(input.creationKey,error);
      if(typeof input.creatorId!=='string'||input.creatorId===actor.id)throw error('INVALID_CREATOR',422);
      requireCreatorAction(actor,input.creatorId,'message');
      this.availability(actor,input.creatorId);
      if(!['tutoring','assignment_explanation','project_guidance'].includes(input.kind))throw error('INVALID_HELP_KIND',422);
      const description=valText(input.description,20,2000,error,'INVALID_HELP_REQUEST');
      if(input.integrityAttested!==true||badWork.test(description))throw error('ACADEMIC_INTEGRITY_REQUIRED',422);
      const budget=amount(input.budgetKobo??null,error,true);
      return transaction(()=>{
        const old=db.prepare('SELECT * FROM learning_requests WHERE student_id=? AND creation_key=?').get(actor.id,input.creationKey);
        if(old){
          if(old.creator_id!==input.creatorId||old.kind!==input.kind||old.description!==description||old.budget_kobo!==budget)
            throw error('IDEMPOTENCY_CONFLICT',409);
          return {...rowService(old),replayed:true};
        }
        const since=new Date(now()-86400000).toISOString();
        if(db.prepare('SELECT count(*) AS n FROM learning_requests WHERE student_id=? AND created_at>?').get(actor.id,since).n>=20)
          throw error('REQUEST_RATE_LIMIT',429);
        const id=randomUUID(),date=timestamp();
        db.prepare("INSERT INTO learning_requests(id,student_id,creator_id,kind,description,budget_kobo,status,creation_key,created_at,updated_at) VALUES(?,?,?,?,?,?,'requested',?,?,?)")
          .run(id,actor.id,input.creatorId,input.kind,description,budget,input.creationKey,date,date);
        notice(input.creatorId,'help_requested',id,'A student requested learning guidance.');
        audit(actor.id,'help.requested',id,{kind:input.kind});
        return {id,studentId:actor.id,creatorId:input.creatorId,kind:input.kind,description,budgetKobo:budget,quoteKobo:null,currency:'NGN',status:'requested',replayed:false};
      });
    },
    myHelp(actor){
      requireVerified(actor);
      return db.prepare('SELECT * FROM learning_requests WHERE student_id=? OR creator_id=? ORDER BY created_at DESC LIMIT 100')
        .all(actor.id,actor.id).map(rowService);
    },
    helpDetail(actor,id){return rowService(requestRow(actor,id));},
    quoteHelp(actor,id,quoteKobo){
      const row=requestRow(actor,id);
      if(row.creator_id!==actor.id)throw error('FORBIDDEN',403);
      const quote=amount(quoteKobo,error);
      if(quote>0&&quote<20000)throw error('BELOW_MINIMUM_PRICE',422);
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(!['requested','quoted'].includes(r.status))throw error('HELP_CLOSED',409);
        if(r.status==='quoted'&&r.quote_kobo===quote)return {...rowService(r),replayed:true};
        db.prepare("UPDATE learning_requests SET status='quoted',quote_kobo=?,updated_at=? WHERE id=?").run(quote,timestamp(),id);
        notice(row.student_id,'help_quoted',id,'The creator sent a proposed tutoring price. Review before accepting.');
        audit(actor.id,'help.quoted',id,{quoteKobo:quote});
        return {...rowService({...r,quote_kobo:quote,status:'quoted'}),replayed:false};
      });
    },
    acceptHelp(actor,id,expectedQuoteKobo){
      const row=requestRow(actor,id);
      if(row.student_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(r.status==='accepted'&&r.quote_kobo===expectedQuoteKobo)return {...rowService(r),replayed:true};
        if(r.status!=='quoted'||r.quote_kobo!==expectedQuoteKobo)throw error('QUOTE_CHANGED',409);
        requireCreatorAction(actor,r.creator_id,'message');
        db.prepare("UPDATE learning_requests SET status='accepted',updated_at=? WHERE id=?").run(timestamp(),id);
        notice(r.creator_id,'help_accepted',id,'A student accepted your proposed learning service price.');
        audit(actor.id,'help.accepted',id,{quoteKobo:r.quote_kobo});
        return {...rowService({...r,status:'accepted'}),replayed:false,paymentRequired:r.quote_kobo>0};
      });
    },
    rejectHelp(actor,id,reason){
      const row=requestRow(actor,id);
      if(row.creator_id!==actor.id)throw error('FORBIDDEN',403);
      valText(reason,5,500,error,'INVALID_REASON');
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(r.status==='rejected')return {...rowService(r),replayed:true};
        if(!['requested','quoted'].includes(r.status))throw error('HELP_CLOSED',409);
        db.prepare("UPDATE learning_requests SET status='rejected',updated_at=? WHERE id=?").run(timestamp(),id);
        notice(r.student_id,'help_rejected',id,'The creator declined the assistance request.');
        audit(actor.id,'help.rejected',id);
        return {...rowService({...r,status:'rejected'}),replayed:false};
      });
    },
    startHelp(actor,id){
      const row=requestRow(actor,id);
      if(row.creator_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(r.status==='in_progress')return {...rowService(r),replayed:true};
        if(r.status!=='accepted')throw error('HELP_CLOSED',409);
        if(r.quote_kobo>0&&!paid({id:r.student_id},'service',id))throw error('PAYMENT_ENTITLEMENT_REQUIRED',402);
        db.prepare("UPDATE learning_requests SET status='in_progress',updated_at=? WHERE id=?").run(timestamp(),id);
        notice(r.student_id,'help_started',id,'Your learning service has started.');
        audit(actor.id,'help.started',id);
        return {...rowService({...r,status:'in_progress'}),replayed:false};
      });
    },
    submitHelp(actor,id){
      const row=requestRow(actor,id);
      if(row.creator_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(r.status==='submitted')return {...rowService(r),replayed:true};
        if(r.status!=='in_progress')throw error('HELP_CLOSED',409);
        // A refunded/revoked service entitlement must not remain executable.
        if(r.quote_kobo>0&&!paid({id:r.student_id},'service',id))throw error('PAYMENT_ENTITLEMENT_REQUIRED',402);
        db.prepare("UPDATE learning_requests SET status='submitted',updated_at=? WHERE id=?").run(timestamp(),id);
        notice(r.student_id,'help_submitted',id,'The creator marked guidance ready for your review.');
        audit(actor.id,'help.submitted',id);
        return {...rowService({...r,status:'submitted'}),replayed:false};
      });
    },
    confirmHelp(actor,id){
      const row=requestRow(actor,id);
      if(row.student_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(r.status==='completed')return {...rowService(r),replayed:true};
        if(r.status!=='submitted')throw error('HELP_CLOSED',409);
        db.prepare("UPDATE learning_requests SET status='completed',updated_at=? WHERE id=?").run(timestamp(),id);
        notice(r.creator_id,'help_completed',id,'The student confirmed this learning service is complete.');
        audit(actor.id,'help.completed',id);
        return {...rowService({...r,status:'completed'}),replayed:false};
      });
    },
    cancelHelp(actor,id,reason){
      const row=requestRow(actor,id),explanation=valText(reason,8,500,error,'INVALID_REASON');
      return transaction(()=>{
        const current=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(current.status==='cancelled')return {...rowService(current),replayed:true};
        if(['completed','disputed','rejected'].includes(current.status))throw error('HELP_CLOSED',409);
        if(!['requested','quoted','accepted','in_progress','submitted'].includes(current.status))throw error('HELP_CLOSED',409);
        db.prepare("UPDATE learning_requests SET status='cancelled',updated_at=? WHERE id=?").run(timestamp(),id);
        const other=row.student_id===actor.id?row.creator_id:row.student_id;
        notice(other,'help_cancelled',id,'The personalized learning service was cancelled.');
        if(current.quote_kobo>0&&['accepted','in_progress','submitted'].includes(current.status))
          refund('service',id,row.student_id,'Cancelled accepted paid service: financial operator review required.');
        audit(actor.id,'help.cancelled',id,{reason:explanation});
        return {...rowService({...current,status:'cancelled'}),replayed:false,refundReviewRequested:current.quote_kobo>0&&['accepted','in_progress','submitted'].includes(current.status)};
      });
    },
    disputeHelp(actor,id,reason){
      const row=requestRow(actor,id);
      const explanation=valText(reason,10,1000,error,'INVALID_REASON');
      return transaction(()=>{
        const r=db.prepare('SELECT * FROM learning_requests WHERE id=?').get(id);
        if(!['accepted','in_progress','submitted','completed','disputed'].includes(r.status))throw error('HELP_CLOSED',409);
        const previous=db.prepare("SELECT id FROM learning_disputes WHERE request_id=? AND reporter_id=? AND status='open'").get(id,actor.id);
        if(previous)return {id:previous.id,requestId:id,status:'open',replayed:true};
        const caseId=randomUUID();
        db.prepare('INSERT INTO learning_disputes(id,request_id,reporter_id,reason,status,created_at) VALUES(?,?,?,?,?,?)')
          .run(caseId,id,actor.id,explanation,'open',timestamp());
        db.prepare("UPDATE learning_requests SET status='disputed',updated_at=? WHERE id=?").run(timestamp(),id);
        if(r.quote_kobo>0)refund('service',id,r.student_id,'Personalized service dispute: payment/refund review required.');
        notice(r.creator_id===actor.id?r.student_id:r.creator_id,'help_disputed',id,'A service dispute requires review.');
        audit(actor.id,'help.disputed',id);
        return {id:caseId,requestId:id,status:'open',replayed:false};
      });
    },
    resolveHelpDispute(actor,id,{resolution}={}){
      if(!actor||actor.role!=='admin'||actor.suspended)throw error('ADMIN_REQUIRED',403);
      const note=valText(resolution,10,1000,error,'INVALID_REASON');
      return transaction(()=>{
        const row=db.prepare("SELECT request_id,reporter_id FROM learning_disputes WHERE id=? AND status='open'").get(id);
        if(!row)throw error('DISPUTE_NOT_FOUND',404);
        db.prepare("UPDATE learning_disputes SET status='resolved',resolution=?,reviewed_at=?,reviewed_by=? WHERE id=?")
          .run(note,timestamp(),actor.id,id);
        notice(row.reporter_id,'help_dispute_reviewed',row.request_id,'The service dispute was reviewed. Financial action is separate.');
        audit(actor.id,'help.dispute.reviewed',id);
        return {id,status:'resolved',financialAction:false};
      });
    },
    disputesForReview(actor){
      if(!actor||actor.role!=='admin'||actor.suspended)throw error('ADMIN_REQUIRED',403);
      return db.prepare("SELECT id,request_id AS requestId,reporter_id AS reporterId,reason,created_at AS createdAt FROM learning_disputes WHERE status='open' ORDER BY created_at LIMIT 100").all();
    },
    refundReviews(actor){
      if(!actor||actor.role!=='admin'||actor.suspended)throw error('ADMIN_REQUIRED',403);
      return db.prepare("SELECT id,resource_kind AS resourceKind,resource_id AS resourceId,student_id AS studentId,reason,status,created_at AS createdAt FROM learning_refund_reviews WHERE status='pending_review' ORDER BY created_at LIMIT 100").all();
    },
    notifications(actor){
      requireVerified(actor);
      // Locally queue only this student's upcoming class reminders on their
      // own dashboard visit. A recurring host worker is needed for offline email/push.
      const startingSoon=db.prepare("SELECT c.id FROM interactive_classes c JOIN interactive_class_enrollments e ON e.class_id=c.id WHERE e.student_id=? AND e.status='enrolled' AND c.status='scheduled' AND c.starts_at>=? AND c.starts_at<=? LIMIT 100")
        .all(actor.id,new Date(now()).toISOString(),new Date(now()+3600000).toISOString());
      transaction(()=>{
        for(const c of startingSoon)notice(actor.id,'class_reminder',c.id,'Your class starts within an hour.');
      });
      return db.prepare('SELECT id,kind,resource_id AS resourceId,body,created_at AS createdAt,seen_at AS seenAt FROM learning_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(actor.id);
    },
    markNoticeSeen(actor,id){
      requireVerified(actor);
      const n=db.prepare('UPDATE learning_notifications SET seen_at=COALESCE(seen_at,?) WHERE id=? AND user_id=?')
        .run(timestamp(),id,actor.id);
      if(!n.changes)throw error('NOTIFICATION_NOT_FOUND',404);
      return {id,seen:true};
    },
    queueClassReminders(actor){
      // Local durable outbox only: Week 1 email/push worker will deliver after consent.
      if(!actor||actor.role!=='admin'||actor.suspended)throw error('ADMIN_REQUIRED',403);
      const due=db.prepare("SELECT c.id,c.host_id,e.student_id FROM interactive_classes c JOIN interactive_class_enrollments e ON e.class_id=c.id WHERE e.status='enrolled' AND c.status='scheduled' AND c.starts_at>=? AND c.starts_at<=?")
        .all(new Date(now()).toISOString(),new Date(now()+3600000).toISOString());
      return transaction(()=>{
        for(const item of due)notice(item.student_id,'class_reminder',item.id,'Your class is scheduled to begin within an hour.');
        return {queued:due.length,deliveryConfigured:false};
      });
    }
  };
}
