import {openLocalStore} from '../../src/store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createLocalCommerce} from '../../src/commerce.mjs';
const [path,reference,mode]=process.argv.slice(2);
let store;
if(mode==='crash'){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const commerce=createLocalCommerce({db,transaction,audit:()=>process.kill(process.pid,'SIGKILL'),error:(code,status)=>Object.assign(Error(code),{code,status}),requireVerified:()=>{},requireCreatorAction:()=>{}});
 store={applyVerifiedTestCharge:commerce.applyVerifiedTestCharge,close:()=>db.close()};
}else store=openLocalStore(path);
process.send({ready:true});
process.on('message',()=>{
 try{
  const result=store.applyVerifiedTestCharge(reference,{status:true,data:{status:'success',reference,amount:20000,currency:'NGN',domain:'test',id:'synthetic_tx_1',customer:{email:'buyer@example.invalid'}}});
  process.send({result});store.close();process.exit(0);
 }catch(e){process.send({error:e.code??e.message});store.close();process.exit(1);}
});
