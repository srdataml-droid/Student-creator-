const actions=new Set(['sign-in','invite','recover','refresh','logout']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Access tokens are intentionally discarded here; the server owns the HttpOnly refresh cookie.
// Do not put credentials or tokens into persistent browser storage or diagnostics.
export async function hostedAccountAction(action,data={},fetcher=fetch){
 if(!actions.has(action))throw Error('INVALID_ACTION');
 let response,body;
 try{response=await fetcher('/api/hosted-auth/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});body=await response.json();}catch{throw Error('UNAVAILABLE');}
 if(action==='logout'&&body?.signedOut===true){return {state:response.ok&&body.remoteRevoked===true?'signed-out':'revocation-unverified'};}
 if(!response.ok){throw Error(response.status===401?'AUTH_REQUIRED':response.status===429?'TRY_LATER':response.status===403?'FORBIDDEN':'UNAVAILABLE');}
 if(action==='sign-in'||action==='refresh'){if(!uuid.test(body?.userId??'')||typeof body.accessToken!=='string'||!Number.isSafeInteger(body.expiresIn)||body.expiresIn<1)throw Error('UNAVAILABLE');return {state:'signed-in'};}
 if((action==='invite'||action==='recover')&&response.status===202&&body?.accepted===true)return {state:'accepted'};
 throw Error('UNAVAILABLE');
}
