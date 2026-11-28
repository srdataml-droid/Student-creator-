import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {createClassTokenIssuer} from '../../livekit-provider/src/livekit-class-tokens.mjs';
import {createLiveKitRoomService} from '../../livekit-provider/src/livekit-room-service.mjs';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const unavailable=()=>new Error('Hosted LiveKit unavailable');
function alias(env,names){const vals=names.map(n=>env[n]).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim());if(vals.some(v=>v!==vals[0]))throw unavailable();return vals[0];}
export function createHostedLearningRuntime({env=process.env,fetcher=fetch}={}){
 if(env.STUDENT_CREATORS_ENVIRONMENT!=='production'||env.STUDENT_CREATORS_LIVEKIT_ENABLED!=='true'||env.STUDENT_CREATORS_LIVEKIT_TEST_ENABLED==='true'||env.STUDENT_CREATORS_PAYSTACK_TEST_ENABLED==='true')throw unavailable();
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});if(!cfg)throw unavailable();
 const origin=env.STUDENT_CREATORS_LIVEKIT_ORIGIN;const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)throw unavailable();
 const raw=alias(env,['LIVEKIT_URL','livekit_project_url']);const url=raw?.startsWith('https://')?'wss://'+raw.slice(8):raw;
 const apiKey=alias(env,['LIVEKIT_API_KEY','livekit_apikey']),apiSecret=alias(env,['LIVEKIT_API_SECRET','livekit_api_secret']);
 const issuer=createClassTokenIssuer({url,apiKey,apiSecret,ttlSeconds:120});
 const roomService=createLiveKitRoomService({url,apiKey,apiSecret,fetchImpl:fetcher});
 const auth=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,requireStudent:true,fetcher});
 async function rpc(name,body){const r=await fetcher(new URL('/rest/v1/rpc/'+name,cfg.url),{method:'POST',headers:{...supabaseServerHeaders(cfg.serverKey),'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw unavailable();return JSON.parse(await readBoundedGatewayResponse(r,65536,unavailable));}
 return {origin,issuer,roomService,auth,loadGrant:(actor,id)=>rpc('authorized_hosted_class_room',{_actor:actor,_class:id}),markReady:(actor,id)=>rpc('mark_hosted_class_ready',{_actor:actor,_class:id}),recordPresence:(id,c,u,kind)=>rpc('record_hosted_class_presence',{_event:id,_class:c,_actor:u,_kind:kind}),claimCleanup:()=>rpc('claim_hosted_learning_cleanup',{}),finishCleanup:(job,success)=>rpc('finish_hosted_learning_cleanup',{_class:job.classId,_student:job.studentId??null,_lease:job.lease,_success:success})};
}
function validGrant(grant,actor,id,clock){return grant&&grant.room==='wk-class-'+id&&grant.identity==='student-'+actor&&['host','participant'].includes(grant.role)&&Number.isInteger(grant.capacity)&&grant.capacity>=2&&grant.capacity<=50&&Number.isFinite(Date.parse(grant.endsAt))&&Date.parse(grant.endsAt)>clock()+120000&&(grant.role==='host'||grant.ready===true);}
export function createHostedClassTokenHandler({auth,loadGrant,markReady,issuer,roomService,origin,clock=()=>Date.now()}={}){
 return async(request,{classId}={})=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(request.headers.get('origin')!==origin)return json(403,{error:'ORIGIN_FORBIDDEN'});
  if(request.body)return json(400,{error:'UNEXPECTED_BODY'});
  if(!UUID.test(classId??''))return json(404,{error:'CLASS_UNAVAILABLE'});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token||token.length>8192)return json(401,{error:'AUTH_REQUIRED'});
  try{
   const user=await auth.getUser(token);if(!user)return json(401,{error:'AUTH_REQUIRED'});
   const grant=await loadGrant(user.id,classId);if(!validGrant(grant,user.id,classId,clock))return json(403,{error:'CLASS_ACCESS_FORBIDDEN'});
   let room=grant.ready?await roomService.getRoom(grant.room):null;
   if(!room&&grant.role!=='host')return json(409,{error:'CLASS_ROOM_NOT_READY'});
   if(!room){
    room=await roomService.createRoom(grant.room,{capacity:grant.capacity});
    if(room?.name!==grant.room||(room.maxParticipants??room.max_participants)!==grant.capacity)throw unavailable();
    const fresh=await auth.getUser(token);if(fresh?.id!==user.id||await markReady(user.id,classId)!==true)return json(403,{error:'CLASS_ACCESS_FORBIDDEN'});
   }
   if(room?.name!==grant.room||(room.maxParticipants??room.max_participants)!==grant.capacity)throw unavailable();
   const currentUser=await auth.getUser(token);if(currentUser?.id!==user.id)return json(401,{error:'AUTH_REQUIRED'});
   const current=await loadGrant(user.id,classId);
   if(!validGrant(current,user.id,classId,clock)||current.ready!==true||current.role!==grant.role||current.capacity!==grant.capacity)return json(403,{error:'CLASS_ACCESS_FORBIDDEN'});
   const result=await issuer.issue(current);
   return json(200,{classId,role:current.role,url:result.url,token:result.token,expiresAt:result.expiresAt});
  }catch{return json(503,{error:'LIVEKIT_UNAVAILABLE'});}
 };
}
export function buildHostedClassTokenRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async(request,context)=>{try{return await createHostedClassTokenHandler(createHostedLearningRuntime({env:getEnv(),fetcher}))(request,context);}catch{return json(503,{error:'LIVEKIT_UNAVAILABLE'});}};
}
async function rawBody(request){const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');const parts=[];let bytes=0;try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>262144)throw Error('BODY_TOO_LARGE');parts.push(Buffer.from(item.value));}return Buffer.concat(parts);}catch(e){void reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}}
export function createHostedLearningWebhook({roomService,recordPresence,loadGrant,clock=()=>Date.now()}={}){
 return async request=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(Number(request.headers.get('content-length')||0)>262144)return json(413,{error:'BODY_TOO_LARGE'});
  let event;
  try{event=roomService.verifyWebhook(await rawBody(request),request.headers.get('authorization'));}catch(e){return json(e.message==='BODY_TOO_LARGE'?413:401,{error:'WEBHOOK_UNVERIFIED'});}
  const kind={participant_joined:'joined',participant_left:'left'}[event.event];
  if(!kind)return json(200,{accepted:true});
  const room=event.room?.name,identity=event.participant?.identity,id=event.id;
  if(typeof room!=='string'||!room.startsWith('wk-class-')||!UUID.test(room.slice(9))||typeof identity!=='string'||!identity.startsWith('student-')||!UUID.test(identity.slice(8))||typeof id!=='string'||id.length<8||id.length>128)return json(200,{accepted:true});
  try{const recorded=await recordPresence(id,room.slice(9),identity.slice(8),kind);if(recorded===false&&kind==='joined'&&loadGrant&&!(await loadGrant(identity.slice(8),room.slice(9))))await roomService.removeParticipant(room,identity,{revokeTokenTs:Math.floor(clock()/1000)});return json(200,{accepted:true});}catch{return json(503,{error:'PRESENCE_UNAVAILABLE'});}
 };
}
export function buildHostedLearningWebhook({getEnv=()=>process.env,fetcher=fetch}={}){return async request=>{try{return await createHostedLearningWebhook(createHostedLearningRuntime({env:getEnv(),fetcher}))(request);}catch{return json(503,{error:'LIVEKIT_UNAVAILABLE'});}};}
export async function processHostedLearningCleanup({claimCleanup,finishCleanup,roomService,clock=()=>Date.now()}){
 const job=await claimCleanup();if(job===null)return {state:'empty'};
 if(!UUID.test(job?.classId??'')||!UUID.test(job?.lease??'')||job.room!=='wk-class-'+job.classId||!['room','participant'].includes(job.kind))throw unavailable();
 let ok=false;
 try{if(job.kind==='room')await roomService.deleteRoom(job.room);else{if(!UUID.test(job.studentId??'')||job.identity!=='student-'+job.studentId||!Number.isSafeInteger(job.revokeTokenTs)||job.revokeTokenTs<1)throw unavailable();await roomService.removeParticipant(job.room,job.identity,{revokeTokenTs:Math.floor(clock()/1000)});}ok=true;}catch{}
 if(await finishCleanup(job,ok)!==true)throw unavailable();
 return {state:ok?'processed':'retry'};
}
