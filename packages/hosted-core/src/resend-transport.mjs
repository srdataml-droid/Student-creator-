import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const emailPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const validEmail=e=>typeof e==='string'&&e.length<=254&&emailPattern.test(e);
const unavailable=()=>new Error('Email delivery unavailable');
export function createResendTransport({apiKey,fromEmail,allowedRecipients,fetcher=fetch}={}){
 if(typeof apiKey!=='string'||!/^re_[A-Za-z0-9_-]{8,256}$/.test(apiKey)||!validEmail(fromEmail)||
 !Array.isArray(allowedRecipients)||allowedRecipients.length===0||allowedRecipients.some(x=>!validEmail(x)))throw unavailable();
 const allowed=new Set(allowedRecipients.map(e=>e.trim().toLowerCase()));
 return {async send({to,subject,text,idempotencyKey}){
  if(!validEmail(to)||!allowed.has(to.toLowerCase())||typeof subject!=='string'||subject.length<1||subject.length>120||
   /[\r\n]/.test(subject)||typeof text!=='string'||text.length<1||text.length>10000||
   typeof idempotencyKey!=='string'||!/^[A-Za-z0-9/_-]{16,200}$/.test(idempotencyKey))throw unavailable();
  const r=await fetcher('https://api.resend.com/emails',{method:'POST',
   headers:{authorization:'Bearer '+apiKey,'content-type':'application/json','idempotency-key':idempotencyKey},
   body:JSON.stringify({from:'Worthkind Student Creators <'+fromEmail+'>',to:[to],subject,text}),
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(1800)});
  if(!r.ok)throw unavailable();
  const data=JSON.parse(await readBoundedGatewayResponse(r,65536,unavailable));
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(data?.id??''))throw unavailable();
  return {id:data.id};
 }};
}
