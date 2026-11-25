import {buildIdentityEvidenceRoute} from '../../../../../../../packages/hosted-core/src/private-identity-api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handler=buildIdentityEvidenceRoute();
export async function POST(request,{params}){return handler(request,await params);}
export async function GET(request,{params}){return handler(request,await params);}
