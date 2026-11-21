#!/usr/bin/env node
/** Offline operator tool. Stop the local app before backup or restore. */
import {createLocalBackup,verifyLocalBackup,restoreLocalBackup} from '../packages/local-core/src/backup.mjs';
const [, ,action,...raw]=process.argv;
function args(){
  const out={};
  if(raw.length%2)throw Error('EXPECTED_FLAG_VALUE_PAIRS');
  for(let i=0;i<raw.length;i+=2){
    if(!['--database','--snapshot'].includes(raw[i])||out[raw[i]])throw Error('INVALID_ARGUMENTS');
    out[raw[i]]=raw[i+1];
  }
  if(!out['--snapshot']||(action!=='verify'&&!out['--database'])||(!['backup','verify','restore'].includes(action)))throw Error('USAGE');
  return out;
}
try{
  const a=args();let result;
  if(action==='backup')result=await createLocalBackup({databasePath:a['--database'],snapshotDir:a['--snapshot']});
  if(action==='verify')result=verifyLocalBackup(a['--snapshot']);
  if(action==='restore')result=restoreLocalBackup({snapshotDir:a['--snapshot'],databasePath:a['--database']});
  console.log(JSON.stringify({ok:true,action,...result}));
}catch(e){console.error(JSON.stringify({ok:false,error:e.code||e.message}));process.exitCode=1;}
