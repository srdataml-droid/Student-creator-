import {createPayoutBankWorkflowHandler} from '../../../../../../../packages/hosted-core/src/payout-bank-workflow-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,context){
 const {action}=await context.params;
 return createPayoutBankWorkflowHandler()(request,action);
}
