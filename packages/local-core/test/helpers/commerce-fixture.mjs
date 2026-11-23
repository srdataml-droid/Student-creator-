import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openLocalStore} from '../../src/store.mjs';
export function commerceFixture(){
 const dir=mkdtempSync(join(tmpdir(),'integrity-')),path=join(dir,'test.sqlite');
 const store=openLocalStore(path),pw='Synthetic password only 2026!';
 store.bootstrapAdmin('admin@example.invalid',pw);const admin=store.login('admin@example.invalid',pw);
 const campus=store.createInstitution(admin.user,'Synthetic Campus');
 const course=store.createCourse(admin.user,{institutionId:campus.id,code:'SYN101',title:'Original synthetic content'});
 const people={};
 for(const name of ['creator','buyer','other','unverified']){
  const user=store.register({email:name+'@example.invalid',password:pw,institutionId:campus.id});
  if(name!=='unverified')store.verifyStudent(admin.user,user.id);
  people[name]=store.login(name+'@example.invalid',pw);
 }
 const id=store.createDraft(people.creator.user,{courseId:course.id,title:'Synthetic protected work',description:'Original',previewText:'Preview',lessonText:'An original synthetic worked example with independent explanation and discussion. '.repeat(3),rightsAttested:true,creationKey:'synthetic-payment-draft-0001'}).lesson.id;
 store.setLessonPrice(people.creator.user,id,20000);
 const video=Buffer.from(readFileSync(new URL('../fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');
 store.saveVideo(people.creator.user,id,video);store.submit(people.creator.user,id);store.review(admin.user,id,{decision:'approve',reason:'Synthetic original content reviewed'});
 const order=store.createPurchaseOrder(people.buyer.user,id,'synthetic-order-key-0001');
 const response=(extra={})=>({status:true,data:{status:'success',reference:order.reference,amount:20000,currency:'NGN',domain:'test',customer:{email:'buyer@example.invalid'},id:'synthetic_tx_1',fees:100,...extra}});
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 return {dir,path,store,db,id,order,response,admin,...people,video,close(){db.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
