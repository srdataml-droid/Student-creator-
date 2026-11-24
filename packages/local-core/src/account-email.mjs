/** Local-only account email proofs. Delivery must be server-side; no token is returned by HTTP.
 * This module is not a substitute for managed hosted authentication.
 */
import {createHash,createHmac,randomBytes,scryptSync} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const now=()=>Math.floor(Date.now()/1000);
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function createLocalAccountEmail({db,transaction,audit,error,getSession,studentAllowed,validatePassword}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS account_email_proofs(
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,verified_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS account_email_challenges(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify','recover')),
  email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,issued_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,purpose)
 );
 CREATE INDEX IF NOT EXISTS account_email_challenges_expiry ON account_email_challenges(expires_at);
 CREATE TABLE IF NOT EXISTS account_email_requests(request_digest TEXT NOT NULL,requested_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS account_email_requests_time ON account_email_requests(requested_at);
 CREATE INDEX IF NOT EXISTS account_email_requests_digest ON account_email_requests(request_digest,requested_at);
 `);
 // Count requests, including unknown addresses and completed/failed challenges.
 // A database-local secret prevents offline guessing of email addresses.
 const requestPepper=Buffer.from(db.prepare('SELECT secret FROM auth_throttle_secret WHERE id=1').get().secret,'hex');
 function admitRequest(email,purpose){
  const at=now(),key=createHmac('sha256',requestPepper).update('account-email:'+purpose+':'+email).digest('hex');
  db.prepare('DELETE FROM account_email_requests WHERE requested_at<=?').run(at-3600);
  if(db.prepare('SELECT count(*) AS n FROM account_email_requests').get().n>=120)return false;
  if(db.prepare('SELECT count(*) AS n FROM account_email_requests WHERE request_digest=?').get(key).n>=8)return false;
  db.prepare('INSERT INTO account_email_requests VALUES(?,?)').run(key,at);
  return true;
 }
 function active(user){return user&&user.role==='student'&&!user.suspended&&studentAllowed(user);}
 function verified(user){return !!(user&&db.prepare('SELECT 1 FROM account_email_proofs WHERE user_id=? AND email=?').get(user.id,user.email));}
 function currentStudent(sessionToken){
  const actor=getSession(sessionToken);
  if(!actor)throw error('AUTH_REQUIRED',401);
  const row=db.prepare('SELECT id,email,role,suspended FROM users WHERE id=?').get(actor.id);
  if(!active(row))throw error('STUDENT_REQUIRED',403);
  return row;
 }
 function issue(row,purpose){
  const at=now();
  const previous=db.prepare('SELECT issued_at FROM account_email_challenges WHERE user_id=? AND purpose=?').get(row.id,purpose);
  if(previous&&at-previous.issued_at<60)return null;
  // Limit aggregate issuance in the local process; at most one challenge per account/purpose.
  if(db.prepare('SELECT count(*) AS n FROM account_email_challenges WHERE issued_at>?').get(at-60).n>=100)return null;
  db.prepare('DELETE FROM account_email_challenges WHERE expires_at<=?').run(at);
  const token=randomBytes(32).toString('base64url'),expiresAt=at+(purpose==='verify'?1800:900);
  db.prepare(`INSERT INTO account_email_challenges(user_id,purpose,email,token_hash,issued_at,expires_at)
   VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,purpose) DO UPDATE SET email=excluded.email,token_hash=excluded.token_hash,issued_at=excluded.issued_at,expires_at=excluded.expires_at`)
   .run(row.id,purpose,row.email,digest(token),at,expiresAt);
  audit(row.id,'account.email.challenge.issued',row.id,{purpose});
  return {to:row.email,purpose,token,expiresAt};
 }
 function challenge(token,purpose){
  if(!validToken(token))throw error('INVALID_EMAIL_CHALLENGE',422);
  const row=db.prepare(`SELECT u.id,u.email,u.role,u.suspended,c.email AS challenge_email
   FROM account_email_challenges c JOIN users u ON u.id=c.user_id
   WHERE c.token_hash=? AND c.purpose=? AND c.expires_at>?`).get(digest(token),purpose,now());
  if(!active(row)||row.email!==row.challenge_email)throw error('INVALID_EMAIL_CHALLENGE',422);
  return row;
 }
 return {
  status(sessionToken){const row=currentStudent(sessionToken);return {emailVerified:verified(row)};},
  requestVerification(sessionToken){return transaction(()=>{const row=currentStudent(sessionToken);return admitRequest(row.email,'verify')&&!verified(row)?issue(row,'verify'):null;});},
  confirmVerification(sessionToken,token){return transaction(()=>{
   const actor=currentStudent(sessionToken),row=challenge(token,'verify');
   if(row.id!==actor.id)throw error('INVALID_EMAIL_CHALLENGE',422);
   db.prepare('INSERT INTO account_email_proofs(user_id,email,verified_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at').run(row.id,row.email,new Date().toISOString());
   db.prepare('DELETE FROM account_email_challenges WHERE user_id=? AND purpose=?').run(row.id,'verify');
   audit(row.id,'account.email.verified',row.id);
   return {emailVerified:true};
  });},
  requestRecovery(email){
   const normalized=typeof email==='string'?email.trim().toLowerCase():'';
   return transaction(()=>{
    if(!validEmail(normalized)||!admitRequest(normalized,'recover'))return null;
    const row=db.prepare('SELECT id,email,role,suspended FROM users WHERE email=?').get(normalized);
    return active(row)&&verified(row)?issue(row,'recover'):null;
   });
  },
  resetPassword(token,password){
   validatePassword(password);
   // Invalid tokens never trigger the expensive password hash.
   return transaction(()=>{
    const row=challenge(token,'recover');
    if(!verified(row))throw error('INVALID_EMAIL_CHALLENGE',422);
    const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
    db.prepare('UPDATE users SET password_hash=?,salt=? WHERE id=?').run(hash,salt,row.id);
    db.prepare('DELETE FROM account_email_challenges WHERE user_id=?').run(row.id);
    const revokedSessions=Number(db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id).changes);
    audit(row.id,'account.password.recovered',row.id,{revokedSessions});
    return {ok:true};
   });
  },
  cancelChallenge(token){if(validToken(token))transaction(()=>db.prepare('DELETE FROM account_email_challenges WHERE token_hash=?').run(digest(token)));},
  revokeChallenges(userId){db.prepare('DELETE FROM account_email_challenges WHERE user_id=?').run(userId);}
 };
}
