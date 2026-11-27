import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const fail=()=>new Error('PAYOUT_BANK_ENCRYPTION_UNAVAILABLE');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function key(raw){if(typeof raw!=='string'||!/^[0-9a-f]{64}$/i.test(raw))throw fail();return Buffer.from(raw,'hex');}
function aad(actor,id){if(!uuid.test(actor??'')||!uuid.test(id??''))throw fail();return Buffer.from('student-creators:payout-bank:v1:'+actor+':'+id);}
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='accountName,accountNumber,bankCode'||typeof value.bankCode!=='string'||!/^\d{3,6}$/.test(value.bankCode)||typeof value.accountNumber!=='string'||!/^\d{10}$/.test(value.accountNumber)||typeof value.accountName!=='string'||!value.accountName.trim()||value.accountName.length>180||/[\x00-\x1f\x7f]/.test(value.accountName))throw fail();
 return {bankCode:value.bankCode,accountNumber:value.accountNumber,accountName:value.accountName};
}
export function sealPayoutBank({secret,actor,id,value}){
 try{
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(aad(actor,id));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(validate(value)),'utf8'),cipher.final()]);
  return ['v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.');
 }catch{throw fail();}
}
export function openPayoutBank({secret,actor,id,envelope}){
 try{
  if(typeof envelope!=='string'||envelope.length>2048||!/^v1\.[a-f0-9]{24}\.[a-f0-9]{32}\.(?:[a-f0-9]{2})+$/.test(envelope))throw fail();
  const [,iv,tag,encrypted]=envelope.split('.');
  const cipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'hex'));
  cipher.setAAD(aad(actor,id));cipher.setAuthTag(Buffer.from(tag,'hex'));
  return validate(JSON.parse(Buffer.concat([cipher.update(Buffer.from(encrypted,'hex')),cipher.final()]).toString('utf8')));
 }catch{throw fail();}
}
