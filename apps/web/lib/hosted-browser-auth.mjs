import {hostedCreatorRequest} from './hosted-creator-client.mjs';
const actions=new Set(['invite','sign-in','refresh','logout','recover','complete']);
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Shared hosted browser transport. Access tokens exist only in this closure;
 * refresh cookies are managed by the server. Never use browser storage. */
export function createHostedBrowserAuth({fetcher=fetch,now=Date.now}={}){
 let token=null,userId=null,expiresAt=0,tail=Promise.resolve();
 const serialize=fn=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;};
 const clear=()=>{token=null;userId=null;expiresAt=0;};
 async function request(action,body){
  if(!actions.has(action))throw Error('INVALID_AUTH_ACTION');
  const response=await fetcher('/api/hosted-auth/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{...(body?{'content-type':'application/json'}:{}),...(action==='logout'&&token&&expiresAt>now()?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data||typeof data!=='object')throw Object.assign(Error('HOSTED_AUTH_REQUEST_FAILED'),{status:response.status,localSignedOut:action==='logout'&&data?.signedOut===true});
  return data;
 }
 return {
  signIn:(email,password)=>serialize(async()=>{
   clear();return accept(await request('sign-in',{email,password}));
  }),
  refresh:()=>serialize(async()=>{try{return accept(await request('refresh'));}catch(e){clear();throw e;}}),
  invite:inviteCode=>serialize(async()=>{const result=await request('invite',{inviteCode});if(result.accepted!==true)throw Error('INVITE_UNCONFIRMED');return true;}),
  recover:email=>serialize(async()=>{const result=await request('recover',{email});if(result.accepted!==true)throw Error('RECOVERY_UNCONFIRMED');return true;}),
  complete:(email,purpose,code,password)=>serialize(async()=>{clear();const result=await request('complete',{email,purpose,code,password});if(result.completed!==true||result.signInRequired!==true)throw Error('COMPLETION_UNCONFIRMED');return true;}),
  logout:()=>serialize(async()=>{try{const result=await request('logout');if(result.signedOut!==true)throw Error('LOGOUT_UNCONFIRMED');return {remoteRevoked:result.remoteRevoked===true};}finally{clear();}}),
  authorized:(operation,input)=>serialize(async()=>{
   const spec=hostedCreatorRequest(operation,input);
   if(!userId)throw Object.assign(Error('AUTH_REQUIRED'),{status:401});
   if(!token||expiresAt<=now()+30000){const expected=userId;try{const refreshed=accept(await request('refresh'));if(refreshed.userId!==expected)throw Object.assign(Error('ACCOUNT_CHANGED'),{status:401});}catch(e){clear();throw e;}}
   const response=await fetcher(spec.path,{method:spec.method,headers:{...spec.headers,authorization:'Bearer '+token},...(spec.body!==undefined?{body:spec.body}:{}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   if(response.status===401)clear();
   const data=await response.json().catch(()=>null);
   if(!response.ok||!data||typeof data!=='object')throw Object.assign(Error('HOSTED_CREATOR_REQUEST_FAILED'),{status:response.status,code:typeof data?.error==='string'&&/^[A-Z_]{1,80}$/.test(data.error)?data.error:undefined});
   return data;
  }),
  hasFreshSession:()=>Boolean(token&&expiresAt>now()+30000)
 };
 function accept(data){
  if(!JWT.test(data.accessToken||'')||data.accessToken.length>8192||!UUID.test(data.userId||'')||!Number.isSafeInteger(data.expiresIn)||data.expiresIn<1||data.expiresIn>86400){clear();throw Error('INVALID_AUTH_RESPONSE');}
  token=data.accessToken;userId=data.userId;expiresAt=now()+data.expiresIn*1000;
  return {userId:data.userId,expiresAt}; // no token crosses into React state
 }
}
