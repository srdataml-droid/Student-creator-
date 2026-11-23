import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore,SESSION_COOKIE} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const video=Buffer.from(readFileSync(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');
const lessonText='An original synthetic lesson showing a separate example, an explained method, independent checks and a short conclusion; no actual student data or paid access is involved.';

test('MP4 HTTP GET/HEAD/Range require scoped grant bound to current session and creator permission',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'private-media-http-'));
  const store=openLocalStore(join(dir,'campus.sqlite'));
  const handler=createLocalHandler(store);
  async function req(path,method='GET',body,cookie='',headers={}){
    const request=new Request('http://localhost:3000/api/local/'+path,{
      method,
      headers:{...(cookie?{cookie}:{}),...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const response=await handler(request,path.split('/'));
    const mime=response.headers.get('content-type')??'';
    const data=method==='HEAD'?null:mime.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,headers:response.headers,data};
  }
  try{
    store.bootstrapAdmin('admin@http-grant.test','Synthetic Administrator Password 2026');
    const moderator=store.login('admin@http-grant.test','Synthetic Administrator Password 2026');
    const school=store.createInstitution(moderator.user,'Synthetic Media Security School');
    const course=store.createCourse(moderator.user,{institutionId:school.id,code:'SEC101',title:'Private Media'});
    async function member(email){
      const password='Synthetic Student Password 2026';
      const created=store.register({email,password,institutionId:school.id});
      store.verifyStudent(moderator.user,created.id);
      return store.login(email,password);
    }
    const creator=await member('creator@http-grant.test');
    const viewer=await member('viewer@http-grant.test');
    const attacker=await member('attacker@http-grant.test');
    const d=store.createDraft(creator.user,{courseId:course.id,title:'Secure video sample',
      description:'Synthetic original video',previewText:'A preview of independent content',lessonText,
      rightsAttested:true,creationKey:'playback-http-unique-2026'}).lesson.id;
    store.saveVideo(creator.user,d,video);
    store.submit(creator.user,d);
    store.review(moderator.user,d,{decision:'approve',reason:'Approved synthetic original video'});

    const path='lessons/'+d+'/video';
    const sessionCookie=SESSION_COOKIE+'='+viewer.token;
    const anotherSession=SESSION_COOKIE+'='+attacker.token;
    assert.equal((await req(path)).status,401);
    assert.equal((await req(path,'GET',undefined,sessionCookie)).status,403);
    assert.equal((await req(path,'HEAD',undefined,sessionCookie)).status,403);
    assert.equal((await req(path,'GET',undefined,sessionCookie,{range:'bytes=0-4'})).status,403);
    // A client must obtain permission by POST, not by constructing a token-like cookie.
    assert.equal((await req(path,'GET',undefined,sessionCookie+'; campus_playback_'+d+'='+'0'.repeat(43))).status,403);
    const issued=await req('lessons/'+d+'/playback-grant','POST',{},sessionCookie);
    assert.equal(issued.status,200);
    assert.equal(Object.hasOwn(issued.data,'token'),false);
    const setCookie=issued.headers.get('set-cookie')??'';
    assert.match(setCookie,/HttpOnly; SameSite=Strict/);
    const grant=setCookie.split(';')[0];
    assert.ok(grant.startsWith('campus_playback_'+d+'='));
    const authCookie=sessionCookie+'; '+grant;
    const ok=await req(path,'GET',undefined,authCookie);
    assert.equal(ok.status,200);
    assert.deepEqual(ok.data,video);
    assert.match(ok.headers.get('cache-control')??'',/private.*no-store/);
    const ranged=await req(path,'GET',undefined,authCookie,{range:'bytes=0-6'});
    assert.equal(ranged.status,206);
    assert.deepEqual(ranged.data,video.subarray(0,7));
    assert.equal((await req(path,'HEAD',undefined,authCookie)).status,200);
    assert.equal((await req(path,'GET',undefined,authCookie,{range:'bytes=999999999-'})).status,416);

    // A valid video cookie alone must not authenticate or authorize a new user/session.
    assert.equal((await req(path,'GET',undefined,grant)).status,401);
    assert.equal((await req(path,'GET',undefined,anotherSession+'; '+grant)).status,403);
    const nextSession=store.login('viewer@http-grant.test','Synthetic Student Password 2026');
    assert.equal((await req(path,'GET',undefined,SESSION_COOKIE+'='+nextSession.token+'; '+grant)).status,403);

    // Permissions are rechecked during playback, not only when the cookie is minted.
    store.setCreatorRestrictions(creator.user,creator.user.id,viewer.user.id,{view:true,comment:false,message:false});
    assert.equal((await req(path,'GET',undefined,authCookie)).status,403);
    assert.equal((await req(path,'HEAD',undefined,authCookie)).status,403);
    store.setCreatorRestrictions(creator.user,creator.user.id,viewer.user.id,{view:false,comment:false,message:false});
    assert.equal((await req(path,'GET',undefined,authCookie,{range:'bytes=0-6'})).status,206);
    store.logout(viewer.token);
    assert.equal((await req(path,'GET',undefined,authCookie)).status,401);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
