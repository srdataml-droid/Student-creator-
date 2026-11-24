/** Week 6: local server-only LiveKit grant adapter. No network call or streaming claim.
 * Compatible with documented LiveKit AccessToken HS256 JWT video grants.
 * Replace with Week 1's provider SDK/room lifecycle when integrated; never send secret to browser.
 * Source references: docs.livekit.io/frontends/reference/tokens-grants and livekit/node-sdks (Apache-2.0).
 * Original implementation, no upstream code copied.
 */
import {createHmac} from 'node:crypto';

const invalid=(code,status=503)=>Object.assign(new Error(code),{code,status});
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function createClassTokenIssuer({url,apiKey,apiSecret,ttlSeconds=300,clock=()=>Date.now()}={}){
  if(typeof url!=='string'||!/^wss:\/\/[a-zA-Z0-9.-]+(?::443)?\/?$/.test(url)||
     typeof apiKey!=='string'||apiKey.length<8||
     typeof apiSecret!=='string'||apiSecret.length<16||
     !Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>600)
    throw invalid('LIVEKIT_NOT_CONFIGURED');
  return {
    issue({room,identity,role}={}){
      if(typeof room!=='string'||!/^wk-class-[0-9a-f-]{36}$/.test(room)||
         typeof identity!=='string'||!/^student-[0-9a-f-]{36}$/.test(identity)||
         !['host','participant'].includes(role))throw invalid('INVALID_ROOM_GRANT',403);
      const now=Math.floor(clock()/1000);
      const video={room,roomJoin:true,canSubscribe:true,canPublish:role==='host',
        canPublishData:false,canUpdateOwnMetadata:false,roomAdmin:false,roomCreate:false,roomList:false};
      if(role==='host')video.canPublishSources=['camera','microphone','screen_share'];
      const payload={iss:apiKey,sub:identity,iat:now,nbf:now-3,exp:now+ttlSeconds,jti:room+'-'+identity+'-'+now,video};
      const data=enc({alg:'HS256',typ:'JWT'})+'.'+enc(payload);
      const token=data+'.'+createHmac('sha256',apiSecret).update(data).digest('base64url');
      return {url,token,expiresAt:new Date((now+ttlSeconds)*1000).toISOString()};
    }
  };
}
export function classTokenIssuerFromEnv(env=process.env){
  const url=env.LIVEKIT_URL,apiKey=env.LIVEKIT_API_KEY,apiSecret=env.LIVEKIT_API_SECRET;
  if(!url||!apiKey||!apiSecret)return null;
  return createClassTokenIssuer({url,apiKey,apiSecret});
}
