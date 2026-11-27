/**
 * Server-only Mux signed-playback grant.
 * Caller must provide a current authenticated viewer, database-owned lesson,
 * and authoritative entitlement/verification check on EVERY grant.
 */
import {createPrivateKey,sign} from 'node:crypto';
const reject=(code,status)=>Object.assign(new Error(code),{code,status});
const idPattern=/^[A-Za-z0-9_-]{6,128}$/;
const base64url=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * loadLesson must fetch from server DB, not use client-supplied playback IDs.
 * authorizeViewer must recheck student identity, suspension, creator blocks,
 * paid entitlement, refunds and reversals, and must return exactly true.
 */
export async function issueAuthorizedMuxPlayback({viewer,lessonId,loadLesson,authorizeViewer,
 signingKeyId,privateKeyBase64,ttlSeconds=900,purpose='video',nowSeconds=Math.floor(Date.now()/1000)}={}){
 if(!['video','thumbnail'].includes(purpose))throw reject('INVALID_PLAYBACK_PURPOSE',503);
 if(!viewer||typeof viewer.id!=='string'||viewer.id.length===0)throw reject('AUTH_REQUIRED',401);
 if(typeof lessonId!=='string'||!idPattern.test(lessonId))throw reject('LESSON_NOT_FOUND',404);
 if(typeof loadLesson!=='function'||typeof authorizeViewer!=='function')throw reject('PLAYBACK_BACKEND_UNAVAILABLE',503);
 if(!Number.isSafeInteger(nowSeconds)||nowSeconds<1||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>900)
  throw reject('INVALID_PLAYBACK_LIFETIME',503);
 const lesson=await loadLesson(lessonId);
 if(!lesson||lesson.id!==lessonId)throw reject('LESSON_NOT_FOUND',404);
 if(lesson.status!=='published'||lesson.videoStatus!=='ready'||lesson.playbackPolicy!=='signed'||
   typeof lesson.playbackId!=='string'||!idPattern.test(lesson.playbackId))
  throw reject('PLAYBACK_UNAVAILABLE',403);
 if(await authorizeViewer({viewer,lesson,lessonId})!==true)throw reject('PLAYBACK_FORBIDDEN',403);
 if(typeof signingKeyId!=='string'||!idPattern.test(signingKeyId)||
  typeof privateKeyBase64!=='string'||privateKeyBase64.trim().length===0)
  throw reject('MUX_SIGNING_UNAVAILABLE',503);
 let privateKey;
 try{
  const pem=Buffer.from(privateKeyBase64,'base64').toString('utf8');
  privateKey=createPrivateKey(pem);
  if(privateKey.asymmetricKeyType!=='rsa'||(privateKey.asymmetricKeyDetails?.modulusLength??0)<2048)
   throw Error('weak or non-RSA signing key');
 }catch{throw reject('MUX_SIGNING_UNAVAILABLE',503);}
 const entitlementExpiry=lesson.entitlementExpiresAt;
 if(entitlementExpiry!==undefined&&entitlementExpiry!==null&&(!Number.isSafeInteger(entitlementExpiry)||entitlementExpiry<=nowSeconds))
  throw reject('PLAYBACK_FORBIDDEN',403);
 const expiresAt=entitlementExpiry==null?nowSeconds+ttlSeconds:Math.min(nowSeconds+ttlSeconds,entitlementExpiry);
 const header={alg:'RS256',typ:'JWT',kid:signingKeyId};
 const claims={sub:lesson.playbackId,aud:purpose==='thumbnail'?'t':'v',exp:expiresAt,kid:signingKeyId,...(purpose==='thumbnail'?{width:320,time:0}:{})};
 const input=[base64url(header),base64url(claims)].join('.');
 const signature=sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
 const token=[input,signature].join('.');
 const url=new URL(purpose==='thumbnail'?'https://image.mux.com/'+lesson.playbackId+'/thumbnail.jpg':'https://stream.mux.com/'+lesson.playbackId+'.m3u8');
 url.searchParams.set('token',token);
 return Object.freeze({url:url.toString(),expiresAt});
}
