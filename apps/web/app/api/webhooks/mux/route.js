import {buildMuxWebhookRoute} from '../../../../../../packages/hosted-core/src/mux-webhook-route.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=buildMuxWebhookRoute();
