import {createDraftHandler} from './draft-api.mjs';
import {createSupabaseDraftDependencies} from './supabase-draft-store.mjs';
import {createCatalogHandler,createSupabaseCatalogStore} from './catalog-api.mjs';
import {createModerationHandler,createSupabaseModerationDependencies} from './moderation-api.mjs';
import {createReviewSubmissionHandler,createSupabaseSubmissionDependencies} from './submission-api.mjs';

const outage=()=>Response.json({error:'SERVICE_NOT_CONFIGURED'},{status:503,headers:{'cache-control':'no-store'}});
/** Lazily bind server configuration so builds never require production secrets. */
export function buildDraftRoute({getEnv=()=>process.env,fetcher=fetch,audit}={}){
  return async request=>{
    const env=getEnv();
    if(!env?.SUPABASE_URL||!env?.SUPABASE_PUBLISHABLE_KEY||!env?.SUPABASE_SERVICE_ROLE_KEY) return outage();
    try{
      const {auth,store}=createSupabaseDraftDependencies({url:env.SUPABASE_URL,publicKey:env.SUPABASE_PUBLISHABLE_KEY,serverKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher});
      return await createDraftHandler({auth,store,audit})(request);
    }catch{return Response.json({error:'SERVICE_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}
  };
}
/** Catalog uses only the public publishable key; never requests the service key. */
export function buildCatalogRoute({getEnv=()=>process.env,fetcher=fetch}={}){
  return async request=>{
    const env=getEnv();
    if(!env?.SUPABASE_URL||!env?.SUPABASE_PUBLISHABLE_KEY) return outage();
    try{
      const store=createSupabaseCatalogStore({url:env.SUPABASE_URL,publicKey:env.SUPABASE_PUBLISHABLE_KEY,fetcher});
      return await createCatalogHandler({store})(request);
    }catch{return Response.json({error:'SERVICE_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}
  };
}

/** Only authenticated, active staff may review an in-review lesson. */
export function buildModerationRoute({getEnv=()=>process.env,fetcher=fetch,audit}={}){
  return async (request,{lessonId}={})=>{
    const env=getEnv();
    if(!env?.SUPABASE_URL||!env?.SUPABASE_PUBLISHABLE_KEY||!env?.SUPABASE_SERVICE_ROLE_KEY) return outage();
    try {
      const {auth,store}=createSupabaseModerationDependencies({url:env.SUPABASE_URL,publicKey:env.SUPABASE_PUBLISHABLE_KEY,serverKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher});
      return await createModerationHandler({auth,store,audit})(request,{lessonId});
    }catch{return Response.json({error:'SERVICE_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}
  };
}

/** Only a verified, unsuspended creator can submit a private ready lesson for review. */
export function buildReviewSubmissionRoute({getEnv=()=>process.env,fetcher=fetch,audit}={}){
 return async (request,{lessonId}={})=>{
  const env=getEnv();
  if(!env?.SUPABASE_URL||!env?.SUPABASE_PUBLISHABLE_KEY||!env?.SUPABASE_SERVICE_ROLE_KEY)return outage();
  try{const {auth,store}=createSupabaseSubmissionDependencies({url:env.SUPABASE_URL,publicKey:env.SUPABASE_PUBLISHABLE_KEY,serverKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher});return await createReviewSubmissionHandler({auth,store,audit})(request,{lessonId});}
  catch{return Response.json({error:'SERVICE_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}
 };
}
