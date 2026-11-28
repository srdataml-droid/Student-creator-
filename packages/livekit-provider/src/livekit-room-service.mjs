/**
 * Week 6 server-only LiveKit room service and webhook verification.
 * Original minimal Twirp/HS256 implementation, no client credentials or external dependency.
 * Docs: https://docs.livekit.io/reference/other/roomservice-api/
 *       https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/
 * Not an assertion of provider acceptance until two real clients connect and stream.
 */
import {createHmac,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {readBoundedGatewayResponse} from '../../platform-core/src/bounded-response.mjs';

const fail=(code,status=503)=>Object.assign(Error(code),{code,status});
const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const CLASS_ROOM=/^wk-class-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY=/^student-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function endpoint(value){
  let url;
  try{url=new URL(value?.startsWith('wss://')?'https://'+value.slice(6):value);}catch{throw fail('LIVEKIT_NOT_CONFIGURED');}
  // Forbid SSRF through arbitrary user-selected URLs, userinfo, private IPs,
  // non-TLS transport, paths and query params. All values originate server env.
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     (url.pathname!=='/'&&url.pathname!=='')||url.port&&url.port!=='443'||
     !/^[a-z0-9.-]+$/i.test(url.hostname)||!url.hostname.includes('.')||
     /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname)||url.hostname.endsWith('.local'))
    throw fail('LIVEKIT_NOT_CONFIGURED');
  return url.origin;
}
function jwt(secret,key,payload){
  const data=enc({alg:'HS256',typ:'JWT'})+'.'+enc(payload);
  return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
}
export function createLiveKitRoomService({url,apiKey,apiSecret,clock=()=>Date.now(),fetchImpl=globalThis.fetch}={}){
  const base=endpoint(url);
  if(typeof apiKey!=='string'||apiKey.length<8||typeof apiSecret!=='string'||apiSecret.length<16||
     typeof fetchImpl!=='function')throw fail('LIVEKIT_NOT_CONFIGURED');
  function token(video){
    const n=Math.floor(clock()/1000);
    return jwt(apiSecret,apiKey,{iss:apiKey,iat:n,nbf:n-3,exp:n+90,jti:randomUUID(),video});
  }
  async function rpc(action,body,video,{allowMissing=false}={}){
    const target=base+'/twirp/livekit.RoomService/'+action;
    // No caller-controlled redirects or unbounded external requests.
    const signal=AbortSignal.timeout(8000);
    let response;
    try{
      response=await fetchImpl(target,{method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+token(video)},
        body:JSON.stringify(body),signal,redirect:'error'});
    }catch{throw fail('LIVEKIT_PROVIDER_UNAVAILABLE');}
    if(allowMissing&&response.status===404)return {alreadyGone:true};
    if(!response.ok)throw fail('LIVEKIT_PROVIDER_UNAVAILABLE');
    try{
      const value=JSON.parse(await readBoundedGatewayResponse(response,262144,()=>fail('LIVEKIT_PROVIDER_UNAVAILABLE')));
      if(!value||typeof value!=='object'||Array.isArray(value))throw fail('LIVEKIT_PROVIDER_UNAVAILABLE');
      return value;
    }catch{throw fail('LIVEKIT_PROVIDER_UNAVAILABLE');}
  }
  return {
    async createRoom(name,{capacity=12}={}){
      if(!CLASS_ROOM.test(name)||!Number.isInteger(capacity)||capacity<2||capacity>50)
        throw fail('INVALID_ROOM_GRANT',422);
      return rpc('CreateRoom',{name,maxParticipants:capacity,emptyTimeout:900,departureTimeout:90},{roomCreate:true});
    },
    async getRoom(name){
      if(!CLASS_ROOM.test(name))throw fail('INVALID_ROOM_GRANT',422);
      const result=await rpc('ListRooms',{names:[name]},{roomList:true});
      if(!result||typeof result!=='object'||Array.isArray(result))throw fail('LIVEKIT_PROVIDER_UNAVAILABLE');
      const rooms=result.rooms??[];
      if(!Array.isArray(rooms)||rooms.length>1||rooms.some(r=>r?.name!==name))throw fail('LIVEKIT_PROVIDER_UNAVAILABLE');
      return rooms[0]??null;
    },
    async deleteRoom(name){
      if(!CLASS_ROOM.test(name))throw fail('INVALID_ROOM_GRANT',422);
      return rpc('DeleteRoom',{room:name},{roomCreate:true},{allowMissing:true});
    },
    async removeParticipant(name,identity,{revokeTokenTs=null}={}){
      if(!CLASS_ROOM.test(name)||!IDENTITY.test(identity))throw fail('INVALID_ROOM_GRANT',422);
      if(revokeTokenTs!==null&&(!Number.isSafeInteger(revokeTokenTs)||revokeTokenTs<1))
        throw fail('INVALID_ROOM_GRANT',422);
      // The provider accepts protobuf int64 JSON as a decimal string.
      // Explicit cutoff prevents an already issued token rejoining after removal.
      return rpc('RemoveParticipant',
        {room:name,identity,...(revokeTokenTs===null?{}:{revokeTokenTs:String(revokeTokenTs)})},
        {roomAdmin:true,room:name},{allowMissing:true});
    },
    verifyWebhook(body,authorization){
      const raw=Buffer.isBuffer(body)?body:typeof body==='string'?Buffer.from(body):null;
      if(!raw||raw.length>262144||typeof authorization!=='string'||authorization.length>4096)
        throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);
      // LiveKit WebhookReceiver receives the JWT Authorization value as-is,
      // although a conventional Bearer prefix is accepted for reverse proxies.
      const compact=authorization.startsWith('Bearer ')?authorization.slice(7):authorization;
      const parts=compact.split('.');
      if(parts.length!==3||parts.some(p=>p.length===0))throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);
      let header,claims;
      try{
        header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
        claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
      }catch{throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);}
      const n=Math.floor(clock()/1000);
      if(header?.alg!=='HS256'||header?.crit||claims?.iss!==apiKey||
        !Number.isInteger(claims.exp)||claims.exp<n-10||
        (claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>n+10))||
        (claims.iat!==undefined&&(!Number.isInteger(claims.iat)||claims.iat>n+10))||
        typeof claims.sha256!=='string')throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);
      const signature=createHmac('sha256',apiSecret).update(parts[0]+'.'+parts[1]).digest();
      let actual;try{actual=Buffer.from(parts[2],'base64url');}catch{throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);}
      if(actual.length!==signature.length||!timingSafeEqual(actual,signature))throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);
      const expected=createHash('sha256').update(raw).digest();
      let claimed;try{claimed=Buffer.from(claims.sha256,'base64');}catch{throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);}
      if(claimed.length!==expected.length||!timingSafeEqual(claimed,expected))throw fail('LIVEKIT_WEBHOOK_UNVERIFIED',401);
      try{
        const event=JSON.parse(raw.toString('utf8'));
        if(!event||typeof event!=='object'||Array.isArray(event))throw Error('wrong event');
        return event;
      }catch{throw fail('INVALID_LIVEKIT_WEBHOOK',400);}
    }
  };
}
export function liveKitRoomServiceFromEnv(env=process.env){
  const url=env.LIVEKIT_URL||env.livekit_project_url;
  const apiKey=env.LIVEKIT_API_KEY||env.livekit_apikey;
  // Do not repurpose LIVEKIT_SIP: SIP credentials are not the API signing secret.
  const apiSecret=env.LIVEKIT_API_SECRET||env.livekit_api_secret;
  if(!url||!apiKey||!apiSecret)return null;
  return createLiveKitRoomService({url,apiKey,apiSecret});
}
