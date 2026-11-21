/** Local SQLite + media backup / restore. Requires the app to be stopped for media consistency.
 * Never point this module at a production database or store snapshots in Git.
 */
import {DatabaseSync, backup as sqliteBackup} from 'node:sqlite';
import {
  existsSync, statSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  writeFileSync, copyFileSync, readdirSync, chmodSync, renameSync, rmSync,
} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, basename, sep} from 'node:path';

const FORMAT='school-learning-local-backup-v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(name)=>Object.assign(new Error(name),{code:name});
const hashFile=(path)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function requiredFile(path){if(!existsSync(path)||!lstatSync(path).isFile())throw failure('MISSING_OR_UNSAFE_FILE');}
function requiredDir(path){if(!existsSync(path)||!lstatSync(path).isDirectory())throw failure('MISSING_OR_UNSAFE_DIRECTORY');}
function isWithin(child,parent){return child===parent||child.startsWith(parent+sep);}
function dbRows(path){
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const check=db.prepare('PRAGMA integrity_check').get();
    if(check?.integrity_check!=='ok')throw failure('DATABASE_INTEGRITY_FAILED');
    if(db.prepare('PRAGMA foreign_key_check').all().length!==0)throw failure('DATABASE_FOREIGN_KEY_FAILED');
    return db.prepare('SELECT file_id, content_hash, bytes FROM lesson_videos ORDER BY file_id').all();
  }finally{db.close();}
}
function checkedMedia(rows,mediaPath){
  if(rows.length)requiredDir(mediaPath);
  const media=[];
  for(const row of rows){
    if(typeof row.file_id!=='string'||!UUID.test(row.file_id)||!HASH.test(row.content_hash))throw failure('UNSAFE_MEDIA_REFERENCE');
    const name=`${row.file_id}.mp4`,path=join(mediaPath,name);
    requiredFile(path);
    const bytes=statSync(path).size,sha256=hashFile(path);
    if(bytes!==row.bytes||sha256!==row.content_hash)throw failure('MEDIA_INTEGRITY_FAILED');
    media.push({name,bytes,sha256});
  }
  return media;
}
function checkTargetVacant(path){
  // existsSync follows symlinks and incorrectly reports dangling symlinks as absent.
  try{lstatSync(path);throw failure('DESTINATION_EXISTS');}
  catch(e){if(e?.code!=='ENOENT')throw e;}
}
function makePrivateDir(parent){mkdirSync(parent,{recursive:true,mode:0o700});}

/** Creates a new, closed snapshot directory. Refuses to replace an existing snapshot. */
export async function createLocalBackup({databasePath,snapshotDir}){
  if(!databasePath||!snapshotDir)throw failure('PATHS_REQUIRED');
  const source=resolve(databasePath),dest=resolve(snapshotDir);
  if(source===':memory:')throw failure('FILE_DATABASE_REQUIRED');
  requiredFile(source);
  if(isWithin(dest,source+'.media')||isWithin(dest,dirname(source))&&basename(dest)===basename(source))throw failure('INVALID_BACKUP_PATH');
  checkTargetVacant(dest);
  const parent=dirname(dest);makePrivateDir(parent);
  const tmp=mkdtempSync(join(parent,'.school-backup-'));
  try{
    const db=new DatabaseSync(source,{readOnly:true});
    try{await sqliteBackup(db,join(tmp,'campus.sqlite'));}finally{db.close();}
    chmodSync(join(tmp,'campus.sqlite'),0o600);
    // Make the standalone snapshot portable: no WAL/-shm companions are needed.
    const snapshotDb=new DatabaseSync(join(tmp,'campus.sqlite'));
    try{snapshotDb.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');}
    finally{snapshotDb.close();}
    const rows=dbRows(join(tmp,'campus.sqlite'));
    const refs=checkedMedia(rows,source+'.media');
    if(refs.length){
      mkdirSync(join(tmp,'media'),{mode:0o700});
      for(const f of refs){copyFileSync(join(source+'.media',f.name),join(tmp,'media',f.name));chmodSync(join(tmp,'media',f.name),0o600);}
    }
    // Detect concurrent media replacement or source modification while copying.
    const copied=checkedMedia(rows,join(tmp,'media'));
    if(copied.length!==refs.length)throw failure('MEDIA_COPY_INCOMPLETE');
    const manifest={format:FORMAT,createdAt:new Date().toISOString(),database:{name:'campus.sqlite',bytes:statSync(join(tmp,'campus.sqlite')).size,sha256:hashFile(join(tmp,'campus.sqlite'))},media:copied};
    writeFileSync(join(tmp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    renameSync(tmp,dest);
    return {snapshotDir:dest,mediaCount:copied.length,databaseBytes:manifest.database.bytes};
  }catch(e){rmSync(tmp,{recursive:true,force:true});throw e;}
}

/** Validates the complete snapshot *before* restore. Rejects extra unexpected files. */
export function verifyLocalBackup(snapshotDir){
  const dest=resolve(snapshotDir);
  requiredDir(dest);
  requiredFile(join(dest,'manifest.json'));
  let manifest;
  try{manifest=JSON.parse(readFileSync(join(dest,'manifest.json'),'utf8'));}catch{throw failure('INVALID_MANIFEST');}
  if(!manifest||manifest.format!==FORMAT||manifest.database?.name!=='campus.sqlite'||
     !Number.isSafeInteger(manifest.database.bytes)||manifest.database.bytes<1||!HASH.test(manifest.database.sha256)||!Array.isArray(manifest.media))throw failure('INVALID_MANIFEST');
  const dbPath=join(dest,'campus.sqlite');requiredFile(dbPath);
  if(statSync(dbPath).size!==manifest.database.bytes||hashFile(dbPath)!==manifest.database.sha256)throw failure('DATABASE_CHECKSUM_FAILED');
  const rows=dbRows(dbPath);
  const expected=checkedMedia(rows,join(dest,'media'));
  if(expected.length!==manifest.media.length||expected.some((entry,i)=>{
    const recorded=manifest.media[i];return recorded?.name!==entry.name||recorded.bytes!==entry.bytes||recorded.sha256!==entry.sha256;
  }))throw failure('MEDIA_MANIFEST_MISMATCH');
  const found=readdirSync(dest).sort().join(',');
  const allowed=(expected.length?['campus.sqlite','manifest.json','media']:['campus.sqlite','manifest.json']).sort().join(',');
  if(found!==allowed)throw failure('UNEXPECTED_BACKUP_FILE');
  if(expected.length&&readdirSync(join(dest,'media')).sort().join(',')!==expected.map(x=>x.name).sort().join(','))throw failure('UNEXPECTED_BACKUP_FILE');
  return {valid:true,mediaCount:expected.length,databaseBytes:manifest.database.bytes};
}

/** Restores to a new, empty destination only. All old login sessions are invalidated. */
export function restoreLocalBackup({snapshotDir,databasePath}){
  if(!snapshotDir||!databasePath)throw failure('PATHS_REQUIRED');
  const source=resolve(snapshotDir),dest=resolve(databasePath);
  if(isWithin(dest,source)||isWithin(source,dirname(dest)+sep+basename(dest)+'.media'))throw failure('INVALID_RESTORE_PATH');
  const verified=verifyLocalBackup(source);
  checkTargetVacant(dest);checkTargetVacant(dest+'.media');
  makePrivateDir(dirname(dest));
  const tmp=mkdtempSync(join(dirname(dest),'.school-restore-'));
  let movedDb=false,movedMedia=false;
  try{
    const copied=join(tmp,'campus.sqlite');copyFileSync(join(source,'campus.sqlite'),copied);chmodSync(copied,0o600);
    if(verified.mediaCount){
      const media=join(tmp,'media');mkdirSync(media,{mode:0o700});
      for(const name of readdirSync(join(source,'media'))){copyFileSync(join(source,'media',name),join(media,name));chmodSync(join(media,name),0o600);}
    }
    // Validate staged files (the snapshot may change during the copy).
    const rows=dbRows(copied);
    if(rows.length!==verified.mediaCount)throw failure('RESTORE_COPY_MISMATCH');
    checkedMedia(rows,join(tmp,'media'));
    // Invalidate restored browser sessions, while retaining users and audit records.
    const db=new DatabaseSync(copied);
    try{db.exec('PRAGMA foreign_keys=ON; DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE);');}
    finally{db.close();}
    checkTargetVacant(dest);checkTargetVacant(dest+'.media');
    renameSync(copied,dest);movedDb=true;
    if(verified.mediaCount){renameSync(join(tmp,'media'),dest+'.media');movedMedia=true;}
    return {databasePath:dest,mediaCount:verified.mediaCount,sessionsRevoked:true};
  }catch(e){if(movedDb)rmSync(dest,{force:true});if(movedMedia)rmSync(dest+'.media',{recursive:true,force:true});throw e;}
  finally{rmSync(tmp,{recursive:true,force:true});}
}
