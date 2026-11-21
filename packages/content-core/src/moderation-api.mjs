import { prepareModerationDecision, ContentRuleError } from './content.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const respond = (status, payload) => new Response(JSON.stringify(payload),{status,headers:JSON_HEADERS});
const failure = (status,code) => respond(status,{error:code});

async function boundedDecision(request) {
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??'')) return {error:'INVALID_MEDIA_TYPE',status:415};
  const length=Number(request.headers.get('content-length')??0);
  if(length>2048) return {error:'BODY_TOO_LARGE',status:413};
  const reader=request.body?.getReader();
  if(!reader)return {error:'INVALID_JSON',status:400};
  const chunks=[];let size=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>2048){await reader.cancel();return {error:'BODY_TOO_LARGE',status:413};}
      chunks.push(value);
    }
  } catch {return {error:'INVALID_JSON',status:400};}
  finally {reader.releaseLock();}
  const joined=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(joined);}catch{return {error:'INVALID_JSON',status:400};}
  let value;
  try { value=JSON.parse(text); } catch { return {error:'INVALID_JSON',status:400}; }
  if(!value || typeof value!=='object' || Array.isArray(value)) return {error:'INVALID_JSON',status:400};
  return {value};
}

/**
 * POST /api/lessons/:id/moderate
 * All actor, role, lesson state and identity come from server-authenticated
 * and privileged database lookups, never from request JSON. A conditional DB
 * update is the concurrency guard; a database trigger records the audit atomically.
 * Retry after an acknowledged response is safe: replay only exact prior outcome.
 */
export function createModerationHandler({auth,store,audit=()=>{}}) {
  if(typeof auth?.getUser!=='function'||typeof store?.getStaff!=='function'||typeof store?.getContent!=='function'||typeof store?.changeStatusOnce!=='function') throw new TypeError('Missing moderation dependencies');
  return async function POST(request,{lessonId}={}) {
    const correlationId=crypto.randomUUID();
    if(request.method!=='POST') return failure(405,'METHOD_NOT_ALLOWED');
    if(!UUID.test(lessonId??'')) return failure(400,'INVALID_LESSON');
    const match=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'');
    if(!match) return failure(401,'AUTH_REQUIRED');
    try {
      const user=await auth.getUser(match[1]);
      if(!UUID.test(user?.id??'')) return failure(401,'AUTH_REQUIRED');
      const staff=await store.getStaff(user.id);
      // The role is read from privileged staff records, never the browser token's user_metadata.
      if(!staff?.active||!['moderator','admin'].includes(staff.role)) return failure(403,'FORBIDDEN');
      const body=await boundedDecision(request);
      if(body.error) return failure(body.status,body.error);
      const {decision,reason}=body.value;
      if(!['approve','reject'].includes(decision)||typeof reason!=='string'||reason.trim().length<5||reason.trim().length>1000) return failure(422,'INVALID_DECISION');
      const item=await store.getContent(lessonId);
      if(!item) return failure(404,'LESSON_NOT_FOUND');
      const nextStatus=decision==='approve'?'published':'rejected';
      if(item.creatorId===user.id)return failure(403,'CONFLICT_OF_INTEREST');
      // Network retries must not turn a completed response into a false failure.
      if(item.status===nextStatus&&item.reviewerId===user.id&&item.reviewReason===reason.trim()){
        return respond(200,{lesson:{id:item.id,status:item.status},replayed:true});
      }
      if(item.status!=='in_review') return failure(409,'INVALID_STATE');
      let command;
      try { command=prepareModerationDecision({actor:{id:user.id,role:staff.role,suspended:!staff.active},item,decision,reason}); }
      catch(e){if(e instanceof ContentRuleError)return failure(e.code==='CONFLICT_OF_INTEREST'?403:422,e.code);throw e;}
      const result=await store.changeStatusOnce({contentId:lessonId,reviewerId:user.id,decision:command.nextStatus,reason:command.reason});
      if(!result) return failure(409,'CONCURRENT_DECISION');
      // Best-effort operational telemetry; durable audit is the SQL trigger, same DB txn as status update.
      try {audit({event:'lesson.moderated',correlationId,actorId:user.id,contentId:lessonId,decision:command.nextStatus});}catch{}
      return respond(200,{lesson:{id:lessonId,status:command.nextStatus},replayed:false});
    } catch {
      try{audit({event:'lesson.moderation.error',correlationId});}catch{}
      return respond(503,{error:'SERVICE_UNAVAILABLE',correlationId});
    }
  };
}

/** Server-only REST client. Supabase service key never crosses to browser. */
export function createSupabaseModerationDependencies({url,publicKey,serverKey,fetcher=fetch}) {
  if(!url||!publicKey||!serverKey||typeof fetcher!=='function')throw new Error('Missing Supabase configuration');
  const base=new URL(url);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('Supabase must use HTTPS');
  async function request(path,{method='GET',key=serverKey,params={},body,prefer}={}) {
    const dest=new URL(path,base);
    for(const [param,value] of Object.entries(params))dest.searchParams.set(param,value);
    const res=await fetcher(dest,{method,headers:{apikey:key,authorization:`Bearer ${key}`,...(body?{'content-type':'application/json'}:{}),...(prefer?{prefer}:{})},body:body?JSON.stringify(body):undefined,redirect:'error'});
    if(!res.ok)throw new Error('Provider unavailable');
    return res.status===204?[]:res.json();
  }
  async function one(table,params){ const rows=await request(`/rest/v1/${table}`,{params:{select:'*',limit:'1',...params}});return rows?.[0]??null; }
  return {
    auth:{async getUser(token){
      const res=await fetcher(new URL('/auth/v1/user',base),{headers:{apikey:publicKey,authorization:`Bearer ${token}`},redirect:'error'});
      if([401,403].includes(res.status))return null;
      if(!res.ok)throw new Error('Authentication provider unavailable');
      const user=await res.json();return UUID.test(user?.id??'')?{id:user.id}:null;
    }},
    store:{
      async getStaff(userId){const r=await one('platform_staff',{user_id:`eq.${userId}`});return r?{active:r.active,role:r.role}:null;},
      async getContent(id){const r=await one('content_items',{id:`eq.${id}`});return r?{id:r.id,creatorId:r.creator_id,status:r.status,reviewerId:r.reviewer_id,reviewReason:r.review_reason}:null;},
      async changeStatusOnce({contentId,reviewerId,decision,reason}){
        const rows=await request('/rest/v1/content_items',{method:'PATCH',params:{id:`eq.${contentId}`,status:'eq.in_review',reviewer_id:'is.null',creator_id:`neq.${reviewerId}`,select:'id,status'},prefer:'return=representation',body:{status:decision,reviewer_id:reviewerId,review_reason:reason,reviewed_at:new Date().toISOString(),...(decision==='published'?{published_at:new Date().toISOString()}:{})}});
        return rows?.length===1;
      }
    }
  };
}
