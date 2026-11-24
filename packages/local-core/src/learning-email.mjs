/** Week 6 notifications. Sending requires verified account email + explicit opt-in.
 * Durable retryable outbox, provider idempotency, no user enumeration, no auto-delivery.
 * Uses Resend HTTPS API; no external SDK/dependency, never exposes its API key to clients.
 */
const stamp=()=>new Date().toISOString();
const invalid=(code,status=503)=>Object.assign(Error(code),{code,status});

export function createResendLearningEmail({apiKey,from,fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
 if(typeof apiKey!=='string'||!/^re_[A-Za-z0-9_-]{10,}$/.test(apiKey)||
    typeof from!=='string'||from.length>254||
    !/^[^\s@<>]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(from)||
    typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)
   throw invalid('LEARNING_EMAIL_NOT_CONFIGURED');
 return {
  environment:'configured',
  async send({to,subject,text,idempotencyKey}={}){
    if(typeof to!=='string'||to.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)||
       typeof subject!=='string'||subject.length>120||
       typeof text!=='string'||text.length>1500||
       typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      throw invalid('INVALID_NOTIFICATION',422);
    let response;
    try{
      response=await fetchImpl('https://api.resend.com/emails',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
        headers:{authorization:'Bearer '+apiKey,'content-type':'application/json',
          'Idempotency-Key':idempotencyKey},
        body:JSON.stringify({from,to:[to],subject,text})
      });
    }catch{throw invalid('LEARNING_EMAIL_UNAVAILABLE');}
    if(!response?.ok)throw invalid('LEARNING_EMAIL_UNAVAILABLE');
    // Never include provider responses (which may contain PII) in logs.
    let payload;
    try{payload=await response.json();}catch{throw invalid('LEARNING_EMAIL_UNAVAILABLE');}
    if(typeof payload?.id!=='string'||payload.id.length>160)
      throw invalid('LEARNING_EMAIL_UNAVAILABLE');
    return {messageId:payload.id};
  }
 };
}
export function learningEmailFromEnv(env=process.env){
 if(env.STUDENT_CREATORS_LEARNING_EMAIL_ENABLED!=='true')return null;
 const key=env.RESEND_API_KEY??env.resend_api;
 const from=env.STUDENT_CREATORS_NOTIFICATION_FROM;
 if(!key||!from)return null;
 return createResendLearningEmail({apiKey:key,from});
}
export function createLocalLearningEmail({db,transaction,audit,error,requireVerified,clock=()=>Date.now()}){
 db.exec([
  "CREATE TABLE IF NOT EXISTS learning_email_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),opt_in INTEGER NOT NULL DEFAULT 0 CHECK(opt_in IN (0,1)),opted_in_at TEXT,updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS learning_email_delivery(notification_id TEXT PRIMARY KEY REFERENCES learning_notifications(id),state TEXT NOT NULL CHECK(state IN ('sending','sent','retry')),attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,provider_message_id TEXT,updated_at TEXT NOT NULL);"
 ].join('\n'));
 const emailIsVerified=id=>Boolean(db.prepare(`
   SELECT 1 FROM users u JOIN account_email_proofs p ON p.user_id=u.id AND p.email=u.email
   WHERE u.id=? AND u.suspended=0 AND u.role='student'`).get(id));
 function notifyPrefs(actor){
   requireVerified(actor);
   const p=db.prepare('SELECT opt_in,opted_in_at FROM learning_email_preferences WHERE user_id=?').get(actor.id);
   return {emailOptIn:Boolean(p?.opt_in),emailVerified:emailIsVerified(actor.id),
     deliveryEnabled:false};
 }
 function setPrefs(actor,optIn){
   requireVerified(actor);
   if(typeof optIn!=='boolean')throw error('INVALID_PREFERENCE',422);
   if(optIn&&!emailIsVerified(actor.id))throw error('EMAIL_VERIFICATION_REQUIRED',403);
   return transaction(()=>{
     const prior=db.prepare('SELECT opt_in,opted_in_at FROM learning_email_preferences WHERE user_id=?').get(actor.id);
     if(Boolean(prior?.opt_in)===optIn)return {emailOptIn:optIn,replayed:true};
     const at=stamp();
     db.prepare('INSERT INTO learning_email_preferences(user_id,opt_in,opted_in_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET opt_in=excluded.opt_in,opted_in_at=excluded.opted_in_at,updated_at=excluded.updated_at')
       .run(actor.id,Number(optIn),optIn?at:null,at);
     audit(actor.id,'learning.email.preference.updated',actor.id,{optIn});
     return {emailOptIn:optIn,replayed:false};
   });
 }
 async function drain(admin,provider,{limit=20}={}){
   if(!admin||admin.role!=='admin'||admin.suspended||
       !db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND suspended=0").get(admin.id))
     throw error('ADMIN_REQUIRED',403);
   if(!provider||typeof provider.send!=='function')throw error('LEARNING_EMAIL_NOT_CONFIGURED',503);
   if(!Number.isInteger(limit)||limit<1||limit>30)throw error('INVALID_LIMIT',422);
   let sent=0,failed=0;
   for(let i=0;i<limit;i++){
     const job=transaction(()=>{
       const row=db.prepare(`
        SELECT n.id,n.user_id,n.kind,n.body,u.email
        FROM learning_notifications n
        JOIN learning_email_preferences p ON p.user_id=n.user_id AND p.opt_in=1
          AND n.created_at>=p.opted_in_at
        JOIN users u ON u.id=n.user_id AND u.role='student' AND u.suspended=0
        JOIN account_email_proofs proof ON proof.user_id=u.id AND proof.email=u.email
        LEFT JOIN learning_email_delivery d ON d.notification_id=n.id
        WHERE (d.notification_id IS NULL OR
          ((d.state='retry' OR (d.state='sending' AND d.lease_until<?))
            AND d.attempts<3 AND d.next_attempt_at<=?))
          AND (n.kind<>'class_reminder' OR EXISTS(
            SELECT 1 FROM interactive_classes c
            WHERE c.id=n.resource_id AND c.status='scheduled' AND c.starts_at>?
          ))
        ORDER BY n.created_at LIMIT 1`).get(clock(),clock(),new Date(clock()).toISOString());
       if(!row)return null;
       db.prepare(`INSERT INTO learning_email_delivery(notification_id,state,attempts,lease_until,next_attempt_at,updated_at)
        VALUES(?,'sending',1,?,0,?)
        ON CONFLICT(notification_id) DO UPDATE SET state='sending',attempts=attempts+1,
        lease_until=excluded.lease_until,updated_at=excluded.updated_at`)
        .run(row.id,clock()+30000,stamp());
       return row;
     });
     if(!job)break;
     try{
       const sentMessage=await provider.send({to:job.email,subject:'Student Creators — learning update',
         text:job.body+'\n\nOpen Student Creators to review your class or request. You can turn off these updates in learning settings.',
         idempotencyKey:'wk06-notification-'+job.id});
       if(typeof sentMessage?.messageId!=='string')throw error('LEARNING_EMAIL_UNAVAILABLE',503);
       db.prepare("UPDATE learning_email_delivery SET state='sent',provider_message_id=?,lease_until=0,updated_at=? WHERE notification_id=? AND state='sending'")
         .run(sentMessage.messageId,stamp(),job.id);
       audit(admin.id,'learning.email.sent',job.id);
       sent++;
     }catch{
       // Later retry uses the same provider idempotency key, even after timeout.
       db.prepare("UPDATE learning_email_delivery SET state='retry',lease_until=0,next_attempt_at=?,updated_at=? WHERE notification_id=? AND state='sending'")
         .run(clock()+60000,stamp(),job.id);
       failed++;
     }
   }
   return {sent,failed,deliveryProviderConfigured:true};
 }
 return {learningEmailPreferences:notifyPrefs,setLearningEmailPreference:setPrefs,drainLearningEmailOutbox:drain};
}
