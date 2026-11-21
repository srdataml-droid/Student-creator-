import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,readdirSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocalStore} from '../src/store.mjs';
import {createLocalBackup,verifyLocalBackup,restoreLocalBackup} from '../src/backup.mjs';

const fixture=Buffer.from(readFileSync(fileURLToPath(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url)),'utf8'),'base64');
const note='This original study lesson explains how to solve a related mathematical example, walk through every step, verify the result, and understand why the method works. It is not a ready-made graded submission.';
function seed(){
 const dir=mkdtempSync(join(tmpdir(),'school-local-backup-test-'));
 const databasePath=join(dir,'source.sqlite');
 const store=openLocalStore(databasePath);
 store.bootstrapAdmin('admin@backup.test','Admin Password 2026 Strong');
 const adminLogin=store.login('admin@backup.test','Admin Password 2026 Strong');
 const admin=adminLogin.user;
 const school=store.createInstitution(admin,'Backup Test University');
 const course=store.createCourse(admin,{institutionId:school.id,code:'BKP 101',title:'Reliability Engineering'});
 const user=store.register({email:'learner@backup.test',password:'Learner Password 2026 Strong',institutionId:school.id});
 store.verifyStudent(admin,user.id);
 const studentLogin=store.login('learner@backup.test','Learner Password 2026 Strong');
 const student=studentLogin.user;
 const created=store.createDraft(student,{courseId:course.id,title:'Safe backup overview',description:'Original explanation of snapshot reliability',previewText:'A short original lesson',lessonText:note,rightsAttested:true,creationKey:'backup-local-test-unique-001'});
 store.saveVideo(student,created.lesson.id,fixture);
 store.submit(student,created.lesson.id);
 store.review(admin,created.lesson.id,{decision:'approve',reason:'Original safe material'});
 const lessonId=created.lesson.id;
 return {dir,databasePath,store,lessonId,adminLogin,studentLogin,cleanup(){try{store.close();}catch{}rmSync(dir,{force:true,recursive:true});}};
}

test('backup snapshots real SQLite and verified lesson videos; fresh restore revokes sessions',async()=>{
 const s=seed();try{
  s.store.close();
  const snapshotDir=join(s.dir,'backup-1');
  const b=await createLocalBackup({databasePath:s.databasePath,snapshotDir});
  assert.equal(b.mediaCount,1);
  const v=verifyLocalBackup(snapshotDir);assert.equal(v.valid,true);assert.equal(v.mediaCount,1);
  const restoredPath=join(s.dir,'restored','campus.sqlite');
  const result=restoreLocalBackup({snapshotDir,databasePath:restoredPath});
  assert.equal(result.sessionsRevoked,true);
  const r=openLocalStore(restoredPath);
  try{
   assert.equal(r.getSession(s.studentLogin.token),null);
   assert.equal(r.getSession(s.adminLogin.token),null);
   assert.equal(r.publicLesson(s.lessonId).status,'published');
   const current=r.getVideoFile(null,s.lessonId);
   assert.deepEqual(readFileSync(current.file),fixture);
   assert.ok(r.login('learner@backup.test','Learner Password 2026 Strong').token);
  }finally{r.close();}
 }finally{s.cleanup();}
});

test('backup cannot replace prior snapshot and restore never overwrites live DB or media',async()=>{
 const s=seed();try{
  s.store.close();const snap=join(s.dir,'backup-2');
  await createLocalBackup({databasePath:s.databasePath,snapshotDir:snap});
  await assert.rejects(createLocalBackup({databasePath:s.databasePath,snapshotDir:snap}),/DESTINATION_EXISTS/);
  assert.throws(()=>restoreLocalBackup({snapshotDir:snap,databasePath:s.databasePath}),/DESTINATION_EXISTS/);
  assert.equal(verifyLocalBackup(snap).valid,true);
  assert.ok(existsSync(s.databasePath));
 }finally{s.cleanup();}
});

test('tampered MP4, corrupted SQLite and spoofed manifests fail closed',async()=>{
 const s=seed();try{
  s.store.close();const snap=join(s.dir,'backup-3');
  await createLocalBackup({databasePath:s.databasePath,snapshotDir:snap});
  const media=join(snap,'media',readdirSync(join(snap,'media'))[0]);
  writeFileSync(media,Buffer.from('FAKE VIDEO CONTENT'));
  assert.throws(()=>verifyLocalBackup(snap),/MEDIA_INTEGRITY_FAILED/);
  assert.throws(()=>restoreLocalBackup({snapshotDir:snap,databasePath:join(s.dir,'attempt.sqlite')}),/MEDIA_INTEGRITY_FAILED/);
  assert.equal(existsSync(join(s.dir,'attempt.sqlite')),false);
  const second=join(s.dir,'backup-4');await createLocalBackup({databasePath:s.databasePath,snapshotDir:second});
  writeFileSync(join(second,'campus.sqlite'),Buffer.alloc(400));
  assert.throws(()=>verifyLocalBackup(second),/DATABASE_CHECKSUM_FAILED/);
 }finally{s.cleanup();}
});

test('backup rejects symlink media and unreferenced surprises in snapshot',async()=>{
 const s=seed();try{
  s.store.close();const snap=join(s.dir,'backup-5');
  await createLocalBackup({databasePath:s.databasePath,snapshotDir:snap});
  writeFileSync(join(snap,'private-surprise.txt'),'not in manifest');
  assert.throws(()=>verifyLocalBackup(snap),/UNEXPECTED_BACKUP_FILE/);
 }finally{s.cleanup();}
});

test('backup verification rejects symlinked media files',async()=>{
 const s=seed();try{
  s.store.close();const snap=join(s.dir,'backup-symlink');
  await createLocalBackup({databasePath:s.databasePath,snapshotDir:snap});
  const media=join(snap,'media',readdirSync(join(snap,'media'))[0]);
  renameSync(media,media+'.original');
  symlinkSync(media+'.original',media);
  assert.throws(()=>verifyLocalBackup(snap),/MISSING_OR_UNSAFE_FILE/);
 }finally{s.cleanup();}
});

test('dangling target symlinks cannot be overwritten by backup or restore',async()=>{
 const s=seed();try{
  s.store.close();const snap=join(s.dir,'valid-snapshot');
  await createLocalBackup({databasePath:s.databasePath,snapshotDir:snap});
  const dangling=join(s.dir,'dangling');
  symlinkSync(join(s.dir,'missing-file'),dangling);
  await assert.rejects(createLocalBackup({databasePath:s.databasePath,snapshotDir:dangling}),/DESTINATION_EXISTS/);
  assert.throws(()=>restoreLocalBackup({snapshotDir:snap,databasePath:dangling}),/DESTINATION_EXISTS/);
 }finally{s.cleanup();}
});

test('missing SQLite path fails safely without producing backup files',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'school-local-backup-invalid-'));
 try{
  const snap=join(dir,'unexpected');
  await assert.rejects(createLocalBackup({databasePath:join(dir,'missing.sqlite'),snapshotDir:snap}),/MISSING_OR_UNSAFE_FILE/);
  assert.equal(existsSync(snap),false);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
