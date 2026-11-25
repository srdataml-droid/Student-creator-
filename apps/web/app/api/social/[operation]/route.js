import {createHostedSocialHandler} from '../../../../../../packages/hosted-core/src/hosted-social-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,context){
 const {operation}=await context.params;
 return createHostedSocialHandler()(request,operation);
}
