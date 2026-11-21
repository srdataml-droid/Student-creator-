import {handleLocalRequest} from '../../../../../../packages/local-core/src/http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request,context){const {segments}=await context.params;return handleLocalRequest(request,segments);}
export async function POST(request,context){const {segments}=await context.params;return handleLocalRequest(request,segments);}

export async function HEAD(request,context){const {segments}=await context.params;return handleLocalRequest(request,segments);}
