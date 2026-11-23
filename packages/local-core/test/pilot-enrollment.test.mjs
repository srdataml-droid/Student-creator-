import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore,getLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const invited='invited@alpha.invalid';
const secret='Synthetic Student Password 2026';

function http(store){
  const handle=createLocalHandler(store);
  return async (path,method='GET',body,cookie)=>{
    const headers={...(cookie?{cookie:'campus_local_session='+cookie}:{}),
      ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})};
    const request=new Request('http://localhost:3000/api/local/'+path,{
      method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const response=await handle(request,path.split('/'));
    return {status:response.status,data:await response.json(),
      cookie:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  };
}

test('one-student pilot admits only the approved address and the cap survives restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'single-student-pilot-')),file=join(dir,'pilot.sqlite');
  let store=openLocalStore(file,{pilotStudentCap:1,pilotAllowedEmail:' INVITED@ALPHA.INVALID '});
  let closed=false;
  try{
    store.bootstrapAdmin('reviewer@alpha.invalid','Synthetic Reviewer Password 2026');
    let req=http(store);
    const admin=(await req('auth/login','POST',{email:'reviewer@alpha.invalid',password:'Synthetic Reviewer Password 2026'})).cookie;
    const campus=(await req('admin/institutions','POST',{name:'Consent-based One Student Pilot'},admin)).data.institution.id;

    const uninvited=await req('auth/register','POST',{email:'stranger@alpha.invalid',password:secret,institutionId:campus});
    assert.equal(uninvited.status,403);
    assert.equal(uninvited.data.error,'PILOT_INVITATION_REQUIRED');

    const body={email:invited,password:secret,institutionId:campus};
    // A second browser tab or retry must not create another student.
    const two=await Promise.all([req('auth/register','POST',body),req('auth/register','POST',body)]);
    assert.deepEqual(two.map(x=>x.status).sort(),[201,403]);
    assert.equal(two.find(x=>x.status===403).data.error,'PILOT_CAP_REACHED');

    const approved=two.find(x=>x.status===201).data.user.id;
    assert.equal((await req('admin/verify','POST',{userId:approved},admin)).status,200);
    const loggedIn=await req('auth/login','POST',{email:invited,password:secret});
    assert.equal(loggedIn.status,200);
    assert.equal((await req('me','GET',undefined,loggedIn.cookie)).data.user.verifiedAt!==null,true);
    assert.equal((await req('admin/pending-users','GET',undefined,loggedIn.cookie)).status,403);

    store.close();closed=true;
    store=openLocalStore(file,{pilotStudentCap:1,pilotAllowedEmail:'replacement@alpha.invalid'});closed=false;
    req=http(store);
    // Existing sessions and logins from a prior pilot invite must stop working.
    assert.equal((await req('me','GET',undefined,loggedIn.cookie)).status,401);
    assert.equal((await req('auth/login','POST',{email:invited,password:secret})).status,401);
    const beyond=await req('auth/register','POST',{email:'replacement@alpha.invalid',password:secret,institutionId:campus});
    assert.equal(beyond.status,403);
    assert.equal(beyond.data.error,'PILOT_CAP_REACHED');
  }finally{if(!closed)store.close();rmSync(dir,{recursive:true,force:true});}
});

test('invalid pilot settings fail closed before creating a database',()=>{
  const bad=[
    {pilotStudentCap:0,pilotAllowedEmail:invited},
    {pilotStudentCap:1},
    {pilotStudentCap:100,pilotAllowedEmail:invited},
    {pilotStudentCap:1,pilotAllowedEmail:'not-an-email'},
    {pilotStudentCap:1001},
    {pilotStudentCap:1.5},
  ];
  for(const options of bad)assert.throws(()=>openLocalStore(':memory:',options),
    e=>e?.code==='INVALID_PILOT_CONFIGURATION'&&e.status===503);
});

test('server environment settings apply the invite-only gate to getLocalStore',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pilot-environment-')),file=join(dir,'pilot.sqlite');
  const keys=['LOCAL_SQLITE_PATH','PILOT_STUDENT_CAP','PILOT_STUDENT_EMAIL','APP_DATA_MODE'];
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    Object.assign(process.env,{LOCAL_SQLITE_PATH:file,PILOT_STUDENT_CAP:'1',
      PILOT_STUDENT_EMAIL:invited,APP_DATA_MODE:'local'});
    const store=getLocalStore();
    store.bootstrapAdmin('admin@alpha.invalid','Private Local Admin Password 2026');
    const req=http(store);
    const admin=(await req('auth/login','POST',{email:'admin@alpha.invalid',
      password:'Private Local Admin Password 2026'})).cookie;
    const campus=(await req('admin/institutions','POST',{name:'Private Alpha Campus'},admin)).data.institution.id;
    const banned=await req('auth/register','POST',{email:'unauthorised@alpha.invalid',password:secret,institutionId:campus});
    assert.equal(banned.status,403);
    assert.equal((await req('auth/register','POST',{email:invited,password:secret,institutionId:campus})).status,201);
  }finally{
    globalThis.__campusLocalStore?.close();
    delete globalThis.__campusLocalStore;
    delete globalThis.__campusLocalStorePath;
    for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
    rmSync(dir,{recursive:true,force:true});
  }
});
