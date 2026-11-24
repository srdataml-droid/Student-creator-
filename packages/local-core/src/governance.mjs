/**
 * Local-only governance administration. This is an operational adapter for
 * the existing SQLite development server, NOT a Supabase/production policy.
 * Copyright, account suspension, appeals and financial settlements remain in
 * their respective domain modules. No raw identity docs/messages/ledger rows.
 */
import {randomUUID} from 'node:crypto';

export const GOVERNANCE_ROLES=Object.freeze({
  governance_owner:['staff.assign','dashboard.read','audit.read','verification.review','content.moderate','community.moderate','copyright.review','privacy.review','finance.review','incident.read','incident.write','retention.propose','retention.review'],
  verification_reviewer:['dashboard.read','verification.review'],
  content_moderator:['dashboard.read','content.moderate','community.moderate','copyright.review'],
  privacy_reviewer:['dashboard.read','privacy.review','retention.propose'],
  finance_reviewer:['dashboard.read','finance.review'],
  incident_responder:['dashboard.read','incident.read','incident.write'],
  auditor:['dashboard.read','audit.read','incident.read']
});
const DATASETS=new Set(['verification_evidence','login_sessions','analytics_events','user_reports','audit_events']);
const CATEGORIES=new Set(['unauthorized_access','account_compromise','suspected_fraud','availability','data_exposure','other']);
const SEVERITIES=new Set(['low','medium','high','critical']);
const VALID_REASONS=/^[^\u0000-\u001f\u007f]{10,1000}$/u;
const now=()=>new Date().toISOString();
const reason=(value,min=10,max=1000)=>{
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||
    /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.trim();
};
export function createLocalGovernance({db,transaction,audit,error}) {
  if(!db?.prepare||!transaction||!audit||!error)throw new TypeError('Missing governance dependencies');
  db.exec([
    "CREATE TABLE IF NOT EXISTS governance_role_grants(user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('governance_owner','verification_reviewer','content_moderator','privacy_reviewer','finance_reviewer','incident_responder','auditor')),granted_by TEXT REFERENCES users(id),granted_at TEXT NOT NULL,PRIMARY KEY(user_id,role));",
    "CREATE TABLE IF NOT EXISTS governance_incidents(id TEXT PRIMARY KEY,category TEXT NOT NULL,severity TEXT NOT NULL,summary TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','investigating','contained','resolved')),reporter_id TEXT NOT NULL REFERENCES users(id),last_actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS governance_incident_queue ON governance_incidents(state,created_at);",
    "CREATE TABLE IF NOT EXISTS governance_retention_proposals(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 3650),rationale TEXT NOT NULL,proposed_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','rejected')),reviewed_by TEXT REFERENCES users(id),reviewed_at TEXT);"
  ].join('\n'));
  // Existing audit inserts are already synchronous; prevent silent rewriting
  // through application SQL. A DB owner can still change triggers: separate
  // backups and externally anchored audit digests are production requirements.
  db.exec([
    "CREATE TRIGGER IF NOT EXISTS audit_events_append_only_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;",
    "CREATE TRIGGER IF NOT EXISTS audit_events_append_only_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;"
  ].join('\n'));

  function checkAdmin(actor) {
    if(!actor?.id||actor.role!=='admin'||actor.suspended)throw error('GOVERNANCE_FORBIDDEN',403);
    const row=db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND suspended=0").get(actor.id);
    if(!row)throw error('GOVERNANCE_FORBIDDEN',403);
  }
  function roleNames(actor){
    checkAdmin(actor);
    return db.prepare("SELECT role FROM governance_role_grants WHERE user_id=? ORDER BY role").all(actor.id).map(x=>x.role);
  }
  function permissions(actor){
    return [...new Set(roleNames(actor).flatMap(name=>GOVERNANCE_ROLES[name]||[]))].sort();
  }
  function requireCapability(actor,capability){
    if(!permissions(actor).includes(capability))throw error('GOVERNANCE_FORBIDDEN',403);
  }
  function bootstrapOwner(userId){
    // Called ONLY inside the privileged bootstrapAdmin transaction in store.
    db.prepare("INSERT INTO governance_role_grants(user_id,role,granted_by,granted_at) VALUES(?,'governance_owner',?,?)").run(userId,userId,now());
  }
  // Upgrade a pre-existing single local administrator, preserving the original
  // admin's existing authority. Never select between multiple administrators.
  const hasOwner=db.prepare("SELECT 1 FROM governance_role_grants WHERE role='governance_owner' LIMIT 1").get();
  const oldAdmins=db.prepare("SELECT id FROM users WHERE role='admin' AND suspended=0 ORDER BY created_at,id LIMIT 2").all();
  if(!hasOwner&&oldAdmins.length===1){
    transaction(()=>{
      db.prepare("INSERT OR IGNORE INTO governance_role_grants(user_id,role,granted_by,granted_at) VALUES(?,'governance_owner',?,?)").run(oldAdmins[0].id,oldAdmins[0].id,now());
      audit(oldAdmins[0].id,'governance.owner.migrated',oldAdmins[0].id,{legacyLocalAdmin:true});
    });
  }
  function roles(actor){requireCapability(actor,'staff.assign');
    return db.prepare("SELECT user_id AS userId,role,granted_at AS grantedAt FROM governance_role_grants ORDER BY user_id,role LIMIT 200").all();
  }
  function assignRole(actor,userId,role){
    requireCapability(actor,'staff.assign');
    if(typeof userId!=='string'||!Object.hasOwn(GOVERNANCE_ROLES,role))throw error('INVALID_GOVERNANCE_ROLE',422);
    return transaction(()=>{
      const target=db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND suspended=0").get(userId);
      if(!target)throw error('STAFF_NOT_FOUND',404);
      const inserted=db.prepare("INSERT OR IGNORE INTO governance_role_grants(user_id,role,granted_by,granted_at) VALUES(?,?,?,?)").run(userId,role,actor.id,now()).changes;
      if(inserted)audit(actor.id,'governance.staff.role.granted',userId,{role});
      return {userId,role,replayed:inserted===0};
    });
  }
  function revokeRole(actor,userId,role){
    requireCapability(actor,'staff.assign');
    if(typeof userId!=='string'||!Object.hasOwn(GOVERNANCE_ROLES,role))throw error('INVALID_GOVERNANCE_ROLE',422);
    return transaction(()=>{
      if(role==='governance_owner'&&db.prepare("SELECT count(*) AS n FROM governance_role_grants WHERE role='governance_owner'").get().n<=1)throw error('LAST_OWNER_REQUIRED',409);
      const deleted=db.prepare("DELETE FROM governance_role_grants WHERE user_id=? AND role=?").run(userId,role).changes;
      if(deleted)audit(actor.id,'governance.staff.role.revoked',userId,{role});
      return {userId,role,revoked:Boolean(deleted)};
    });
  }
  function count(table,where=''){
    // Table names are internal hard-coded constants, NEVER supplied by users.
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))return null;
    try{return Number(db.prepare('SELECT count(*) AS n FROM '+table+where).get().n);}catch{return null;}
  }
  function dashboard(actor) {
    requireCapability(actor,'dashboard.read');
    return {
      generatedAt:now(),
      activeIncidents:count('governance_incidents'," WHERE state!='resolved'"),
      openPrivacyRequests:count('privacy_requests'," WHERE status='open'"),
      openCopyrightClaims:count('copyright_cases'," WHERE status='open'"),
      openVerificationAppeals:count('verification_appeals'," WHERE status='open'"),
      openCommentReports:count('lesson_comment_reports'," WHERE status='open'"),
      openCommunityReports:count('community_reports'," WHERE status='open'"),
      openPaymentDisputes:count('payment_disputes'," WHERE status='open'"),
      auditEvents:count('audit_events'),
      // Counts only; never expose raw ID evidence, messages or payment journal.
      privacyPolicyApproved:false,retentionAutomationEnabled:false,livePaymentActionsEnabled:false
    };
  }
  function history(actor,{limit=30}={}){
    requireCapability(actor,'audit.read');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw error('INVALID_AUDIT_QUERY',422);
    return db.prepare("SELECT id,actor_id AS actorId,action,resource_id AS resourceId,created_at AS createdAt FROM audit_events ORDER BY created_at DESC,id DESC LIMIT ?").all(limit);
  }
  function reportIncident(actor,{category,severity,summary}={}){
    requireCapability(actor,'incident.write');
    const text=reason(summary,20,1000);
    if(!CATEGORIES.has(category)||!SEVERITIES.has(severity)||!text)throw error('INVALID_INCIDENT',422);
    return transaction(()=>{
      const recent=db.prepare("SELECT count(*) AS n FROM governance_incidents WHERE reporter_id=? AND created_at>=?").get(actor.id,new Date(Date.now()-3600000).toISOString()).n;
      if(recent>=10)throw error('GOVERNANCE_RATE_LIMIT',429);
      const id=randomUUID(),date=now();
      db.prepare("INSERT INTO governance_incidents(id,category,severity,summary,reporter_id,last_actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id,category,severity,text,actor.id,actor.id,date,date);
      audit(actor.id,'governance.incident.opened',id,{category,severity});
      return {id,state:'open',category,severity,createdAt:date};
    });
  }
  function incidents(actor,{limit=30}={}){
    requireCapability(actor,'incident.read');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw error('INVALID_INCIDENT_QUERY',422);
    return db.prepare("SELECT id,category,severity,summary,state,created_at AS createdAt,updated_at AS updatedAt FROM governance_incidents ORDER BY created_at DESC LIMIT ?").all(limit);
  }
  function changeIncident(actor,id,{state,note}={}){
    requireCapability(actor,'incident.write');
    const text=reason(note,10,500),next={open:'investigating',investigating:'contained',contained:'resolved'};
    if(typeof id!=='string'||!text||!Object.values(next).includes(state))throw error('INVALID_INCIDENT_DECISION',422);
    return transaction(()=>{
      const current=db.prepare("SELECT state,severity,reporter_id FROM governance_incidents WHERE id=?").get(id);
      if(!current)throw error('INCIDENT_NOT_FOUND',404);
      if(next[current.state]!==state)throw error('INCIDENT_STATE_CONFLICT',409);
      if(current.severity==='critical'&&state==='resolved'&&current.reporter_id===actor.id)throw error('INDEPENDENT_REVIEW_REQUIRED',409);
      db.prepare("UPDATE governance_incidents SET state=?,last_actor_id=?,updated_at=? WHERE id=? AND state=?").run(state,actor.id,now(),id,current.state);
      audit(actor.id,'governance.incident.transitioned',id,{from:current.state,to:state,note:text});
      return {id,state};
    });
  }
  function proposeRetention(actor,{dataset,days,rationale}={}){
    requireCapability(actor,'retention.propose');
    const text=reason(rationale,20,500);
    if(!DATASETS.has(dataset)||!Number.isInteger(days)||days<1||days>3650||!text)throw error('INVALID_RETENTION_PROPOSAL',422);
    return transaction(()=>{
      const id=randomUUID();
      db.prepare("INSERT INTO governance_retention_proposals(id,dataset,days,rationale,proposed_by,created_at) VALUES(?,?,?,?,?,?)").run(id,dataset,days,text,actor.id,now());
      audit(actor.id,'governance.retention.proposed',id,{dataset,days});
      return {id,dataset,days,state:'proposed',automaticDeletion:false,policyApproved:false};
    });
  }
  function retentionProposals(actor){
    requireCapability(actor,'retention.review');
    return db.prepare("SELECT id,dataset,days,state,created_at AS createdAt FROM governance_retention_proposals ORDER BY created_at DESC LIMIT 100").all();
  }
  function rejectRetention(actor,id,note){
    requireCapability(actor,'retention.review');
    const text=reason(note,10,500);if(!text)throw error('INVALID_RETENTION_DECISION',422);
    return transaction(()=>{
      const row=db.prepare("SELECT state FROM governance_retention_proposals WHERE id=?").get(id);
      if(!row)throw error('RETENTION_PROPOSAL_NOT_FOUND',404);
      if(row.state!=='proposed')throw error('RETENTION_CONFLICT',409);
      db.prepare("UPDATE governance_retention_proposals SET state='rejected',reviewed_by=?,reviewed_at=? WHERE id=? AND state='proposed'").run(actor.id,now(),id);
      audit(actor.id,'governance.retention.rejected',id,{note:text});
      return {id,state:'rejected',automaticDeletion:false};
    });
  }
  return Object.freeze({bootstrapOwner,requireCapability,permissions,roles,assignRole,revokeRole,dashboard,history,reportIncident,incidents,changeIncident,proposeRetention,retentionProposals,rejectRetention});
}
