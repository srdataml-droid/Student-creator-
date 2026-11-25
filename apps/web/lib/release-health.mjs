const sha=/^[0-9a-f]{40}$/;
/** This is liveness, not a database/provider readiness assertion. */
export function releaseHealth(env=process.env){
  const revision=typeof env.VERCEL_GIT_COMMIT_SHA==='string'&&sha.test(env.VERCEL_GIT_COMMIT_SHA)?env.VERCEL_GIT_COMMIT_SHA:null;
  const environment=['preview','production','development'].includes(env.VERCEL_ENV)?env.VERCEL_ENV:'local';
  return {status:'serving',environment,revision};
}
export function releaseHealthResponse(env=process.env){
  return Response.json(releaseHealth(env),{headers:{'cache-control':'no-store, max-age=0'}});
}
