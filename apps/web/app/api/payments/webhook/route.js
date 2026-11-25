import {buildHostedPaystackWebhook} from '../../../../../../packages/hosted-core/src/hosted-paystack-webhook.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=buildHostedPaystackWebhook();
