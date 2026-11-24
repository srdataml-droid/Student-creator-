/**
 * Verify Mux webhook provenance using raw bytes BEFORE parsing event JSON.
 * Reference: https://www.mux.com/docs/core/verify-webhook-signatures
 * This module has no network calls or env access. A hosted HTTP handler must
 * use a dedicated per-webhook signing secret, never a playback RSA private key,
 * Mux API token or client-provided secret. It must persist event IDs through
 * a transactional idempotency inbox before applying asset-state changes.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});
const EVENT_ID=/^[A-Za-z0-9_-]{3,128}$/;
const MAX_BYTES=262144;
function rawBytes(value){
 if(Buffer.isBuffer(value))return value;
 if(value instanceof Uint8Array)return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 if(typeof value==='string')return Buffer.from(value,'utf8');
 throw fail('MUX_WEBHOOK_RAW_BODY_REQUIRED');
}

/** Returns an immutable, sanitized event envelope, never arbitrary event data. */
export function verifyMuxWebhookEnvelope({rawBody,signatureHeader,webhookSecret,
 nowSeconds=Math.floor(Date.now()/1000),toleranceSeconds=300}={}){
 if(typeof webhookSecret!=='string'||webhookSecret.length<12)
  throw fail('MUX_WEBHOOK_SECRET_UNAVAILABLE',503);
 if(!Number.isSafeInteger(nowSeconds)||nowSeconds<1||
   !Number.isSafeInteger(toleranceSeconds)||toleranceSeconds<0||toleranceSeconds>300)
  throw fail('MUX_WEBHOOK_CLOCK_INVALID',503);
 const bytes=rawBytes(rawBody);
 if(bytes.length===0||bytes.length>MAX_BYTES)throw fail('MUX_WEBHOOK_BODY_SIZE_INVALID',413);
 if(typeof signatureHeader!=='string'||signatureHeader.length>1024)
  throw fail('MUX_WEBHOOK_SIGNATURE_MISSING');
 const parts=signatureHeader.split(',');
 let timestamp=null;
 const signatures=[];
 for(const part of parts){
  const split=part.trim().split('=');
  if(split.length!==2)throw fail('MUX_WEBHOOK_SIGNATURE_INVALID');
  const [key,value]=split;
  if(key==='t'){
   if(timestamp!==null||!/^[0-9]{10,11}$/.test(value))throw fail('MUX_WEBHOOK_SIGNATURE_INVALID');
   timestamp=value;
  }else if(key==='v1'){
   if(!/^[a-fA-F0-9]{64}$/.test(value))throw fail('MUX_WEBHOOK_SIGNATURE_INVALID');
   signatures.push(Buffer.from(value,'hex'));
  }else{
   // Unknown signature schemes are not trusted.
   throw fail('MUX_WEBHOOK_SIGNATURE_INVALID');
  }
 }
 if(!timestamp||signatures.length===0)throw fail('MUX_WEBHOOK_SIGNATURE_INVALID');
 const signed=Buffer.concat([Buffer.from(timestamp+'.','utf8'),bytes]);
 const expected=createHmac('sha256',webhookSecret).update(signed).digest();
 if(!signatures.some(sig=>sig.length===expected.length&&timingSafeEqual(sig,expected)))
  throw fail('MUX_WEBHOOK_SIGNATURE_INVALID');
 const ts=Number(timestamp);
 if(!Number.isSafeInteger(ts)||Math.abs(nowSeconds-ts)>toleranceSeconds)
  throw fail('MUX_WEBHOOK_TIMESTAMP_EXPIRED');
 let body;
 try{body=JSON.parse(bytes.toString('utf8'));}
 catch{throw fail('MUX_WEBHOOK_JSON_INVALID');}
 if(!body||typeof body!=='object'||Array.isArray(body)||
  !EVENT_ID.test(body.id??'')||typeof body.type!=='string'||body.type.length>128)
  throw fail('MUX_WEBHOOK_ENVELOPE_INVALID');
 // Never mark an asset ready based solely on user-provided IDs: hosted handler
 // must match event.data.id to server-owned asset and playback policy.
 return Object.freeze({eventId:body.id,type:body.type,receivedAt:ts,
  assetId:typeof body.data?.id==='string'&&EVENT_ID.test(body.data.id)?body.data.id:null});
}
