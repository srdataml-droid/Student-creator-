/** Explicit local sandbox operation. Never logs keys, reference tokens or PSP bodies. */
import {openLocalStore} from '../packages/local-core/src/store.mjs';
import {createPaystackClient} from '../packages/payment-core/src/paystack-client.mjs';
let store;
try{
 if(process.env.NODE_ENV==='production'||process.env.LOCAL_PAYMENT_SANDBOX!=='1'||!process.env.LOCAL_SQLITE_PATH)throw Error('SANDBOX_CONFIGURATION_REQUIRED');
 const gateway=createPaystackClient({environment:'test',secretKey:process.env.PAYSTACK_TEST_SECRET_KEY});
 store=openLocalStore(process.env.LOCAL_SQLITE_PATH);
 const inbox=await store.drainPaymentInbox(gateway);
 const pending=await store.recoverPendingPayments(gateway);
 const failed=inbox.filter(x=>x.state==='failed').length+pending.filter(x=>x.state==='pending').length;
 console.log(JSON.stringify({mode:'test',inboxProcessed:inbox.filter(x=>x.state==='processed').length,pendingRecovered:pending.filter(x=>x.state==='paid').length,unresolved:failed}));
 if(failed)process.exitCode=2;
}catch{console.error('Sandbox recovery unavailable. Check local configuration; no credentials or provider response logged.');process.exitCode=1;}
finally{store?.close();}
