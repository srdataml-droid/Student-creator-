/** Strict Paystack-Signature (v1) verification on the exact raw bytes.
 * Signing secrets are independent from sk_test/sk_live API secrets.
 * Signature proves sender authenticity only; always verify the transaction with
 * the provider API before granting an entitlement or writing the payment journal.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';
const MAX_BYTES=1024*1024,MAX_HEADER=4096,MAX_SIGNATURES=8,WINDOW_SECONDS=300;
export function verifyPaystackWebhookV1(rawBody,header,signingSecrets,{nowSeconds=Math.floor(Date.now()/1000)}={}){
 const raw=Buffer.isBuffer(rawBody)?rawBody:typeof rawBody==='string'?Buffer.from(rawBody,'utf8'):null;
 if(!raw||raw.length===0||raw.length>MAX_BYTES||typeof header!=='string'||!header||header.length>MAX_HEADER||
    !Array.isArray(signingSecrets)||!signingSecrets.length||signingSecrets.length>MAX_SIGNATURES||
    !Number.isSafeInteger(nowSeconds)||nowSeconds<0)return null;
 let ts=null,tCount=0;const candidates=[];
 for(const part of header.split(',')){
  const trimmed=part.trim(),pos=trimmed.indexOf('=');
  if(pos<1)continue;
  const key=trimmed.slice(0,pos),value=trimmed.slice(pos+1);
  if(key==='t'){
   ++tCount;if(!/^[0-9]{1,13}$/.test(value))return null;
   const n=Number(value);if(!Number.isSafeInteger(n))return null;ts=n;
  }else if(key==='v1'){
   if(candidates.length>=MAX_SIGNATURES)return null;
   const n=value.indexOf(':');
   if(n<1)continue;
   const id=value.slice(0,n),sig=value.slice(n+1);
   if(/^whk_[A-Za-z0-9_-]{3,80}$/.test(id)&&/^[0-9a-f]{128}$/.test(sig))
    candidates.push({id,signature:Buffer.from(sig,'hex')});
  }
 }
 if(tCount!==1||ts===null||Math.abs(nowSeconds-ts)>WINDOW_SECONDS||!candidates.length)return null;
 const payload=Buffer.concat([Buffer.from(String(ts)+'.','utf8'),raw]);
 let matchId=null;
 for(const key of signingSecrets){
  if(typeof key?.id!=='string'||!/^whk_[A-Za-z0-9_-]{3,80}$/.test(key.id)||
     typeof key.secret!=='string'||!/^whsec_[A-Za-z0-9_-]{4,256}$/.test(key.secret))continue;
  const expected=createHmac('sha512',key.secret).update(payload).digest();
  for(const candidate of candidates){
   if(key.id===candidate.id&&timingSafeEqual(expected,candidate.signature))matchId=key.id;
  }
 }
 return matchId;
}
export function decodeVerifiedPaystackWebhookV1(rawBody,header,signingSecrets,options){
 const keyId=verifyPaystackWebhookV1(rawBody,header,signingSecrets,options);
 if(!keyId)throw Object.assign(new Error('INVALID_SIGNATURE'),{code:'INVALID_SIGNATURE'});
 let message;
 try{message=JSON.parse(Buffer.isBuffer(rawBody)?rawBody.toString('utf8'):rawBody);}
 catch{throw Object.assign(new Error('BAD_JSON'),{code:'BAD_JSON'});}
 if(!message||typeof message!=='object'||Array.isArray(message)||typeof message.event!=='string'||
   !message.data||typeof message.data!=='object'||Array.isArray(message.data))
  throw Object.assign(new Error('INVALID_EVENT'),{code:'INVALID_EVENT'});
 return Object.freeze({keyId,event:message.event,data:message.data});
}
