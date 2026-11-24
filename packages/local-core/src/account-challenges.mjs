import {randomBytes,createHash,createHmac,scryptSync} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const now=()=>Math.floor(Date.now()/1000);
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);

// Local development only. Delivery is injected by trusted server code, never
// supplied by the browser. No raw challenge is written to SQLite or audit logs.
export function createAccountChallenges({db,transaction,audit,error,validatePassword,pepper,getSession}){
 db.exec("CREATE TABLE IF NOT EXISTS account_challenges(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK(purpose IN ('email','reset')),email TEXT NOT NULL,expires_at INTEGER NOT NULL,UNIQUE(user_id,purpose)); CREATE TABLE IF NOT EXISTS account_challenge_requests(digest TEXT NOT NULL,requested_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS account_challenge_requests_time ON account_challenge_requests(requested_at); CREATE INDEX IF NOT EXISTS account_challenge_requests_digest ON account_challenge_requests(digest,requested_at)");
 if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='email_verified_at'))db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
 function issue(purpose,email,sessionToken){
  if(typeof email!=='string'||email.length>254)throw error('INVALID_EMAIL',422);
  const normalized=email.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))throw error('INVALID_EMAIL',422);
  return transaction(()=>{
   const t=now(),key=createHmac('sha256',pepper).update('challenge:'+purpose+':'+normalized).digest('hex');
   db.prepare('DELETE FROM account_challenge_requests WHERE requested_at<=?').run(t-3600);
   db.prepare('DELETE FROM account_challenges WHERE expires_at<=?').run(t);
   if(db.prepare('SELECT count(*) AS n FROM account_challenge_requests').get().n>=120||
      db.prepare('SELECT count(*) AS n FROM account_challenge_requests WHERE digest=?').get(key).n>=3)return null;
   db.prepare('INSERT INTO account_challenge_requests VALUES(?,?)').run(key,t);
   const row=db.prepare("SELECT id,email,email_verified_at FROM users WHERE email=? AND role='student' AND suspended=0").get(normalized);
   if(!row)return null;
   if(purpose==='email'){
    const actor=getSession(sessionToken);
    if(!actor||actor.id!==row.id||row.email_verified_at)return null;
   }else if(!row.email_verified_at)return null;
   const token=randomBytes(32).toString('base64url'),expiresAt=t+(purpose==='email'?1800:900);
   db.prepare('DELETE FROM account_challenges WHERE user_id=? AND purpose=?').run(row.id,purpose);
   db.prepare('INSERT INTO account_challenges VALUES(?,?,?,?,?)').run(digest(token),row.id,purpose,row.email,expiresAt);
   return {email:row.email,purpose,token,expiresAt};
  });
 }
 function consume(purpose,token,sessionToken,password){
  if(!validToken(token))throw error('INVALID_ACCOUNT_CHALLENGE',422);
  if(purpose==='reset')validatePassword(password);
  return transaction(()=>{
   const hash=digest(token);
   const row=db.prepare("SELECT c.user_id,c.email,u.email_verified_at FROM account_challenges c JOIN users u ON u.id=c.user_id WHERE c.token_hash=? AND c.purpose=? AND c.expires_at>? AND c.email=u.email AND u.role='student' AND u.suspended=0").get(hash,purpose,now());
   if(!row)throw error('INVALID_ACCOUNT_CHALLENGE',422);
   if(purpose==='email'){
    const actor=getSession(sessionToken);
    if(!actor||actor.id!==row.user_id)throw error('INVALID_ACCOUNT_CHALLENGE',422);
    db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(new Date().toISOString(),row.user_id);
    db.prepare('DELETE FROM account_challenges WHERE token_hash=?').run(hash);
    audit(row.user_id,'account.email.verified',row.user_id);
   }else{
    if(!row.email_verified_at)throw error('INVALID_ACCOUNT_CHALLENGE',422);
    const salt=randomBytes(16).toString('hex'),passwordHash=scryptSync(password,salt,64).toString('hex');
    db.prepare('UPDATE users SET password_hash=?,salt=? WHERE id=?').run(passwordHash,salt,row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
    db.prepare('DELETE FROM account_challenges WHERE user_id=?').run(row.user_id);
    audit(row.user_id,'account.password.reset',row.user_id);
   }
   return {ok:true};
  });
 }
 return {issueEmail:(email,session)=>issue('email',email,session),issueReset:email=>issue('reset',email),
  confirmEmail:(token,session)=>consume('email',token,session),
  resetPassword:(token,password)=>consume('reset',token,null,password),
  cancel:token=>{if(validToken(token))db.prepare('DELETE FROM account_challenges WHERE token_hash=?').run(digest(token));}};
}
