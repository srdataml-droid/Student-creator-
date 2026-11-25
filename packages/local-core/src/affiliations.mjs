/** Local-only institution registry. No real connector is activated here.
 * Stores pseudonymous HMAC subject digests and revocation/appeal decisions,
 * never raw IDs, identity images, issuer secrets or roster PII.
 */
import {randomUUID} from 'node:crypto';
import {isVerifiedInstitutionEvidence,validateInstitutionRegistryEntry} from '../../identity-core/src/institutions.mjs';

export function createLocalAffiliations({db,transaction,audit,error,requireAdmin}){
 db.exec([
  "CREATE TABLE IF NOT EXISTS institution_integrations(provider_id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),kind TEXT NOT NULL CHECK(kind IN ('synthetic','rest','oidc','saml','roster')),issuer TEXT NOT NULL,audience TEXT NOT NULL,endpoint TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),approved_by TEXT REFERENCES users(id),approved_at TEXT,created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS institution_affiliations(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,institution_id TEXT NOT NULL REFERENCES institutions(id),provider_id TEXT NOT NULL REFERENCES institution_integrations(provider_id),subject_digest TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('student','alumni','lecturer')),state TEXT NOT NULL CHECK(state IN ('active','suspended','graduated','inactive')),valid_until INTEGER NOT NULL,verified_at TEXT NOT NULL,UNIQUE(provider_id,subject_digest));",
  "CREATE INDEX IF NOT EXISTS affiliations_due ON institution_affiliations(provider_id,valid_until);",
  "CREATE TABLE IF NOT EXISTS institutional_proof_receipts(provider_id TEXT NOT NULL REFERENCES institution_integrations(provider_id),request_id TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(provider_id,request_id));",
  "CREATE INDEX IF NOT EXISTS institutional_proof_receipts_expiry ON institutional_proof_receipts(expires_at);",
  "CREATE TABLE IF NOT EXISTS verification_appeals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review_requested','rejected')),created_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id),reviewed_at TEXT,review_note TEXT);"
 ].join('\n'));
 if(!db.prepare('PRAGMA table_info(institution_affiliations)').all().some(c=>c.name==='last_issued_at')){
  db.exec("ALTER TABLE institution_affiliations ADD COLUMN last_issued_at INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE institution_affiliations SET last_issued_at=COALESCE(CAST(strftime('%s',verified_at) AS INTEGER),0)");
 }
 const now=()=>new Date().toISOString();
 const publicRegistry=r=>r?{providerId:r.provider_id,institutionId:r.institution_id,kind:r.kind,
  issuer:r.issuer,audience:r.audience,endpoint:r.endpoint,enabled:Boolean(r.enabled)}:null;
 function getIntegration(actor,providerId){
  requireAdmin(actor);
  return publicRegistry(db.prepare('SELECT * FROM institution_integrations WHERE provider_id=?').get(providerId));
 }
 function add(actor,entry){
  requireAdmin(actor);
  const clean=validateInstitutionRegistryEntry(entry);
  return transaction(()=>{
   if(!db.prepare('SELECT 1 FROM institutions WHERE id=?').get(clean.institutionId))throw error('INSTITUTION_NOT_FOUND',404);
   if(db.prepare('SELECT 1 FROM institution_integrations WHERE provider_id=?').get(clean.providerId))throw error('INTEGRATION_EXISTS',409);
   db.prepare('INSERT INTO institution_integrations(provider_id,institution_id,kind,issuer,audience,endpoint,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(clean.providerId,clean.institutionId,clean.kind,clean.issuer,clean.audience,clean.endpoint,now());
   audit(actor.id,'institution.integration.configured',clean.institutionId,{kind:clean.kind,providerId:clean.providerId});
   return {...clean,enabled:false};
  });
 }
 function activateSynthetic(actor,providerId){
  requireAdmin(actor);
  return transaction(()=>{
   const row=db.prepare('SELECT * FROM institution_integrations WHERE provider_id=?').get(providerId);
   if(!row)throw error('INTEGRATION_NOT_FOUND',404);
   if(row.kind!=='synthetic')throw error('INSTITUTION_AUTHORIZATION_REQUIRED',403);
   db.prepare('UPDATE institution_integrations SET enabled=1,approved_by=?,approved_at=? WHERE provider_id=?')
    .run(actor.id,now(),providerId);
   audit(actor.id,'institution.synthetic.enabled',row.institution_id,{providerId});
   return {...publicRegistry({...row,enabled:1}),enabled:true};
  });
 }
 function disable(actor,providerId){
  requireAdmin(actor);
  return transaction(()=>{
   const row=db.prepare('SELECT * FROM institution_integrations WHERE provider_id=?').get(providerId);
   if(!row)throw error('INTEGRATION_NOT_FOUND',404);
   db.prepare('UPDATE institution_integrations SET enabled=0 WHERE provider_id=?').run(providerId);
   const cutoff=Math.floor(Date.now()/1000);
   db.prepare('UPDATE institution_affiliations SET valid_until=MIN(valid_until,?),last_issued_at=MAX(last_issued_at,?) WHERE provider_id=?').run(cutoff,cutoff,providerId);
   db.prepare('DELETE FROM playback_grants WHERE user_id IN (SELECT user_id FROM institution_affiliations WHERE provider_id=?) OR lesson_id IN (SELECT l.id FROM lessons l JOIN institution_affiliations a ON a.user_id=l.creator_id WHERE a.provider_id=?)').run(providerId,providerId);
   audit(actor.id,'institution.integration.disabled',row.institution_id,{providerId});
   return {...publicRegistry({...row,enabled:0}),enabled:false};
  });
 }
 function eligible(userId){
  const r=db.prepare('SELECT a.role,a.state,a.valid_until,i.enabled FROM institution_affiliations a JOIN institution_integrations i ON i.provider_id=a.provider_id WHERE a.user_id=?').get(userId);
  if(!r)return true; // existing manually reviewed student without an institutional connection
  return r.role==='student'&&r.state==='active'&&Boolean(r.enabled)&&r.valid_until>Math.floor(Date.now()/1000);
 }
 function record(actor,userId,evidence){
  requireAdmin(actor);
  if(!isVerifiedInstitutionEvidence(evidence))throw error('UNVERIFIED_INSTITUTION_EVIDENCE',403);
  if(evidence.expiresAt<=Math.floor(Date.now()/1000))throw error('EXPIRED_INSTITUTION_EVIDENCE',403);
  return transaction(()=>{
   const target=db.prepare('SELECT id,role,institution_id FROM users WHERE id=?').get(userId);
   if(!target||target.role!=='student')throw error('STUDENT_NOT_FOUND',404);
   if(target.institution_id!==evidence.institutionId)throw error('INSTITUTION_MISMATCH',403);
   const entry=db.prepare('SELECT * FROM institution_integrations WHERE provider_id=?').get(evidence.providerId);
   if(!entry||!entry.enabled||entry.institution_id!==evidence.institutionId)
    throw error('INSTITUTION_AUTHORIZATION_REQUIRED',403);
   const claimed=db.prepare('SELECT user_id FROM institution_affiliations WHERE provider_id=? AND subject_digest=?')
    .get(evidence.providerId,evidence.subjectDigest);
   if(claimed&&claimed.user_id!==userId)throw error('DUPLICATE_INSTITUTIONAL_IDENTITY',409);
   const existing=db.prepare('SELECT * FROM institution_affiliations WHERE user_id=?').get(userId);
   if(existing&&(existing.provider_id!==evidence.providerId||existing.subject_digest!==evidence.subjectDigest))
    throw error('IDENTITY_REASSIGNMENT_REQUIRES_APPEAL',409);
   const seconds=Math.floor(Date.now()/1000);
   // Consume a request only after scope/subject checks; receipts survive restarts.
   db.prepare('DELETE FROM institutional_proof_receipts WHERE expires_at<=?').run(seconds);
   if(db.prepare('SELECT 1 FROM institutional_proof_receipts WHERE provider_id=? AND request_id=?').get(evidence.providerId,evidence.requestId))throw error('INSTITUTION_PROOF_REPLAY',409);
   if(existing&&(evidence.issuedAt<existing.last_issued_at||
      (evidence.issuedAt===existing.last_issued_at&&evidence.eligible&&(!eligible(userId)))))throw error('STALE_INSTITUTION_PROOF',409);
   db.prepare('INSERT INTO institutional_proof_receipts(provider_id,request_id,expires_at) VALUES(?,?,?)').run(evidence.providerId,evidence.requestId,evidence.expiresAt);
   db.prepare('INSERT INTO institution_affiliations(user_id,institution_id,provider_id,subject_digest,role,state,valid_until,verified_at,last_issued_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,state=excluded.state,valid_until=excluded.valid_until,verified_at=excluded.verified_at,last_issued_at=excluded.last_issued_at')
    .run(userId,evidence.institutionId,evidence.providerId,evidence.subjectDigest,evidence.role,evidence.state,evidence.expiresAt,now(),evidence.issuedAt);
   if(!evidence.eligible)db.prepare('DELETE FROM playback_grants WHERE user_id=? OR lesson_id IN (SELECT id FROM lessons WHERE creator_id=?)').run(userId,userId);
   audit(actor.id,'institution.affiliation.checked',userId,{providerId:evidence.providerId,eligible:Boolean(evidence.eligible),role:evidence.role,state:evidence.state});
   return {userId,role:evidence.role,state:evidence.state,eligible:evidence.eligible,
    validUntil:evidence.expiresAt,requiresIndependentManualApproval:true};
  });
 }
 function status(actor,userId){
  if(!actor||(actor.id!==userId&&actor.role!=='admin'))throw error('FORBIDDEN',403);
  const r=db.prepare('SELECT role,state,valid_until,verified_at,provider_id FROM institution_affiliations WHERE user_id=?').get(userId);
  return r?{classification:r.role,state:r.state,validUntil:r.valid_until,lastCheckedAt:r.verified_at,
   providerId:r.provider_id,eligible:eligible(userId)}:{classification:'unconfirmed',state:'manual_fallback',eligible:false};
 }
 function due(actor,{withinSeconds=86400,limit=100}={}){
  requireAdmin(actor);
  if(!Number.isSafeInteger(withinSeconds)||withinSeconds<0||withinSeconds>604800||!Number.isSafeInteger(limit)||limit<1||limit>200)
   throw error('INVALID_REVALIDATION_QUERY',422);
  return db.prepare('SELECT user_id AS userId,provider_id AS providerId,valid_until AS validUntil FROM institution_affiliations WHERE valid_until<=? ORDER BY valid_until LIMIT ?')
   .all(Math.floor(Date.now()/1000)+withinSeconds,limit);
 }
 function appeal(actor,reason){
  if(!actor||actor.role!=='student')throw error('AUTH_REQUIRED',401);
  if(typeof reason!=='string'||reason.trim().length<20||reason.trim().length>800||
   /[\u0000-\u001f\u007f]/.test(reason))throw error('INVALID_APPEAL',422);
  return transaction(()=>{
   const open=db.prepare("SELECT id FROM verification_appeals WHERE user_id=? AND status='open'").get(actor.id);
   if(open)return {caseId:open.id,status:'open',replayed:true};
   const recent=db.prepare('SELECT count(*) AS n FROM verification_appeals WHERE user_id=? AND created_at>=?')
    .get(actor.id,new Date(Date.now()-30*86400000).toISOString()).n;
   if(recent>=3)throw error('APPEAL_RATE_LIMIT',429);
   const id=randomUUID();
   db.prepare('INSERT INTO verification_appeals(id,user_id,reason,created_at) VALUES(?,?,?,?)')
    .run(id,actor.id,reason.trim(),now());
   audit(actor.id,'institution.appeal.created',id);
   return {caseId:id,status:'open',replayed:false};
  });
 }
 function appeals(actor){
  if(!actor)throw error('AUTH_REQUIRED',401);
  return db.prepare('SELECT id AS caseId,status,created_at AS createdAt FROM verification_appeals WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(actor.id);
 }
 function appealQueue(actor){
  requireAdmin(actor);
  // Operator-only bounded queue: no raw institutional evidence or identifiers.
  return db.prepare("SELECT id AS caseId,user_id AS userId,reason,created_at AS createdAt FROM verification_appeals WHERE status='open' ORDER BY created_at,id LIMIT 100").all();
 }
 function reviewAppeal(actor,id,{decision,note}={}){
  requireAdmin(actor);
  if(!['review_requested','rejected'].includes(decision)||typeof note!=='string'||note.trim().length<10||note.length>500)
   throw error('INVALID_APPEAL_DECISION',422);
  return transaction(()=>{
   const row=db.prepare("SELECT id FROM verification_appeals WHERE id=? AND status='open'").get(id);
   if(!row)throw error('APPEAL_NOT_FOUND',404);
   db.prepare('UPDATE verification_appeals SET status=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE id=?')
    .run(decision,actor.id,now(),note.trim(),id);
   // Case review alone NEVER changes eligibility, university proof or student role.
   audit(actor.id,'institution.appeal.reviewed',id,{decision});
   return {caseId:id,status:decision,eligibilityUnchanged:true};
  });
 }
 return Object.freeze({add,getIntegration,activateSynthetic,disable,eligible,record,status,due,appeal,appeals,appealQueue,reviewAppeal});
}
