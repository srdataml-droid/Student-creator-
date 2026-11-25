import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {createClassTokenIssuer} from '../../local-core/src/livekit-class-tokens.mjs';
import {createLiveKitRoomService} from '../../local-core/src/livekit-room-service.mjs';
import {readSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,REF='jnkqmlbkkvccnxrgkpno';
const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
const unavailable=()=>new Error('Hosted LiveKit unavailable');
export function createHostedClassTokenHandler({auth,loadGrant,issuer,roomService,origin}={}){
 return async(request,{classId}={})=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(request.headers.get('origin')!==origin)return json(403,{error:'ORIGIN_FORBIDDEN'});
  if(request.body)return json(400,{error:'UNEXPECTED_BODY'});
  if(!UUID.test(classId??''))return json(404,{error:'CLASS_UNAVAILABLE'});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return json(401,{error:'AUTH_REQUIRED'});
  try{
   const user=await auth.getUser(token);if(!user)return json(401,{error:'AUTH_REQUIRED'});
   const grant=await loadGrant(user.id,classId);
   if(!grant||grant.room!=='wk-class-'+classId||grant.identity!=='student-'+user.id||!['host','participant'].includes(grant.role)||!Number.isInteger(grant.capacity)||grant.capacity<2||grant.capacity>50)return json(403,{error:'CLASS_ACCESS_FORBIDDEN'});
   if(grant.role==='host')await roomService.createRoom(grant.room,{capacity:grant.capacity});
   // Recheck after provider operation before minting a short-lived grant.
   const current=await loadGrant(user.id,classId);
   if(!current||current.room!==grant.room||current.identity!==grant.identity||current.role!==grant.role||current.capacity!==grant.capacity)return json(403,{error:'CLASS_ACCESS_FORBIDDEN'});
   const result=await issuer.issue(current);
   return json(200,{classId,role:current.role,url:result.url,token:result.token,expiresAt:result.expiresAt});
  }catch{return json(503,{error:'LIVEKIT_UNAVAILABLE'});}
 };
}
export function buildHostedClassTokenRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async(request,context)=>{
  try{
   const env=getEnv();
   if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_PROJECT_REF!==REF||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||env.STUDENT_CREATORS_LIVEKIT_TEST_ENABLED!=='true')throw unavailable();
   const config=readSupabaseRuntimeConfig(env,{server:true});
   if(!config||config.url!=='https://'+REF+'.supabase.co')throw unavailable();
   function alias(names){const vals=names.map(n=>env[n]).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim());if(vals.some(v=>v!==vals[0]))throw unavailable();return vals[0];}
   const origin=env.STUDENT_CREATORS_LIVEKIT_ORIGIN;const parsed=new URL(origin);
   if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)throw unavailable();
   const raw=alias(['LIVEKIT_URL','livekit_project_url']);
   const url=raw?.startsWith('https://')?'wss://'+raw.slice(8):raw;
   const apiKey=alias(['LIVEKIT_API_KEY','livekit_apikey']),apiSecret=alias(['LIVEKIT_API_SECRET','livekit_api_secret']);
   const issuer=createClassTokenIssuer({url,apiKey,apiSecret,ttlSeconds:120});
   const roomService=createLiveKitRoomService({url,apiKey,apiSecret,fetchImpl:fetcher});
   const auth=createCurrentSupabaseAuth({url:config.url,publicKey:config.publishableKey,serverKey:config.serverKey,requireStudent:true,fetcher});
   const loadGrant=async(actor,classId)=>{const r=await fetcher(new URL('/rest/v1/rpc/authorized_hosted_class_room',config.url),{method:'POST',headers:{...supabaseServerHeaders(config.serverKey),'content-type':'application/json'},body:JSON.stringify({_actor:actor,_class:classId}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw unavailable();return r.json();};
   return await createHostedClassTokenHandler({auth,loadGrant,issuer,roomService,origin})(request,context);
  }catch{return json(503,{error:'LIVEKIT_UNAVAILABLE'});}
 };
}
