import {buildHostedAuthRoute} from '../../../../../../packages/hosted-core/src/hosted-auth-lifecycle.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handler=buildHostedAuthRoute();
export async function POST(request,{params}){return handler(request,await params);}
