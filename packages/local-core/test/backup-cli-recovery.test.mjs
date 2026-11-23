import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {openLocalStore} from '../src/store.mjs';

const cli=fileURLToPath(new URL('../../../scripts/local-backup.mjs',import.meta.url));
const video=Buffer.from(readFileSync(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');
const note='An original synthetic teacher walkthrough: begin with the independent question, explain the assumptions, use a small example, explain the method, and show how to verify the conclusion without publishing private student work.';

function exec(args,expectSuccess=true){
  const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:30000,env:{...process.env,APP_DATA_MODE:'local'}});
  assert.equal(result.error,undefined);
  assert.equal(result.status,expectSuccess?0:1,'backup CLI failed unexpectedly: '+result.stderr);
  return JSON.parse((expectSuccess?result.stdout:result.stderr).trim());
}

test('operator CLI independently snapshots, verifies, restores media and revokes browser sessions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'one-student-cli-rehearsal-'));
  const database=join(dir,'source.sqlite'),snapshot=join(dir,'offline-snapshot'),recovered=join(dir,'restore','campus.sqlite');
  const store=openLocalStore(database,{pilotStudentCap:1,pilotAllowedEmail:'author@alpha.invalid'});
  try{
    store.bootstrapAdmin('operator@alpha.invalid','Private Synthetic Operator Password 2026');
    const administrator=store.login('operator@alpha.invalid','Private Synthetic Operator Password 2026');
    const school=store.createInstitution(administrator.user,'Single Person University');
    const course=store.createCourse(administrator.user,{institutionId:school.id,code:'RES101',title:'Recovery Engineering'});
    const user=store.register({email:'author@alpha.invalid',password:'Private Synthetic Creator Password 2026',institutionId:school.id});
    store.verifyStudent(administrator.user,user.id);
    const creator=store.login('author@alpha.invalid','Private Synthetic Creator Password 2026');
    const draft=store.createDraft(creator.user,{courseId:course.id,title:'Synthetic source video backup',description:'Original creator work',previewText:'Teaching introduction',lessonText:note,rightsAttested:true,creationKey:'one-student-recovery-2026'});
    store.saveVideo(creator.user,draft.lesson.id,video);
    store.submit(creator.user,draft.lesson.id);
    store.review(administrator.user,draft.lesson.id,{decision:'approve',reason:'Rights-cleared synthetic work'});
    const lessonId=draft.lesson.id;
    store.close(); // Stop writes and media updates before taking a coherent snapshot.
    const created=exec(['backup','--database',database,'--snapshot',snapshot]);
    assert.equal(created.ok,true);assert.equal(created.mediaCount,1);
    const verified=exec(['verify','--snapshot',snapshot]);
    assert.equal(verified.valid,true);assert.equal(verified.mediaCount,1);
    const restored=exec(['restore','--database',recovered,'--snapshot',snapshot]);
    assert.equal(restored.sessionsRevoked,true);
    const fresh=openLocalStore(recovered,{pilotStudentCap:1,pilotAllowedEmail:'author@alpha.invalid'});
    try{
      assert.equal(fresh.getSession(creator.token),null);
      assert.equal(fresh.getSession(administrator.token),null);
      const newSession=fresh.login('author@alpha.invalid','Private Synthetic Creator Password 2026');
      assert.ok(newSession?.token);
      const content=fresh.getVideoFile(newSession.user,lessonId);
      assert.deepEqual(readFileSync(content.file),video);
      assert.equal(fresh.viewableLesson(newSession.user,lessonId).id,lessonId);
    }finally{fresh.close();}
    // A corrupted snapshot must be rejected without creating a partial restored database.
    const media=join(snapshot,'media',readdirSync(join(snapshot,'media'))[0]);
    writeFileSync(media,Buffer.from('corrupt synthetic media'));
    const refused=exec(['restore','--database',join(dir,'corrupt.sqlite'),'--snapshot',snapshot],false);
    assert.equal(refused.ok,false);
    assert.equal(refused.error,'MEDIA_INTEGRITY_FAILED');
    assert.equal(existsSync(join(dir,'corrupt.sqlite')),false);
  }finally{
    try{store.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
});
