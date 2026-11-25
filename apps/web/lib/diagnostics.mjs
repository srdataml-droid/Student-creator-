const routeTypes=new Set(['render','route','action','proxy']);
const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
/** Strict allowlist. Never copy a request path, header, error message, stack, digest or user identifier. */
export function safeServerFailure({method,routeType}={}){
 return Object.freeze({event:'student_creators_server_failure',method:methods.has(method)?method:'OTHER',routeType:routeTypes.has(routeType)?routeType:'other'});
}
export function reportServerFailure(request,context,{env=process.env,sink=event=>console.error(JSON.stringify(event))}={}){
 if(env.STUDENT_CREATORS_DIAGNOSTICS_ENABLED!=='true')return false;
 try{sink(safeServerFailure({method:request?.method,routeType:context?.routeType}));return true;}
 catch{return false;}
}
