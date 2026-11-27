import {createPayoutBankHandler} from '../../../../../../../packages/hosted-core/src/payout-bank-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,context){
 const {action}=await context.params;
 return createPayoutBankHandler()(request,action);
}
