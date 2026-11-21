import { createHash } from 'node:crypto';
import { prepareLessonDraft, ContentRuleError } from './content.mjs';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
const BODY_LIMIT = 8192;

function json(status, payload, headers={}) {
  return new Response(JSON.stringify(payload), { status, headers:{'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers} });
}
function invalid(code, status=400) { return json(status, {error:code}); }

/** Avoid buffering arbitrary-size attacker-controlled request bodies. */
async function readLimitedJson(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||'')) throw Object.assign(new Error('INVALID_MEDIA_TYPE'), {status:415});
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('INVALID_JSON'), {status:400});
  const chunks=[];let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>BODY_LIMIT) { await reader.cancel(); throw Object.assign(new Error('BODY_TOO_LARGE'), {status:413}); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { joined.set(chunk,offset);offset+=chunk.byteLength; }
  let body;
  try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined)); }
  catch { throw Object.assign(new Error('INVALID_JSON'), {status:400}); }
  if(!body || Array.isArray(body) || typeof body!=='object') throw Object.assign(new Error('INVALID_JSON'), {status:400});
  return body;
}

/**
 * POST /api/lessons/drafts; dependencies use a real trusted Auth service and
 * a server-only repository. Client-supplied identity, status, and campus are ignored.
 * Idempotency is enforced by a UNIQUE constraint on (creator_id, creation_key).
 */
export function createDraftHandler({auth, store, audit=()=>{}}) {
  if(!auth?.getUser || !store?.getProfile || !store?.getCourse || !store?.getTopic || !store?.insertDraftOnce) throw new TypeError('Missing authenticated storage dependencies');
  return async function POST(request) {
    const correlationId=crypto.randomUUID();
    try {
      if(request.method!=='POST') return invalid('METHOD_NOT_ALLOWED',405);
      const authorization=request.headers.get('authorization')||'';
      if(!/^Bearer [^\s]+$/i.test(authorization)) return invalid('AUTH_REQUIRED',401);
      const token=authorization.slice(7);
      const user=await auth.getUser(token);
      if(!user || !ID.test(user.id)) return invalid('AUTH_REQUIRED',401);
      const creationKey=request.headers.get('idempotency-key')||'';
      if(!KEY.test(creationKey)) return invalid('IDEMPOTENCY_KEY_REQUIRED',400);
      const body=await readLimitedJson(request);
      if(!ID.test(body.courseId)|| (body.topicId!==undefined && body.topicId!==null && !ID.test(body.topicId))) return invalid('INVALID_COURSE',422);
      const profile=await store.getProfile(user.id);
      if(!profile || !profile.verifiedAt || profile.suspended || !ID.test(profile.institutionId)) return invalid('CAMPUS_VERIFICATION_REQUIRED',403);
      const [course, topic]=await Promise.all([store.getCourse(body.courseId),body.topicId?store.getTopic(body.topicId):Promise.resolve(null)]);
      const draft=prepareLessonDraft({
        actor:{id:user.id,institutionId:profile.institutionId,verifiedAt:profile.verifiedAt,suspended:profile.suspended},
        course,topic,input:{title:body.title,description:body.description,previewText:body.previewText,rightsAttested:body.rightsAttested}
      });
      const normalized={creatorId:draft.creatorId,institutionId:draft.institutionId,courseId:draft.courseId,topicId:draft.topicId,title:draft.title,description:draft.description,previewText:draft.previewText,rightsAttested:true};
      const creationHash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      const result=await store.insertDraftOnce({draft,creationKey,creationHash});
      if(result.conflict) return invalid('IDEMPOTENCY_KEY_CONFLICT',409);
      const item=result.item;
      if(!item || !ID.test(item.id) || item.creatorId!==user.id) throw new Error('Invalid storage response');
      audit({event:result.created?'lesson.draft.created':'lesson.draft.replayed',subjectId:user.id,resourceId:item.id,correlationId});
      return json(result.created?201:200,{draft:{id:item.id,status:item.status,title:item.title,courseId:item.courseId,topicId:item.topicId}}, {'x-correlation-id':correlationId});
    } catch (error) {
      if(error instanceof ContentRuleError) {
        const map={NOT_VERIFIED:403,WRONG_COURSE:403,WRONG_TOPIC:422,INVALID_CONTENT:422,RIGHTS_REQUIRED:422};
        return invalid(error.code,map[error.code]||400);
      }
      if(error?.status && ['INVALID_MEDIA_TYPE','INVALID_JSON','BODY_TOO_LARGE'].includes(error.message)) return invalid(error.message,error.status);
      audit({event:'lesson.draft.error',code:'INTERNAL_ERROR',correlationId});
      return json(503,{error:'SERVICE_UNAVAILABLE',correlationId});
    }
  };
}
