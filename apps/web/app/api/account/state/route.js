import {createAccountStateHandler} from '../../../../lib/hosted-account-state.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){return createAccountStateHandler()(request);}
