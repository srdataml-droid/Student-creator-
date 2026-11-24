/** Local-only copyright and privacy request intake.
 * No binding legal terms, automatic refunds or real evidence uploads.
 * An operator can hide allegedly infringing content without altering the
 * payment engineer's entitlement and accounting records.
 */
import {randomUUID} from 'node:crypto';
const restricted=(error,c)=>{throw error(c,403);};

export function createLocalRightsCases({db,transaction,audit,error,requireAdmin,requireVerified}){
 db.exec([
  "CREATE TABLE IF NOT EXISTS copyright_cases(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id),reporter_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','taken_down')),created_at TEXT NOT NULL,resolved_at TEXT,reviewer_id TEXT REFERENCES users(id),review_note TEXT);",
  "CREATE INDEX IF NOT EXISTS copyright_cases_queue ON copyright_cases(status,created_at);",
  "CREATE TABLE IF NOT EXISTS copyright_appeals(case_id TEXT PRIMARY KEY REFERENCES copyright_cases(id),creator_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','further_review')),created_at TEXT NOT NULL,reviewed_at TEXT,review_note TEXT);",
  "CREATE TABLE IF NOT EXISTS privacy_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('account_deletion','verification_evidence_deletion')),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review_required')),created_at TEXT NOT NULL,UNIQUE(user_id,kind));"
 ].join('\n'));
 // Additive local migrations retain case data from previously created databases.
 if(!db.prepare('PRAGMA table_info(privacy_requests)').all().some(col=>col.name==='reviewed_by'))
   db.exec('ALTER TABLE privacy_requests ADD COLUMN reviewed_by TEXT REFERENCES users(id)');
 if(!db.prepare('PRAGMA table_info(privacy_requests)').all().some(col=>col.name==='reviewed_at'))
   db.exec('ALTER TABLE privacy_requests ADD COLUMN reviewed_at TEXT');
 if(!db.prepare('PRAGMA table_info(privacy_requests)').all().some(col=>col.name==='review_note'))
   db.exec('ALTER TABLE privacy_requests ADD COLUMN review_note TEXT');
 if(!db.prepare('PRAGMA table_info(copyright_appeals)').all().some(col=>col.name==='reviewed_by'))
   db.exec('ALTER TABLE copyright_appeals ADD COLUMN reviewed_by TEXT REFERENCES users(id)');
 const stamp=()=>new Date().toISOString();
 function text(value,min,max){
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||
   /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw error('INVALID_RIGHTS_REQUEST',422);
  return value.trim();
 }
 function copyrightClaim(actor,lessonId,reason){
  requireVerified(actor);
  const statement=text(reason,30,1000);
  return transaction(()=>{
   const target=db.prepare("SELECT id,creator_id,status FROM lessons WHERE id=? AND status='published'").get(lessonId);
   if(!target)throw error('LESSON_NOT_FOUND',404);
   const existing=db.prepare("SELECT id FROM copyright_cases WHERE lesson_id=? AND reporter_id=? AND status='open'").get(lessonId,actor.id);
   if(existing)return {caseId:existing.id,status:'open',replayed:true};
   const monthly=db.prepare('SELECT count(*) AS n FROM copyright_cases WHERE reporter_id=? AND created_at>=?')
    .get(actor.id,new Date(Date.now()-30*86400000).toISOString()).n;
   if(monthly>=3)throw error('RIGHTS_CASE_RATE_LIMIT',429);
   const id=randomUUID();
   db.prepare('INSERT INTO copyright_cases(id,lesson_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)')
    .run(id,lessonId,actor.id,statement,stamp());
   audit(actor.id,'copyright.claim.submitted',id,{lessonId});
   return {caseId:id,status:'open',replayed:false};
  });
 }
 function myClaims(actor){
  if(!actor)throw error('AUTH_REQUIRED',401);
  return db.prepare('SELECT id AS caseId,lesson_id AS lessonId,status,created_at AS createdAt FROM copyright_cases WHERE reporter_id=? ORDER BY created_at DESC LIMIT 50').all(actor.id);
 }
 function queue(actor){
  requireAdmin(actor);
  return db.prepare("SELECT id AS caseId,lesson_id AS lessonId,reporter_id AS reporterId,reason,created_at AS createdAt FROM copyright_cases WHERE status='open' ORDER BY created_at LIMIT 100").all();
 }
 function resolve(actor,id,{decision,note}={}){
  requireAdmin(actor);
  if(!['dismiss','take_down'].includes(decision))throw error('INVALID_RIGHTS_DECISION',422);
  const explanation=text(note,15,600);
  return transaction(()=>{
   const row=db.prepare("SELECT lesson_id FROM copyright_cases WHERE id=? AND status='open'").get(id);
   if(!row)throw error('RIGHTS_CASE_NOT_FOUND',404);
   const state=decision==='take_down'?'taken_down':'dismissed';
   db.prepare('UPDATE copyright_cases SET status=?,resolved_at=?,reviewer_id=?,review_note=? WHERE id=?')
    .run(state,stamp(),actor.id,explanation,id);
   if(decision==='take_down'){
    db.prepare("UPDATE lessons SET status='taken_down',updated_at=? WHERE id=? AND status='published'").run(stamp(),row.lesson_id);
    db.prepare('DELETE FROM playback_grants WHERE lesson_id=?').run(row.lesson_id);
   }
   audit(actor.id,'copyright.claim.reviewed',id,{decision,lessonId:row.lesson_id});
   // Never silently refund, revoke a monetary entitlement or reinstate media.
   return {caseId:id,status:state,financialReviewRequired:decision==='take_down'};
  });
 }
 function appeal(actor,id,reason){
  requireVerified(actor);
  const statement=text(reason,30,1000);
  return transaction(()=>{
   const row=db.prepare("SELECT c.id,l.creator_id FROM copyright_cases c JOIN lessons l ON l.id=c.lesson_id WHERE c.id=? AND c.status='taken_down'").get(id);
   if(!row||row.creator_id!==actor.id)throw error('RIGHTS_CASE_NOT_FOUND',404);
   const previous=db.prepare('SELECT case_id FROM copyright_appeals WHERE case_id=?').get(id);
   if(previous)return {caseId:id,status:'open',replayed:true};
   db.prepare('INSERT INTO copyright_appeals(case_id,creator_id,reason,created_at) VALUES(?,?,?,?)')
    .run(id,actor.id,statement,stamp());
   audit(actor.id,'copyright.claim.appealed',id);
   return {caseId:id,status:'open',replayed:false};
  });
 }
 function appealQueue(actor){
  requireAdmin(actor);
  return db.prepare("SELECT a.case_id AS caseId,a.creator_id AS creatorId,a.reason,a.status,a.created_at AS createdAt FROM copyright_appeals a WHERE a.status IN ('open','further_review') ORDER BY a.created_at ASC LIMIT 100").all();
 }
 function triageAppeal(actor,id,{decision,note}={}){
  requireAdmin(actor);
  if(decision!=='further_review')throw error('INVALID_RIGHTS_DECISION',422);
  const explanation=text(note,15,600);
  return transaction(()=>{
   const row=db.prepare('SELECT case_id,status,creator_id FROM copyright_appeals WHERE case_id=?').get(id);
   if(!row)throw error('COPYRIGHT_APPEAL_NOT_FOUND',404);
   if(row.creator_id===actor.id)restricted(error,'CONFLICT_OF_INTEREST');
   if(row.status==='further_review')return {caseId:id,status:'further_review',replayed:true,contentRestored:false};
   if(row.status!=='open')throw error('COPYRIGHT_APPEAL_CONFLICT',409);
   db.prepare("UPDATE copyright_appeals SET status='further_review',reviewed_at=?,reviewed_by=?,review_note=? WHERE case_id=? AND status='open'")
    .run(stamp(),actor.id,explanation,id);
   audit(actor.id,'copyright.appeal.escalated',id);
   // This is NOT a copyright policy decision: content remains hidden.
   return {caseId:id,status:'further_review',replayed:false,contentRestored:false};
  });
 }
 function requestPrivacyAction(actor,kind){
  if(!actor||actor.role!=='student')throw error('AUTH_REQUIRED',401);
  if(!['account_deletion','verification_evidence_deletion'].includes(kind))throw error('INVALID_PRIVACY_REQUEST',422);
  return transaction(()=>{
   const existing=db.prepare('SELECT id,status FROM privacy_requests WHERE user_id=? AND kind=?').get(actor.id,kind);
   if(existing)return {requestId:existing.id,status:existing.status,replayed:true};
   const id=randomUUID();
   db.prepare('INSERT INTO privacy_requests(id,user_id,kind,created_at) VALUES(?,?,?,?)').run(id,actor.id,kind,stamp());
   audit(actor.id,'privacy.request.submitted',id,{kind});
   return {requestId:id,status:'open',replayed:false,automaticallyDeleted:false};
  });
 }
 function myPrivacyRequests(actor){
  if(!actor)throw error('AUTH_REQUIRED',401);
  return db.prepare('SELECT id AS requestId,kind,status,created_at AS createdAt FROM privacy_requests WHERE user_id=? ORDER BY created_at DESC').all(actor.id);
 }
 function reviewPrivacyRequest(actor,id,{decision,note}={}){
  requireAdmin(actor);
  if(decision!=='request_review')throw error('INVALID_PRIVACY_DECISION',422);
  const explanation=text(note,15,600);
  return transaction(()=>{
   const row=db.prepare('SELECT status,user_id FROM privacy_requests WHERE id=?').get(id);
   if(!row)throw error('PRIVACY_REQUEST_NOT_FOUND',404);
   if(row.user_id===actor.id)restricted(error,'CONFLICT_OF_INTEREST');
   if(row.status==='review_required')return {requestId:id,status:'review_required',replayed:true,automaticallyDeleted:false};
   if(row.status!=='open')throw error('PRIVACY_REQUEST_CONFLICT',409);
   db.prepare("UPDATE privacy_requests SET status='review_required',reviewed_at=?,reviewed_by=?,review_note=? WHERE id=? AND status='open'")
    .run(stamp(),actor.id,explanation,id);
   audit(actor.id,'privacy.request.escalated',id);
   return {requestId:id,status:'review_required',replayed:false,automaticallyDeleted:false,policyApproved:false};
  });
 }
 function privacyQueue(actor){
  requireAdmin(actor);
  return db.prepare("SELECT id AS requestId,user_id AS userId,kind,status,created_at AS createdAt FROM privacy_requests WHERE status IN ('open','review_required') ORDER BY created_at LIMIT 100").all();
 }
 return Object.freeze({copyrightClaim,myClaims,queue,resolve,appeal,appealQueue,triageAppeal,requestPrivacyAction,myPrivacyRequests,privacyQueue,reviewPrivacyRequest});
}
