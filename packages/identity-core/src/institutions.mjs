/**
 * Institution adapters run on a trusted server only. No institution is
 * connected or enabled merely by importing this file. Never accept a card
 * photograph, an email domain, a browser claim, or raw JWT/SAML XML as proof.
 * Approval/roster permissions must be established with each institution.
 */
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

const verified=new WeakSet();
const identityError=(code)=>Object.assign(new Error(code),{code,status:403});
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const ID=/^[A-Za-z0-9_.:-]{3,128}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const ROLES=new Set(['student','alumni','lecturer']);
const STATES=new Set(['active','suspended','graduated','inactive']);
const MAX_PROOF_AGE=7*24*3600; // institutional authorization expires within seven days
const fields=['institutionId','providerId','requestId','subjectDigest','role','state','issuedAt','expiresAt'];
const int=(n)=>Number.isSafeInteger(n)&&n>0;

function assertId(value){if(typeof value!=='string'||!ID.test(value))throw identityError('IDENTITY_INVALID_PROVIDER');return value;}
function assertConfig({institutionId,providerId,secret}){
 if(typeof institutionId!=='string'||!UUID.test(institutionId))throw identityError('IDENTITY_INVALID_INSTITUTION');
 assertId(providerId);
 if(typeof secret!=='string'||secret.length<32||secret.length>512)throw identityError('IDENTITY_UNAVAILABLE');
}
function mac(secret,text){return createHmac('sha256',secret).update(text).digest('hex');}
function canonical(evidence){return JSON.stringify(fields.map(name=>evidence[name]));}
function sealed(input,now){
 const p=Object.fromEntries(fields.map(key=>[key,input?.[key]]));
 if(!UUID.test(String(p.institutionId))||!ID.test(String(p.providerId))||!UUID.test(String(p.requestId))||
   !DIGEST.test(String(p.subjectDigest))||!ROLES.has(p.role)||!STATES.has(p.state)||
   !int(p.issuedAt)||!int(p.expiresAt)||p.issuedAt>now+30||p.expiresAt<=now||
   p.expiresAt-p.issuedAt>MAX_PROOF_AGE)
   throw identityError('IDENTITY_INVALID_EVIDENCE');
 const result=Object.freeze({...p,eligible:p.role==='student'&&p.state==='active'});
 verified.add(result);
 return result;
}
export function isVerifiedInstitutionEvidence(value){return Boolean(value&&typeof value==='object'&&verified.has(value));}
/** Private peppered digest; never store bare student IDs or unkeyed ID hashes. */
export function institutionalSubjectDigest(secret,institutionId,subject){
 assertConfig({institutionId,providerId:'subject-digest',secret});
 if(typeof subject!=='string'||subject.length<3||subject.length>256)throw identityError('IDENTITY_INVALID_SUBJECT');
 return mac(secret,'student-creators:institution-subject:v1:'+institutionId+':'+subject.trim().normalize('NFKC'));
}
export function validateInstitutionRegistryEntry(entry){
 if(typeof entry!=='object'||!entry||!UUID.test(String(entry.institutionId))||!ID.test(String(entry.providerId))||
  !['synthetic','rest','oidc','saml','roster'].includes(entry.kind))
  throw identityError('IDENTITY_INVALID_PROVIDER');
 const config={institutionId:entry.institutionId,providerId:entry.providerId,kind:entry.kind,
   issuer:String(entry.issuer??''),audience:String(entry.audience??''),endpoint:String(entry.endpoint??'')};
 if((entry.kind==='rest'||entry.kind==='oidc'||entry.kind==='saml')&&(!config.issuer||!config.audience))
  throw identityError('IDENTITY_INVALID_PROVIDER');
 if(entry.kind==='rest'){
  let url;try{url=new URL(config.endpoint);}catch{throw identityError('IDENTITY_INVALID_PROVIDER');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||
    (!/^[a-z0-9.-]+$/i.test(url.hostname)||isIP(url.hostname)!==0||/^(localhost|.*\.(localhost|local|internal|onion)$)/i.test(url.hostname)))
    throw identityError('IDENTITY_INVALID_PROVIDER');
 }
 if([config.issuer,config.audience,config.endpoint].some(v=>v.length>1024||/[\r\n]/.test(v)))
  throw identityError('IDENTITY_INVALID_PROVIDER');
 return Object.freeze(config);
}
/** Sign only for synthetic fixture or institution-issued REST/roster messages.
 * Signing never happens in an endpoint accessible to students.
 */
export function signSyntheticInstitutionAssertion(secret,payload){
 if(typeof secret!=='string'||secret.length<32)throw identityError('IDENTITY_UNAVAILABLE');
 return mac(secret,canonical(payload));
}
export function verifySignedInstitutionAssertion({config,secret,payload,signature,requestId,now=Math.floor(Date.now()/1000)}){
 assertConfig({...config,secret});
 if(!UUID.test(String(requestId))||typeof signature!=='string'||!DIGEST.test(signature))
  throw identityError('IDENTITY_BAD_SIGNATURE');
 const expected=mac(secret,canonical(payload??{}));
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))
  throw identityError('IDENTITY_BAD_SIGNATURE');
 if(payload?.providerId!==config.providerId||payload?.institutionId!==config.institutionId||
   payload?.requestId!==requestId)
  throw identityError('IDENTITY_RESPONSE_MISMATCH');
 return sealed(payload,now);
}
export function makeSyntheticInstitutionProvider({config,secret,roster,clock=()=>Math.floor(Date.now()/1000)}){
 if(config.kind!=='synthetic')throw identityError('IDENTITY_INVALID_PROVIDER');
 assertConfig({...config,secret});
 if(!(roster instanceof Map))throw identityError('IDENTITY_UNAVAILABLE');
 return Object.freeze({
   async verify({subjectDigest,requestId=randomUUID()}){
     if(!DIGEST.test(subjectDigest)||!UUID.test(requestId))throw identityError('IDENTITY_INVALID_SUBJECT');
     const record=roster.get(subjectDigest);
     if(!record)throw identityError('IDENTITY_NOT_FOUND');
     const now=clock(),payload={institutionId:config.institutionId,providerId:config.providerId,
       requestId,subjectDigest,role:record.role,state:record.state,issuedAt:now,expiresAt:now+3600};
     return verifySignedInstitutionAssertion({config,secret,payload,requestId,signature:signSyntheticInstitutionAssertion(secret,payload),now});
   }
 });
}
/** Authenticated server-to-server REST adapter; rejects redirects and PII bodies. */
export function makeAuthorizedRestProvider({config,secret,serverToken,fetchImpl=fetch,clock=()=>Math.floor(Date.now()/1000)}){
 validateInstitutionRegistryEntry(config);assertConfig({...config,secret});
 if(config.kind!=='rest'||typeof serverToken!=='string'||serverToken.length<32||typeof fetchImpl!=='function')
  throw identityError('IDENTITY_UNAVAILABLE');
 return Object.freeze({
  async verify({subjectDigest,requestId=randomUUID()}){
   if(!DIGEST.test(subjectDigest)||!UUID.test(requestId))throw identityError('IDENTITY_INVALID_SUBJECT');
   const response=await fetchImpl(config.endpoint,{method:'POST',redirect:'error',
     headers:{'content-type':'application/json','accept':'application/json','authorization':'Bearer '+serverToken},
     body:JSON.stringify({institutionId:config.institutionId,providerId:config.providerId,subjectDigest,requestId}),
     signal:AbortSignal.timeout(4000)});
   if(!response?.ok||!String(response.headers?.get('content-type')??'').startsWith('application/json'))
     throw identityError('IDENTITY_PROVIDER_UNAVAILABLE');
   const bodyStream=response.body;
   if(!bodyStream||typeof bodyStream.getReader!=='function')throw identityError('IDENTITY_PROVIDER_UNAVAILABLE');
   const length=Number(response.headers?.get('content-length')||0);
   if(!Number.isSafeInteger(length)||length>8192)throw identityError('IDENTITY_PROVIDER_UNAVAILABLE');
   const reader=bodyStream.getReader(),pieces=[];
   let count=0;
   try{
     while(true){
       const {done,value}=await reader.read();
       if(done)break;
       count+=value.byteLength;
       if(count>8192){await reader.cancel();throw identityError('IDENTITY_PROVIDER_UNAVAILABLE');}
       pieces.push(value);
     }
   }finally{reader.releaseLock();}
   let signed;
   try{
     const bytes=new Uint8Array(count);let pos=0;
     for(const piece of pieces){bytes.set(piece,pos);pos+=piece.length;}
     signed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   }catch{throw identityError('IDENTITY_PROVIDER_UNAVAILABLE');}
   return verifySignedInstitutionAssertion({config,secret,payload:signed.payload,signature:signed.signature,requestId,now:clock()});
  }
 });
}
/** The callback must cryptographically verify JWT signature via a reviewed OIDC
 * client and bound JWKS. A decoded-but-unverified JWT must never be accepted.
 */
export async function verifyOidcInstitutionToken({config,idToken,nonce,verifyJwt,now=Math.floor(Date.now()/1000)}){
 validateInstitutionRegistryEntry(config);
 if(config.kind!=='oidc'||typeof idToken!=='string'||!idToken||
   !UUID.test(String(nonce))||typeof verifyJwt!=='function')throw identityError('IDENTITY_UNAVAILABLE');
 const result=await verifyJwt({idToken,issuer:config.issuer,audience:config.audience,nonce});
 if(result?.signatureVerified!==true)throw identityError('IDENTITY_BAD_SIGNATURE');
 const c=result.claims;
 if(c?.iss!==config.issuer||c?.aud!==config.audience||c?.nonce!==nonce||
   !int(c?.iat)||!int(c?.exp)||c.exp<=now||c.iat>now+30)
   throw identityError('IDENTITY_RESPONSE_MISMATCH');
 return sealed({institutionId:config.institutionId,providerId:config.providerId,
   requestId:nonce,subjectDigest:c.subject_digest,role:c.affiliation_role,
   state:c.enrollment_state,issuedAt:c.iat,expiresAt:c.exp},now);
}
/** The verifier must validate trusted issuer certificate, XML signature,
 * InResponseTo, destination, audience and conditions. No XML is parsed here.
 */
export async function verifySamlInstitutionResponse({config,samlResponse,requestId,destination,verifySignedAssertion,now=Math.floor(Date.now()/1000)}){
 validateInstitutionRegistryEntry(config);
 if(config.kind!=='saml'||typeof samlResponse!=='string'||!samlResponse||
   !UUID.test(String(requestId))||typeof verifySignedAssertion!=='function'||!destination)
   throw identityError('IDENTITY_UNAVAILABLE');
 const result=await verifySignedAssertion({samlResponse,issuer:config.issuer,audience:config.audience,requestId,destination});
 if(result?.signatureVerified!==true||result?.issuer!==config.issuer||result?.audience!==config.audience||
   result?.inResponseTo!==requestId||result?.destination!==destination)
   throw identityError('IDENTITY_BAD_SIGNATURE');
 return sealed({institutionId:config.institutionId,providerId:config.providerId,
   requestId,subjectDigest:result.subjectDigest,role:result.role,state:result.state,
   issuedAt:result.issuedAt,expiresAt:result.expiresAt},now);
}


/** Institution-approved signed roster snapshot contract.
 * Each record is a keyed digest, never raw student number, name, photo, or
 * email. It only becomes an eligibility assertion when a separate matching
 * institutional verification request is made; never auto-verify signups.
 * Production roster signing and secure transfer need written institution consent.
 */
export function signSyntheticRosterSnapshot(secret,snapshot){
 if(typeof secret!=='string'||secret.length<32)throw identityError('IDENTITY_UNAVAILABLE');
 return mac(secret,JSON.stringify([
  snapshot?.institutionId,snapshot?.providerId,snapshot?.issuedAt,snapshot?.expiresAt,snapshot?.entries
 ]));
}
export function verifyAuthorizedRosterSnapshot({config,secret,snapshot,signature,now=Math.floor(Date.now()/1000)}){
 validateInstitutionRegistryEntry(config);
 if(config.kind!=='roster')throw identityError('IDENTITY_INVALID_PROVIDER');
 assertConfig({...config,secret});
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
  snapshot.institutionId!==config.institutionId||snapshot.providerId!==config.providerId||
  !int(snapshot.issuedAt)||!int(snapshot.expiresAt)||snapshot.issuedAt>now+30||
  snapshot.expiresAt<=now||snapshot.expiresAt-snapshot.issuedAt>MAX_PROOF_AGE||
  !Array.isArray(snapshot.entries)||snapshot.entries.length<1||snapshot.entries.length>1000||
  typeof signature!=='string'||!DIGEST.test(signature))
  throw identityError('IDENTITY_INVALID_ROSTER');
 const expected=signSyntheticRosterSnapshot(secret,snapshot);
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))
  throw identityError('IDENTITY_BAD_SIGNATURE');
 const members=new Map();
 for(const row of snapshot.entries){
  if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='role,state,subjectDigest'||
    !DIGEST.test(row.subjectDigest)||!ROLES.has(row.role)||!STATES.has(row.state)||
    members.has(row.subjectDigest))
   throw identityError('IDENTITY_INVALID_ROSTER');
  members.set(row.subjectDigest,{role:row.role,state:row.state});
 }
 return Object.freeze({
  providerId:config.providerId,institutionId:config.institutionId,validUntil:snapshot.expiresAt,
  // Read-only lookup, no public roster member enumeration.
  verify({subjectDigest,requestId=randomUUID()}){
   if(!DIGEST.test(subjectDigest)||!UUID.test(requestId))throw identityError('IDENTITY_INVALID_SUBJECT');
   if(Math.floor(Date.now()/1000)>=snapshot.expiresAt)throw identityError('IDENTITY_EXPIRED_ROSTER');
   const entry=members.get(subjectDigest);
   if(!entry)throw identityError('IDENTITY_NOT_FOUND');
   const issuedAt=Math.floor(Date.now()/1000);
   return verifySignedInstitutionAssertion({config,secret,
    payload:{institutionId:config.institutionId,providerId:config.providerId,
     requestId,subjectDigest,role:entry.role,state:entry.state,
     issuedAt,expiresAt:Math.min(snapshot.expiresAt,issuedAt+3600)},
    signature:signSyntheticInstitutionAssertion(secret,{institutionId:config.institutionId,providerId:config.providerId,
     requestId,subjectDigest,role:entry.role,state:entry.state,
     issuedAt,expiresAt:Math.min(snapshot.expiresAt,issuedAt+3600)}),
    requestId,now:issuedAt});
  }
 });
}
