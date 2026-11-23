import {DatabaseSync} from 'node:sqlite';
const [path,creatorId,buyerId]=process.argv.slice(2);
const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
process.send({ready:true});
process.on('message',()=>{
 // Give the other process time to reach BEGIN IMMEDIATE behind our write lock.
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
 db.prepare('INSERT INTO creator_restrictions VALUES(?,?,1,0,0,?)').run(creatorId,buyerId,new Date().toISOString());
 db.prepare('DELETE FROM playback_grants WHERE user_id=?').run(buyerId);
 db.exec('COMMIT');db.close();process.exit(0);
});
