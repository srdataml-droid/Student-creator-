// Run using environment variables to avoid putting passwords in shell history.
import {openLocalStore,getLocalDbPath} from '../packages/local-core/src/store.mjs';
const email=process.env.LOCAL_ADMIN_EMAIL,password=process.env.LOCAL_ADMIN_PASSWORD;
if(!email||!password){console.error('Set LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD securely in your terminal. Do not commit them.');process.exitCode=1;}
else {let store;try{store=openLocalStore(getLocalDbPath());const id=store.bootstrapAdmin(email,password);console.log(`Local administrator created: ${id}`);}catch(e){console.error('Unable to bootstrap local admin:',e.code||e.message);process.exitCode=1;}finally{store?.close();}}
