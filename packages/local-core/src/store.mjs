/**
 * SQLite development database on the web server; no offline browser synchronization. Never deploy this file-backed adapter on
 * stateless hosting. No sample identity, course, lesson or payment is seeded.
 * Requires Node >=22.16 (node:sqlite is experimental in Node 22).
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, chmodSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateMp4 } from './video.mjs';
import { creatorProfileInput } from './creator-profile.mjs';
import { createLocalCommerce } from './commerce.mjs';
import { validateWebVtt } from './captions.mjs';

export const SESSION_COOKIE='campus_local_session';
const SESSION_TTL=7*24*60*60;
const sha=(v)=>createHash('sha256').update(v).digest('hex');
const stamp=()=>new Date().toISOString();
const human=(row)=>row?{
  id:row.id,email:row.email,role:row.role,institutionId:row.institution_id,
  verifiedAt:row.verified_at,suspended:Boolean(row.suspended),allowMessages:Boolean(row.allow_messages)
}:null;
const lesson=(r)=>r?({id:r.id,creatorId:r.creator_id,institutionId:r.institution_id,courseId:r.course_id,topicId:r.topic_id??null,title:r.title,description:r.description,previewText:r.preview_text,lessonText:r.lesson_text,status:r.status,createdAt:r.created_at,publishedAt:r.published_at,reviewReason:r.review_reason}):null;
const course=(r)=>r?({id:r.id,institutionId:r.institution_id,code:r.code,title:r.title,active:Boolean(r.active)}):null;
const error=(code,status)=>Object.assign(new Error(code),{code,status});

export function openLocalStore(path,{pilotStudentCap=null,pilotAllowedEmail=null,pilotInviteToken=null}={}){
  // Optional local-only gate for a consented, invite-only one-student alpha.
  // A quota by itself is not enough: a stranger could otherwise take the sole slot.
  const pilotEmail=typeof pilotAllowedEmail==='string' ? pilotAllowedEmail.trim().toLowerCase() : null;
  const pilotInvite=typeof pilotInviteToken==='string'?pilotInviteToken:null;
  if((pilotStudentCap!==null&&(!Number.isSafeInteger(pilotStudentCap)||pilotStudentCap<1||pilotStudentCap>1000))||
      (pilotEmail!==null&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pilotEmail)||pilotEmail.length>254))||
      ((pilotStudentCap===1)!==(pilotEmail!==null))||
      ((pilotStudentCap===1)!==(pilotInvite!==null))||
      (pilotInvite!==null&&!/^[A-Za-z0-9_-]{32,128}$/.test(pilotInvite)))
    throw error('INVALID_PILOT_CONFIGURATION',503);
  const filename=path===':memory:'?path:resolve(path);
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const mediaDir=filename===':memory:'?null:`${filename}.media`;
  if(mediaDir){mkdirSync(mediaDir,{recursive:true,mode:0o700});chmodSync(mediaDir,0o700);}
  const db=new DatabaseSync(filename);
  if(filename!==':memory:')chmodSync(filename,0o600);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if(filename!==':memory:')db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
      institution_id TEXT REFERENCES institutions(id),verified_at TEXT,suspended INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    -- A pre-existing same-email account cannot bypass the new one-student code gate.
    CREATE TABLE IF NOT EXISTS pilot_invitation_claims(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,redeemed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS courses(
      id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),code TEXT NOT NULL,title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,UNIQUE(institution_id,code)
    );
    CREATE TABLE IF NOT EXISTS lessons(
      id TEXT PRIMARY KEY,creator_id TEXT NOT NULL REFERENCES users(id),institution_id TEXT NOT NULL REFERENCES institutions(id),
      course_id TEXT NOT NULL REFERENCES courses(id),title TEXT NOT NULL,description TEXT NOT NULL,
      preview_text TEXT NOT NULL,lesson_text TEXT NOT NULL,rights_attested INTEGER NOT NULL CHECK(rights_attested=1),
      creation_key TEXT NOT NULL,creation_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','in_review','published','rejected','taken_down')),
      reviewer_id TEXT REFERENCES users(id),review_reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      published_at TEXT,UNIQUE(creator_id,creation_key)
    );
    CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),name TEXT NOT NULL,UNIQUE(course_id,name));
    -- Single-machine development media; file bytes live outside the Git tree.
    CREATE TABLE IF NOT EXISTS lesson_videos(
      lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL UNIQUE,content_hash TEXT NOT NULL,
      bytes INTEGER NOT NULL CHECK(bytes BETWEEN 32 AND 26214400),created_at TEXT NOT NULL
    );
    -- Ephemeral playback grants bound to a real login session; raw secrets never persist.
    -- Creator-authored captions must use the same viewer grant as MP4.
    CREATE TABLE IF NOT EXISTS lesson_captions(
      lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
      language TEXT NOT NULL DEFAULT 'en' CHECK(language='en'),
      text_vtt TEXT NOT NULL,content_hash TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playback_grants(
      token_hash TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS playback_grants_expiry ON playback_grants(expires_at);
    CREATE TABLE IF NOT EXISTS creator_follows(
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(follower_id,creator_id),
      CHECK(follower_id <> creator_id)
    );
    CREATE INDEX IF NOT EXISTS creator_follows_by_creator ON creator_follows(creator_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS creator_public_profiles(
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 3 AND 60),
      bio TEXT NOT NULL DEFAULT '' CHECK(length(bio)<=280),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lesson_bookmarks(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,lesson_id));
    CREATE INDEX IF NOT EXISTS bookmark_recent ON lesson_bookmarks(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS lesson_likes(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,lesson_id));
    CREATE INDEX IF NOT EXISTS lesson_likes_by_lesson ON lesson_likes(lesson_id);
    CREATE TABLE IF NOT EXISTS lesson_comments(
      id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL CHECK(length(body) BETWEEN 3 AND 800),
      creation_key TEXT NOT NULL,creation_hash TEXT NOT NULL,created_at TEXT NOT NULL,hidden_at TEXT,
      UNIQUE(author_id,lesson_id,creation_key)
    );
    CREATE INDEX IF NOT EXISTS lesson_comments_recent ON lesson_comments(lesson_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS lesson_comment_reports(
      id TEXT PRIMARY KEY,comment_id TEXT NOT NULL REFERENCES lesson_comments(id),
      reporter_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','hidden')),
      created_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id),review_note TEXT,
      UNIQUE(comment_id,reporter_id)
    );
    CREATE INDEX IF NOT EXISTS lessons_discovery ON lessons(course_id,status,published_at);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id,recipient_id,created_at);
    CREATE TABLE IF NOT EXISTS user_blocks(blocker_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,PRIMARY KEY(blocker_id,blocked_id));
    -- Distinct per-creator permissions; unlike a DM block, these scopes are independent.
    CREATE TABLE IF NOT EXISTS creator_restrictions(
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deny_view INTEGER NOT NULL DEFAULT 0 CHECK(deny_view IN (0,1)),
      deny_comment INTEGER NOT NULL DEFAULT 0 CHECK(deny_comment IN (0,1)),
      deny_message INTEGER NOT NULL DEFAULT 0 CHECK(deny_message IN (0,1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(creator_id,viewer_id), CHECK(creator_id<>viewer_id)
    );
    CREATE TABLE IF NOT EXISTS message_reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),message_id TEXT NOT NULL REFERENCES messages(id),reason TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',resolved_by TEXT REFERENCES users(id),resolution TEXT,UNIQUE(reporter_id,message_id));
    -- Local course communities are restricted to manually verified students at their own campus.
    CREATE TABLE IF NOT EXISTS community_members(
      course_id TEXT NOT NULL REFERENCES courses(id),user_id TEXT NOT NULL REFERENCES users(id),
      joined_at TEXT NOT NULL,PRIMARY KEY(course_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS community_posts(
      id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),topic_id TEXT REFERENCES topics(id),
      author_id TEXT NOT NULL REFERENCES users(id),parent_id TEXT REFERENCES community_posts(id),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 3 AND 2000),request_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,created_at TEXT NOT NULL,hidden_at TEXT,
      UNIQUE(author_id,request_key)
    );
    CREATE INDEX IF NOT EXISTS community_posts_order ON community_posts(course_id,created_at);
    CREATE TABLE IF NOT EXISTS community_reports(
      id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES community_posts(id),
      reporter_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','hidden')),
      created_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id),review_note TEXT,
      UNIQUE(post_id,reporter_id)
    );
    -- Scheduling uses the server-side SQLite development database; no offline sync.
    CREATE TABLE IF NOT EXISTS study_sessions(
      id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),topic_id TEXT REFERENCES topics(id),
      host_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,
      starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 50),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled','completed')),
      cancellation_reason TEXT,created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS study_sessions_schedule ON study_sessions(course_id,starts_at);
    CREATE TABLE IF NOT EXISTS study_attendees(
      session_id TEXT NOT NULL REFERENCES study_sessions(id),user_id TEXT NOT NULL REFERENCES users(id),
      joined_at TEXT NOT NULL,PRIMARY KEY(session_id,user_id)
    );
    -- Separate table safely migrates pre-existing development SQLite files.
    CREATE TABLE IF NOT EXISTS study_session_requests(
      host_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,session_id TEXT NOT NULL UNIQUE REFERENCES study_sessions(id),
      PRIMARY KEY(host_id,request_key)
    );
    CREATE TABLE IF NOT EXISTS audit_events(
      id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,resource_id TEXT,
      detail TEXT NOT NULL,created_at TEXT NOT NULL
    );
  `);
  // Additive local migration preserves databases created by earlier revisions.
  if(!db.prepare('PRAGMA table_info(lessons)').all().some(col=>col.name==='topic_id')) db.exec('ALTER TABLE lessons ADD COLUMN topic_id TEXT REFERENCES topics(id)');
  if(!db.prepare('PRAGMA table_info(users)').all().some(col=>col.name==='allow_messages')) db.exec('ALTER TABLE users ADD COLUMN allow_messages INTEGER NOT NULL DEFAULT 0');
  const reportColumns=new Set(db.prepare('PRAGMA table_info(message_reports)').all().map(x=>x.name));
  if(!reportColumns.has('status')) db.exec("ALTER TABLE message_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
  if(!reportColumns.has('resolved_by')) db.exec('ALTER TABLE message_reports ADD COLUMN resolved_by TEXT REFERENCES users(id)');
  if(!reportColumns.has('resolution')) db.exec('ALTER TABLE message_reports ADD COLUMN resolution TEXT');
  // Synchronous transactions are enough for this single-process local adapter.
  // SQLite BEGIN IMMEDIATE plus compare-and-swap updates guard concurrent requests.
  function transaction(fn){
    db.exec('BEGIN IMMEDIATE');
    try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
  }
  function audit(actor,action,resource,detail={}){
    db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(randomUUID(),actor,action,resource,JSON.stringify(detail),stamp());
  }
  function communityAccess(actor,courseId,requireMembership=false){
    requireVerified(actor);
    const target=store.getCourse(courseId);
    // Returning 404 prevents an unrelated campus from learning membership or content details.
    if(!target||target.institutionId!==actor.institutionId)throw error('COMMUNITY_NOT_FOUND',404);
    const joined=Boolean(db.prepare('SELECT 1 FROM community_members WHERE course_id=? AND user_id=?').get(courseId,actor.id));
    if(requireMembership&&!joined)throw error('MEMBERSHIP_REQUIRED',403);
    return {target,joined};
  }
  function requireCreatorAction(actor,creatorId,kind){
    if(!actor)throw error('AUTH_REQUIRED',401);
    requireVerified(actor);
    if(!['view','comment','message'].includes(kind))throw error('INVALID_RESTRICTIONS',422);
    const creator=db.prepare("SELECT id FROM users WHERE id=? AND role='student' AND verified_at IS NOT NULL AND suspended=0").get(creatorId);
    if(!creator)throw error('CREATOR_UNAVAILABLE',404);
    if(actor.id!==creatorId){
      const restriction=db.prepare('SELECT deny_view,deny_comment,deny_message FROM creator_restrictions WHERE creator_id=? AND viewer_id=?').get(creatorId,actor.id);
      if(restriction?.['deny_'+kind])throw error('CREATOR_ACCESS_RESTRICTED',403);
    }
  }
  function requireVerified(actor){
    requireVerifiedUser(actor);
    const current=human(db.prepare('SELECT * FROM users WHERE id=?').get(actor.id));
    requireVerifiedUser(current);
    if(current.institutionId!==actor.institutionId)throw error('VERIFICATION_REQUIRED',403);
  }
  const commerce=createLocalCommerce({db,transaction,audit,error,requireVerified,requireCreatorAction});
  const withVideo=(row)=>row?{...lesson(row),priceKobo:commerce.price(row.id),hasVideo:Boolean(db.prepare('SELECT 1 FROM lesson_videos WHERE lesson_id=?').get(row.id)),hasCaptions:Boolean(db.prepare('SELECT 1 FROM lesson_captions WHERE lesson_id=?').get(row.id)),likeCount:db.prepare('SELECT COUNT(*) AS n FROM lesson_likes WHERE lesson_id=?').get(row.id).n}:null;
  function editableVideoLesson(actor,id){
    requireVerified(actor);
    const row=db.prepare('SELECT id,creator_id,institution_id,status FROM lessons WHERE id=?').get(id);
    if(!row)throw error('LESSON_NOT_FOUND',404);
    if(row.creator_id!==actor.id||row.institution_id!==actor.institutionId)throw error('FORBIDDEN',403);
    if(!['draft','rejected'].includes(row.status))throw error('INVALID_STATE',409);
    return row;
  }
  function checkVideoQuota(actor){
    const since=new Date(Date.now()-60*60*1000).toISOString();
    const n=db.prepare("SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='lesson.video.uploaded' AND created_at>=?").get(actor.id,since).n;
    if(n>=8)throw error('VIDEO_RATE_LIMIT',429);
  }
  const store={
    canUploadVideo(actor,id){editableVideoLesson(actor,id);checkVideoQuota(actor);if(!mediaDir)throw error('MEDIA_UNAVAILABLE',503);return true;},
    saveVideo(actor,id,bytes){
      editableVideoLesson(actor,id);
      if(!mediaDir)throw error('MEDIA_UNAVAILABLE',503);
      validateMp4(bytes);
      const contentHash=sha(bytes),fileId=randomUUID(),file=join(mediaDir,`${fileId}.mp4`);
      try{writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
      catch{try{unlinkSync(file);}catch{}throw error('MEDIA_UNAVAILABLE',503);}
      let previousId=null,replayed=false;
      try{
        transaction(()=>{
          editableVideoLesson(actor,id);
          const previous=db.prepare('SELECT * FROM lesson_videos WHERE lesson_id=?').get(id);
          if(previous?.content_hash===contentHash){replayed=true;return;}
          checkVideoQuota(actor);
          previousId=previous?.file_id??null;
          // Replacing a video invalidates its old timing and captions.
          db.prepare('DELETE FROM lesson_captions WHERE lesson_id=?').run(id);
          db.prepare(`INSERT INTO lesson_videos(lesson_id,file_id,content_hash,bytes,created_at) VALUES(?,?,?,?,?)
            ON CONFLICT(lesson_id) DO UPDATE SET file_id=excluded.file_id,content_hash=excluded.content_hash,bytes=excluded.bytes,created_at=excluded.created_at`)
            .run(id,fileId,contentHash,bytes.length,stamp());
          audit(actor.id,'lesson.video.uploaded',id,{sizeBytes:bytes.length,sha256:contentHash});
        });
      }catch(e){try{unlinkSync(file);}catch{}throw e;}
      if(replayed){try{unlinkSync(file);}catch{}return {hasVideo:true,replayed:true};}
      if(previousId)try{unlinkSync(join(mediaDir,`${previousId}.mp4`));}catch{}
      return {hasVideo:true,replayed:false,sizeBytes:bytes.length};
    },
    saveCaptions(actor,id,text){
      editableVideoLesson(actor,id);
      const vtt=validateWebVtt(text);
      return transaction(()=>{
        editableVideoLesson(actor,id);
        if(!db.prepare('SELECT 1 FROM lesson_videos WHERE lesson_id=?').get(id))throw error('VIDEO_NOT_FOUND',404);
        const digest=sha(vtt);
        const previous=db.prepare('SELECT content_hash FROM lesson_captions WHERE lesson_id=?').get(id);
        if(previous?.content_hash===digest)return {hasCaptions:true,replayed:true,language:'en'};
        const recent=db.prepare("SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='lesson.captions.saved' AND created_at>=?")
          .get(actor.id,new Date(Date.now()-3600000).toISOString()).n;
        if(recent>=8)throw error('CAPTION_RATE_LIMIT',429);
        db.prepare("INSERT INTO lesson_captions(lesson_id,language,text_vtt,content_hash,updated_at) VALUES(?,'en',?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET text_vtt=excluded.text_vtt,content_hash=excluded.content_hash,updated_at=excluded.updated_at")
          .run(id,vtt,digest,stamp());
        audit(actor.id,'lesson.captions.saved',id,{sha256:digest,language:'en',bytes:Buffer.byteLength(vtt)});
        return {hasCaptions:true,replayed:false,language:'en'};
      });
    },
    getCaptions(actor,id,grantToken=null,sessionToken=null){
      // One authorization source of truth: no separate public transcript route.
      store.getVideoFile(actor,id,grantToken,sessionToken);
      const row=db.prepare('SELECT text_vtt FROM lesson_captions WHERE lesson_id=?').get(id);
      if(!row)throw error('CAPTIONS_NOT_FOUND',404);
      return row.text_vtt;
    },
    issuePlaybackGrant(actor,id,sessionToken){
      return transaction(()=>{
        store.viewableLesson(actor,id);
        if(!db.prepare('SELECT 1 FROM lesson_videos WHERE lesson_id=?').get(id))throw error('VIDEO_NOT_FOUND',404);
        const sessionHash=typeof sessionToken==='string'?sha(sessionToken):null;
        const now=Math.floor(Date.now()/1000);
        if(!sessionHash||!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(sessionHash,actor.id,now))
          throw error('AUTH_REQUIRED',401);
        db.prepare('DELETE FROM playback_grants WHERE expires_at<=?').run(now);
        if(db.prepare('SELECT count(*) AS n FROM playback_grants WHERE user_id=?').get(actor.id).n>=20)
          throw error('PLAYBACK_GRANT_LIMIT',429);
        const token=randomBytes(32).toString('base64url'),expiresAt=now+300;
        db.prepare('INSERT INTO playback_grants(token_hash,session_hash,user_id,lesson_id,expires_at,created_at) VALUES(?,?,?,?,?,?)')
          .run(sha(token),sessionHash,actor.id,id,expiresAt,stamp());
        audit(actor.id,'video.playback.granted',id);
        // Pseudonyms are keyed with a random session secret, not student IDs or email.
        const viewerMark=createHmac('sha256',sessionToken).update('viewer:'+actor.id).digest('hex').slice(0,12);
        const sessionMark=createHmac('sha256',sessionToken).update('session-watermark').digest('hex').slice(0,8);
        audit(actor.id,'video.watermark.issued',id,{viewerMark,sessionMark});
        return {token,expiresAt,watermark:{label:`WK-${viewerMark} · ${sessionMark}`,intervalSeconds:9}};
      });
    },
    verifyPlaybackGrant(actor,id,token,sessionToken){
      if(!actor)throw error('AUTH_REQUIRED',401);
      requireVerified(actor);
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||
          typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)||
          !db.prepare('SELECT 1 FROM playback_grants g JOIN sessions s ON s.token_hash=g.session_hash WHERE g.token_hash=? AND g.session_hash=? AND g.user_id=? AND g.lesson_id=? AND g.expires_at>? AND s.user_id=g.user_id AND s.expires_at>?')
            .get(sha(token),sha(sessionToken),actor.id,id,Math.floor(Date.now()/1000),Math.floor(Date.now()/1000)))
        throw error('PLAYBACK_GRANT_REQUIRED',403);
      return true;
    },
    getVideoFile(actor,id,grantToken=null,sessionToken=null){
      const row=db.prepare(`SELECT v.file_id,v.bytes,l.creator_id,l.status,c.active AS course_active FROM lesson_videos v
        JOIN lessons l ON l.id=v.lesson_id JOIN courses c ON c.id=l.course_id WHERE l.id=?`).get(id);
      if(!row)throw error('VIDEO_NOT_FOUND',404);
      const current=actor?human(db.prepare('SELECT * FROM users WHERE id=?').get(actor.id)):null;
      if((row.status!=='published'||!row.course_active)&&!(current&&!current.suspended&&(current.role==='admin'||(current.role==='student'&&current.verifiedAt&&current.id===row.creator_id))))throw error('VIDEO_NOT_FOUND',404);
      if(row.status==='published'&&row.course_active){
        requireCreatorAction(actor,row.creator_id,'view');
        commerce.requireAccess(actor,id,row.creator_id);
        store.verifyPlaybackGrant(actor,id,grantToken,sessionToken);
      }
      if(!mediaDir)throw error('MEDIA_UNAVAILABLE',503);
      const file=join(mediaDir,`${row.file_id}.mp4`);
      let size;try{size=statSync(file).size;}catch{throw error('MEDIA_UNAVAILABLE',503);}
      if(size!==row.bytes)throw error('MEDIA_UNAVAILABLE',503);
      return {file,sizeBytes:size};
    },
    close(){db.close();},
    bootstrapAdmin(email,password){
      const existing=db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get().n;
      if(existing)throw error('ADMIN_ALREADY_EXISTS',409);
      const validated=validateEmail(email);validatePassword(password);
      const salt=randomBytes(16).toString('hex');const pw=scryptSync(password,salt,64).toString('hex');const id=randomUUID();
      transaction(()=>{db.prepare("INSERT INTO users(id,email,password_hash,salt,role,created_at) VALUES(?,?,?,?,'admin',?)").run(id,validated,pw,salt,stamp());audit(id,'admin.bootstrapped',id);});
      return id;
    },
    createInstitution(actor,name){
      requireAdmin(actor);
      const trimmed=String(name??'').trim();if(trimmed.length<3||trimmed.length>160)throw error('INVALID_INSTITUTION',422);
      const id=randomUUID();transaction(()=>{db.prepare('INSERT INTO institutions VALUES(?,?,?)').run(id,trimmed,stamp());audit(actor.id,'institution.created',id);});
      return {id,name:trimmed};
    },
    listInstitutions(){return db.prepare('SELECT id,name FROM institutions ORDER BY name LIMIT 200').all();},
    createCourse(actor,{institutionId,code,title}){
      requireAdmin(actor);
      if(!db.prepare('SELECT id FROM institutions WHERE id=?').get(institutionId))throw error('INSTITUTION_NOT_FOUND',404);
      const normCode=String(code??'').trim().toUpperCase(),normTitle=String(title??'').trim();
      if(!/^[A-Z0-9 -]{2,24}$/.test(normCode)||normTitle.length<3||normTitle.length>160)throw error('INVALID_COURSE',422);
      const id=randomUUID();transaction(()=>{db.prepare('INSERT INTO courses(id,institution_id,code,title) VALUES(?,?,?,?)').run(id,institutionId,normCode,normTitle);audit(actor.id,'course.created',id);});
      return {id,institutionId,code:normCode,title:normTitle,active:true};
    },
    listCourses(){return db.prepare('SELECT * FROM courses WHERE active=1 ORDER BY code,title LIMIT 200').all().map(course);},
    createTopic(actor,{courseId,name}){
      requireAdmin(actor);
      if(!store.getCourse(courseId))throw error('COURSE_NOT_FOUND',404);
      const title=String(name??'').trim();
      if(title.length<3||title.length>120)throw error('INVALID_TOPIC',422);
      const id=randomUUID();
      transaction(()=>{db.prepare('INSERT INTO topics(id,course_id,name) VALUES(?,?,?)').run(id,courseId,title);audit(actor.id,'topic.created',id,{courseId});});
      return {id,courseId,name:title};
    },
    listTopics(courseId){return db.prepare('SELECT id,course_id AS courseId,name FROM topics WHERE course_id=? ORDER BY name LIMIT 200').all(courseId);},
    getTopic(id){const x=db.prepare('SELECT id,course_id AS courseId,name FROM topics WHERE id=?').get(id);return x||null;},
    getCourse(id){return course(db.prepare('SELECT * FROM courses WHERE id=? AND active=1').get(id));},
    pilotInviteOnly(){return pilotInvite!==null;},
    register({email,password,institutionId,inviteCode=null}){
      const normalized=validateEmail(email);validatePassword(password);
      // An email address alone cannot claim the single invitation.
      if(pilotInvite!==null){
        const validCode=typeof inviteCode==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(inviteCode);
        // Compare fixed-size digests for both fields; avoid an early-exit
        // email check that could serve as a guessable invitation oracle.
        const emailMatches=timingSafeEqual(Buffer.from(sha(normalized),'hex'),Buffer.from(sha(pilotEmail),'hex'));
        const codeMatches=timingSafeEqual(Buffer.from(sha(validCode?inviteCode:'-'.repeat(32)),'hex'),Buffer.from(sha(pilotInvite),'hex'));
        if(!emailMatches||!validCode||!codeMatches)
          throw error('PILOT_INVITATION_REQUIRED',403);
      }
      if(!db.prepare('SELECT id FROM institutions WHERE id=?').get(institutionId))throw error('INSTITUTION_NOT_FOUND',404);
      const id=randomUUID(),salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
      transaction(()=>{
        // SQLite BEGIN IMMEDIATE prevents two concurrent registrations consuming the final slot.
        if(pilotStudentCap!==null&&
            db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='student'").get().n>=pilotStudentCap)
          throw error('PILOT_CAP_REACHED',403);
        db.prepare('INSERT INTO users(id,email,password_hash,salt,institution_id,created_at) VALUES(?,?,?,?,?,?)').run(id,normalized,hash,salt,institutionId,stamp());
        if(pilotInvite!==null)db.prepare('INSERT INTO pilot_invitation_claims(user_id,redeemed_at) VALUES(?,?)').run(id,stamp());
        audit(id,'account.created',id);
      });
      return {id,email:normalized};
    },
    login(email,password){
      const normalized=validateEmail(email);
      if(typeof password!=='string'||password.length>1024)return null;
      const row=db.prepare('SELECT * FROM users WHERE email=?').get(normalized);
      // Always run a scrypt check even for unknown users (limit enumeration/timing).
      const salt=row?.salt??'f'.repeat(32),check=scryptSync(password,salt,64);
      const valid=timingSafeEqual(check,Buffer.from(row?.password_hash??'0'.repeat(128),'hex'));
      if(!valid||!row||row.suspended||(pilotEmail!==null&&row.role==='student'&&row.email!==pilotEmail))return null;
      if(pilotInvite!==null&&row.role==='student'&&!db.prepare('SELECT 1 FROM pilot_invitation_claims WHERE user_id=?').get(row.id))return null;
      const token=randomBytes(32).toString('base64url');
      transaction(()=>{db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),row.id,Math.floor(Date.now()/1000)+SESSION_TTL);audit(row.id,'session.created',row.id);});
      return {token,user:human(row)};
    },
    getSession(token){
      if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
      const row=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.suspended=0').get(sha(token),Math.floor(Date.now()/1000));
      if(pilotEmail!==null&&row?.role==='student'&&row.email!==pilotEmail)return null;
      if(pilotInvite!==null&&row?.role==='student'&&!db.prepare('SELECT 1 FROM pilot_invitation_claims WHERE user_id=?').get(row.id))return null;
      return human(row);
    },
    logout(token){if(token&&/^[A-Za-z0-9_-]{43}$/.test(token))db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));},
    listPendingUsers(actor){requireAdmin(actor);return db.prepare("SELECT id,email,institution_id,created_at FROM users WHERE role='student' AND verified_at IS NULL AND suspended=0 ORDER BY created_at LIMIT 100").all();},
    verifyStudent(actor,userId){requireAdmin(actor);const now=stamp();const count=transaction(()=>{const x=db.prepare("UPDATE users SET verified_at=? WHERE id=? AND role='student' AND verified_at IS NULL AND institution_id IS NOT NULL AND suspended=0").run(now,userId);if(x.changes===1)audit(actor.id,'student.verified',userId);return x.changes;});if(count!==1)throw error('VERIFICATION_CONFLICT',409);return {id:userId,verifiedAt:now};},
    createDraft(actor,{courseId,topicId=null,title,description,previewText,lessonText,rightsAttested,creationKey}){
      requireVerified(actor);
      const parent=store.getCourse(courseId);
      if(!parent||parent.institutionId!==actor.institutionId)throw error('COURSE_NOT_AVAILABLE',403);
      if(topicId!==null&&store.getTopic(topicId)?.courseId!==courseId)throw error('INVALID_TOPIC',422);
      const data=validateDraft({title,description,previewText,lessonText,rightsAttested});
      if(typeof creationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(creationKey))throw error('INVALID_IDEMPOTENCY_KEY',422);
      const hash=sha(JSON.stringify({courseId,topicId,...data}));
      return transaction(()=>{
        const old=db.prepare('SELECT * FROM lessons WHERE creator_id=? AND creation_key=?').get(actor.id,creationKey);
        if(old){if(old.creation_hash!==hash)throw error('IDEMPOTENCY_CONFLICT',409);return {lesson:withVideo(old),replayed:true};}
        const id=randomUUID(),now=stamp();
        db.prepare(`INSERT INTO lessons(id,creator_id,institution_id,course_id,topic_id,title,description,preview_text,lesson_text,rights_attested,creation_key,creation_hash,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,actor.id,actor.institutionId,courseId,topicId,data.title,data.description,data.previewText,data.lessonText,1,creationKey,hash,now,now);
        audit(actor.id,'lesson.draft.created',id);
        return {lesson:withVideo(db.prepare('SELECT * FROM lessons WHERE id=?').get(id)),replayed:false};
      });
    },
    myLessons(actor){requireVerified(actor);return db.prepare('SELECT * FROM lessons WHERE creator_id=? ORDER BY created_at DESC LIMIT 100').all(actor.id).map(withVideo);},
    updateDraft(actor,id,changes){
      requireVerified(actor);
      const data=validateDraft(changes);
      return transaction(()=>{
        const current=db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
        if(!current)throw error('LESSON_NOT_FOUND',404);
        if(current.creator_id!==actor.id||current.institution_id!==actor.institutionId)throw error('FORBIDDEN',403);
        if(!['draft','rejected'].includes(current.status))throw error('INVALID_STATE',409);
        const result=db.prepare(`UPDATE lessons SET title=?,description=?,preview_text=?,lesson_text=?,status='draft',
          review_reason=NULL,reviewer_id=NULL,updated_at=? WHERE id=? AND creator_id=? AND status=?`)
          .run(data.title,data.description,data.previewText,data.lessonText,stamp(),id,actor.id,current.status);
        if(result.changes!==1)throw error('UPDATE_CONFLICT',409);
        audit(actor.id,'lesson.draft.updated',id);
        return withVideo(db.prepare('SELECT * FROM lessons WHERE id=?').get(id));
      });
    },
    submit(actor,id){requireVerified(actor);
      return transaction(()=>{
        const row=db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
        if(!row)throw error('LESSON_NOT_FOUND',404);
        if(row.creator_id!==actor.id)throw error('FORBIDDEN',403);
        if(row.status==='in_review')return withVideo(row);
        if(row.status!=='draft'&&row.status!=='rejected')throw error('INVALID_STATE',409);
        // Plain text is validated as text at input; no binary file scanner is represented here.
        const updated=db.prepare("UPDATE lessons SET status='in_review',updated_at=? WHERE id=? AND creator_id=? AND status=? AND length(trim(lesson_text))>=100").run(stamp(),id,actor.id,row.status);
        if(updated.changes!==1)throw error('SUBMISSION_CONFLICT',409);
        audit(actor.id,'lesson.submitted',id);return lesson(db.prepare('SELECT * FROM lessons WHERE id=?').get(id));
      });
    },
    reviewQueue(actor){requireAdmin(actor);return db.prepare("SELECT * FROM lessons WHERE status='in_review' ORDER BY created_at LIMIT 100").all().map(withVideo);},
    review(actor,id,{decision,reason}){requireAdmin(actor);
      if(!['approve','reject'].includes(decision)||typeof reason!=='string'||reason.trim().length<5||reason.trim().length>1000)throw error('INVALID_DECISION',422);
      return transaction(()=>{
        const row=db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
        if(!row)throw error('LESSON_NOT_FOUND',404);
        if(row.creator_id===actor.id)throw error('CONFLICT_OF_INTEREST',403);
        if(row.status!=='in_review')throw error('INVALID_STATE',409);
        const now=stamp(),status=decision==='approve'?'published':'rejected';
        const updated=db.prepare("UPDATE lessons SET status=?,reviewer_id=?,review_reason=?,updated_at=?,published_at=? WHERE id=? AND status='in_review'").run(status,actor.id,reason.trim(),now,status==='published'?now:null,id);
        if(updated.changes!==1)throw error('REVIEW_CONFLICT',409);
        audit(actor.id,`lesson.${status}`,id,{reason:reason.trim()});return lesson(db.prepare('SELECT * FROM lessons WHERE id=?').get(id));
      });
    },

    searchLessons({q,institutionId=null,courseId=null,topicId=null,limit=25}={}){
      if(typeof q!=='string'||q.trim().length<2||q.trim().length>80||/[\x00-\x1f\x7f]/.test(q))throw error('INVALID_SEARCH',422);
      if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw error('INVALID_SEARCH_LIMIT',422);
      const term=q.trim();
      for(const key of ['institutionId','courseId','topicId']){
        const value={institutionId,courseId,topicId}[key];
        if(value!==null&&(typeof value!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)))throw error('INVALID_SEARCH_FILTER',422);
      }
      if(courseId){const parent=store.getCourse(courseId);if(!parent)throw error('INVALID_SEARCH_FILTER',422);if(institutionId&&parent.institutionId!==institutionId)throw error('INVALID_SEARCH_FILTER',422);}
      if(topicId){const topic=store.getTopic(topicId);if(!topic||(courseId&&topic.courseId!==courseId))throw error('INVALID_SEARCH_FILTER',422);if(institutionId&&store.getCourse(topic.courseId)?.institutionId!==institutionId)throw error('INVALID_SEARCH_FILTER',422);}
      const fields=['l.title','l.description','l.preview_text','c.code','c.title','i.name'];
      const where=["l.status='published'",'c.active=1','('+fields.map(f=>'instr(lower('+f+'),lower(?))>0').join(' OR ')+')'];
      const values=fields.map(()=>term);
      if(institutionId){where.push('l.institution_id=?');values.push(institutionId);}
      if(courseId){where.push('l.course_id=?');values.push(courseId);}
      if(topicId){where.push('l.topic_id=?');values.push(topicId);}
      const sql='SELECT l.id,l.title,l.description,l.preview_text AS previewText,l.topic_id AS topicId,l.published_at AS publishedAt,c.id AS courseId,c.code AS courseCode,c.title AS courseTitle,i.id AS institutionId,i.name AS institutionName,EXISTS(SELECT 1 FROM lesson_videos v WHERE v.lesson_id=l.id) AS hasVideo FROM lessons l JOIN courses c ON c.id=l.course_id JOIN institutions i ON i.id=l.institution_id WHERE '+where.join(' AND ')+' ORDER BY CASE WHEN instr(lower(l.title),lower(?))>0 THEN 0 WHEN instr(lower(c.code),lower(?))>0 THEN 1 ELSE 2 END,l.published_at DESC,l.id DESC LIMIT ?';
      return db.prepare(sql).all(...values,term,term,limit).map(row=>({...row,priceKobo:commerce.price(row.id),hasVideo:Boolean(row.hasVideo)}));
    },

    myBookmarks(actor){
      requireVerified(actor);
      return db.prepare("SELECT l.id,l.title,l.description,l.preview_text AS previewText,l.course_id AS courseId,c.code AS courseCode,i.name AS institutionName,b.created_at AS savedAt,EXISTS(SELECT 1 FROM lesson_videos v WHERE v.lesson_id=l.id) AS hasVideo FROM lesson_bookmarks b JOIN lessons l ON l.id=b.lesson_id JOIN courses c ON c.id=l.course_id JOIN institutions i ON i.id=l.institution_id WHERE b.user_id=? AND l.status='published' AND c.active=1 ORDER BY b.created_at DESC,l.id DESC LIMIT 250").all(actor.id).map(x=>({...x,hasVideo:Boolean(x.hasVideo)}));
    },
    saveBookmark(actor,lessonId){
      requireVerified(actor);
      return transaction(()=>{
        const target=db.prepare("SELECT l.id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND l.status='published' AND c.active=1").get(lessonId);
        if(!target)throw error('LESSON_NOT_FOUND',404);
        const existing=db.prepare('SELECT 1 FROM lesson_bookmarks WHERE user_id=? AND lesson_id=?').get(actor.id,lessonId);
        if(existing)return {bookmarked:true,replayed:true};
        if(db.prepare('SELECT count(*) AS n FROM lesson_bookmarks WHERE user_id=?').get(actor.id).n>=250)throw error('BOOKMARK_LIMIT',429);
        db.prepare('INSERT INTO lesson_bookmarks VALUES(?,?,?)').run(actor.id,lessonId,stamp());
        audit(actor.id,'lesson.bookmarked',lessonId);
        return {bookmarked:true,replayed:false};
      });
    },
    removeBookmark(actor,lessonId){
      requireVerified(actor);
      return transaction(()=>{
        const changed=db.prepare('DELETE FROM lesson_bookmarks WHERE user_id=? AND lesson_id=?').run(actor.id,lessonId);
        if(changed.changes)audit(actor.id,'lesson.unbookmarked',lessonId);
        return {bookmarked:false,replayed:changed.changes===0};
      });
    },
    myLikes(actor){
      requireVerified(actor);
      return db.prepare("SELECT x.lesson_id AS id FROM lesson_likes x JOIN lessons l ON l.id=x.lesson_id JOIN courses c ON c.id=l.course_id WHERE x.user_id=? AND l.status='published' AND c.active=1 ORDER BY x.created_at DESC LIMIT 1000").all(actor.id).map(row=>row.id);
    },
    likeLesson(actor,lessonId){
      requireVerified(actor);
      return transaction(()=>{
        const target=db.prepare("SELECT l.id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND l.status='published' AND c.active=1").get(lessonId);
        if(!target)throw error('LESSON_NOT_FOUND',404);
        const exists=db.prepare('SELECT 1 FROM lesson_likes WHERE user_id=? AND lesson_id=?').get(actor.id,lessonId);
        if(exists)return {liked:true,replayed:true};
        const recent=db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE actor_id=? AND action='lesson.liked' AND created_at>?").get(actor.id,new Date(Date.now()-3600000).toISOString()).n;
        if(recent>=60)throw error('LIKE_RATE_LIMIT',429);
        db.prepare('INSERT INTO lesson_likes(user_id,lesson_id,created_at) VALUES(?,?,?)').run(actor.id,lessonId,stamp());
        audit(actor.id,'lesson.liked',lessonId);
        return {liked:true,replayed:false};
      });
    },
    unlikeLesson(actor,lessonId){
      requireVerified(actor);
      return transaction(()=>{
        const changed=db.prepare('DELETE FROM lesson_likes WHERE user_id=? AND lesson_id=?').run(actor.id,lessonId).changes;
        if(changed)audit(actor.id,'lesson.unliked',lessonId);
        return {liked:false,replayed:changed===0};
      });
    },
    lessonComments(id){
      if(!store.publicLesson(id))throw error('LESSON_NOT_FOUND',404);
      return db.prepare(`SELECT c.id,c.lesson_id AS lessonId,c.author_id AS authorId,c.body,c.created_at AS createdAt
        FROM lesson_comments c JOIN users u ON u.id=c.author_id
        WHERE c.lesson_id=? AND c.hidden_at IS NULL AND u.verified_at IS NOT NULL AND u.suspended=0
        ORDER BY c.created_at DESC,c.id DESC LIMIT 50`).all(id).reverse();
    },
    createLessonComment(actor,id,{text,creationKey}={}){
      requireVerified(actor);
      // A comment is part of the paid work, not a public preview action.
      const target=store.viewableLesson(actor,id);
      requireCreatorAction(actor,target.creatorId,'comment');
      if(typeof text!=='string'||text.trim().length<3||text.trim().length>800||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
        throw error('INVALID_COMMENT',422);
      if(typeof creationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(creationKey))throw error('INVALID_IDEMPOTENCY_KEY',422);
      const body=text.trim(),hash=sha(body);
      return transaction(()=>{
        // Recheck with the write lock held: refund/block and comment revocation
        // must win over retries, including an old idempotency key.
        store.viewableLesson(actor,id);
        requireCreatorAction(actor,target.creatorId,'comment');
        const old=db.prepare('SELECT * FROM lesson_comments WHERE author_id=? AND lesson_id=? AND creation_key=?').get(actor.id,id,creationKey);
        if(old){
          if(old.creation_hash!==hash)throw error('IDEMPOTENCY_CONFLICT',409);
          if(old.hidden_at)throw error('COMMENT_UNAVAILABLE',409);
          return {comment:{id:old.id,lessonId:id,authorId:actor.id,body:old.body,createdAt:old.created_at},replayed:true};
        }
        const recent=db.prepare('SELECT count(*) AS n FROM lesson_comments WHERE author_id=? AND created_at>=?').get(actor.id,new Date(Date.now()-3600000).toISOString()).n;
        if(recent>=20)throw error('COMMENT_RATE_LIMIT',429);
        const commentId=randomUUID(),createdAt=stamp();
        db.prepare('INSERT INTO lesson_comments(id,lesson_id,author_id,body,creation_key,creation_hash,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(commentId,id,actor.id,body,creationKey,hash,createdAt);
        audit(actor.id,'lesson.comment.created',commentId,{lessonId:id});
        return {comment:{id:commentId,lessonId:id,authorId:actor.id,body,createdAt},replayed:false};
      });
    },
    removeLessonComment(actor,id){
      requireVerified(actor);
      return transaction(()=>{
        const row=db.prepare('SELECT id,author_id,hidden_at FROM lesson_comments WHERE id=?').get(id);
        if(!row||row.author_id!==actor.id)throw error('COMMENT_NOT_FOUND',404);
        if(row.hidden_at)return {removed:true,replayed:true};
        const changed=db.prepare('UPDATE lesson_comments SET hidden_at=? WHERE id=? AND author_id=? AND hidden_at IS NULL').run(stamp(),id,actor.id).changes;
        if(changed)audit(actor.id,'lesson.comment.removed',id);
        return {removed:true,replayed:changed===0};
      });
    },
    reportLessonComment(actor,id,reason){
      requireVerified(actor);
      if(typeof reason!=='string'||reason.trim().length<10||reason.trim().length>1000)throw error('INVALID_REPORT',422);
      return transaction(()=>{
        const row=db.prepare(`SELECT lc.id,lc.author_id,lc.lesson_id AS lessonId FROM lesson_comments lc
          JOIN lessons l ON l.id=lc.lesson_id JOIN courses c ON c.id=l.course_id
          WHERE lc.id=? AND lc.hidden_at IS NULL AND l.status='published' AND c.active=1`).get(id);
        if(!row)throw error('COMMENT_NOT_FOUND',404);
        // Reports are accepted only from a viewer allowed to read that thread.
        store.viewableLesson(actor,row.lessonId);
        if(row.author_id===actor.id)throw error('CANNOT_REPORT_SELF',403);
        const reportId=randomUUID();
        const created=db.prepare('INSERT OR IGNORE INTO lesson_comment_reports(id,comment_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)')
          .run(reportId,id,actor.id,reason.trim(),stamp()).changes;
        if(!created)throw error('ALREADY_REPORTED',409);
        audit(actor.id,'lesson.comment.reported',id);
        return {reportId};
      });
    },
    lessonCommentReportQueue(actor){
      requireAdmin(actor);
      return db.prepare(`SELECT r.id,r.comment_id AS commentId,r.reason,r.created_at AS createdAt,
          c.lesson_id AS lessonId,c.author_id AS authorId,c.body
        FROM lesson_comment_reports r JOIN lesson_comments c ON c.id=r.comment_id
        WHERE r.status='open' AND c.hidden_at IS NULL ORDER BY r.created_at,r.id LIMIT 100`).all();
    },
    resolveLessonCommentReport(actor,id,{decision,reason}={}){
      requireAdmin(actor);
      if(!['hide','dismiss'].includes(decision)||typeof reason!=='string'||reason.trim().length<5||reason.trim().length>1000)
        throw error('INVALID_DECISION',422);
      return transaction(()=>{
        const row=db.prepare("SELECT comment_id FROM lesson_comment_reports WHERE id=? AND status='open'").get(id);
        if(!row)throw error('REPORT_CONFLICT',409);
        const now=stamp();
        if(decision==='hide'){
          db.prepare('UPDATE lesson_comments SET hidden_at=? WHERE id=? AND hidden_at IS NULL').run(now,row.comment_id);
          db.prepare("UPDATE lesson_comment_reports SET status='hidden',reviewed_by=?,review_note=? WHERE comment_id=? AND status='open'").run(actor.id,reason.trim(),row.comment_id);
        }else{
          db.prepare("UPDATE lesson_comment_reports SET status='dismissed',reviewed_by=?,review_note=? WHERE id=? AND status='open'").run(actor.id,reason.trim(),id);
        }
        audit(actor.id,'lesson.comment.report.resolved',id,{decision,commentId:row.comment_id});
        return {id,status:decision==='hide'?'hidden':'dismissed'};
      });
    },
    publicLessons(courseId,topicId=null){if(!store.getCourse(courseId))return [];return (topicId?db.prepare("SELECT * FROM lessons WHERE course_id=? AND topic_id=? AND status='published' ORDER BY published_at DESC LIMIT 100").all(courseId,topicId):db.prepare("SELECT * FROM lessons WHERE course_id=? AND status='published' ORDER BY published_at DESC LIMIT 100").all(courseId)).map(withVideo);},
    viewableLesson(actor,id){
      const item=store.publicLesson(id);
      if(!item)throw error('LESSON_NOT_FOUND',404);
      requireCreatorAction(actor,item.creatorId,'view');
      commerce.requireAccess(actor,id,item.creatorId);
      return item;
    },
    publicLesson(id){const row=db.prepare("SELECT l.* FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND l.status='published' AND c.active=1").get(id);return withVideo(row);},
    getOwnPublicProfile(actor){
      requireVerified(actor);
      const row=db.prepare('SELECT handle,display_name AS displayName,bio,updated_at AS updatedAt FROM creator_public_profiles WHERE user_id=?').get(actor.id);
      return row||null;
    },
    updatePublicProfile(actor,input){
      requireVerified(actor);
      const value=creatorProfileInput(input),current=store.getOwnPublicProfile(actor);
      if(current&&current.handle===value.handle&&current.displayName===value.displayName&&current.bio===value.bio)
        return {profile:current,replayed:true};
      return transaction(()=>{
        const recent=db.prepare("SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='creator.profile.updated' AND created_at>=?")
          .get(actor.id,new Date(Date.now()-3600000).toISOString()).n;
        if(recent>=5)throw error('PROFILE_RATE_LIMIT',429);
        const updatedAt=stamp();
        try{
          db.prepare(`INSERT INTO creator_public_profiles(user_id,handle,display_name,bio,updated_at)
            VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET handle=excluded.handle,
            display_name=excluded.display_name,bio=excluded.bio,updated_at=excluded.updated_at`)
            .run(actor.id,value.handle,value.displayName,value.bio,updatedAt);
        }catch(cause){
          if(cause?.code==='ERR_SQLITE_ERROR'&&String(cause.message).includes('UNIQUE constraint failed: creator_public_profiles.handle'))
            throw error('HANDLE_TAKEN',409);
          throw cause;
        }
        audit(actor.id,'creator.profile.updated',actor.id,{previousHandle:current?.handle||null,newHandle:value.handle});
        return {profile:{...value,updatedAt},replayed:false};
      });
    },
    publicCreator(id){
      const x=db.prepare(`SELECT u.id,u.allow_messages,p.handle,p.display_name,p.bio
         FROM users u LEFT JOIN creator_public_profiles p ON p.user_id=u.id
         WHERE u.id=? AND u.role='student' AND u.verified_at IS NOT NULL AND u.suspended=0
         AND EXISTS (SELECT 1 FROM lessons l JOIN courses c ON c.id=l.course_id
           WHERE l.creator_id=u.id AND l.status='published' AND c.active=1)`).get(id);
      return x?{id:x.id,allowMessages:Boolean(x.allow_messages),
        handle:x.handle??null,displayName:x.display_name??null,bio:x.bio??'',
        followerCount:db.prepare('SELECT COUNT(*) AS n FROM creator_follows WHERE creator_id=?').get(x.id).n}:null;
    },
    followCreator(actor,creatorId){
      requireVerified(actor);
      if(typeof creatorId!=='string'||creatorId===actor.id)throw error('CANNOT_FOLLOW_SELF',422);
      if(!store.publicCreator(creatorId))throw error('CREATOR_UNAVAILABLE',404);
      return transaction(()=>{
        const result=db.prepare('INSERT OR IGNORE INTO creator_follows(follower_id,creator_id,created_at) VALUES(?,?,?)').run(actor.id,creatorId,stamp());
        if(result.changes)audit(actor.id,'creator.followed',creatorId);
        return {creatorId,following:true,replayed:result.changes===0};
      });
    },
    unfollowCreator(actor,creatorId){
      requireVerified(actor);
      if(typeof creatorId!=='string'||creatorId===actor.id)throw error('CANNOT_FOLLOW_SELF',422);
      return transaction(()=>{
        const result=db.prepare('DELETE FROM creator_follows WHERE follower_id=? AND creator_id=?').run(actor.id,creatorId);
        if(result.changes)audit(actor.id,'creator.unfollowed',creatorId);
        return {creatorId,following:false,replayed:result.changes===0};
      });
    },
    isFollowing(actor,creatorId){
      requireVerified(actor);
      return Boolean(db.prepare('SELECT 1 FROM creator_follows WHERE follower_id=? AND creator_id=?').get(actor.id,creatorId));
    },
    followingCreators(actor){
      requireVerified(actor);
      return db.prepare("SELECT f.creator_id AS id FROM creator_follows f JOIN users u ON u.id=f.creator_id WHERE f.follower_id=? AND u.verified_at IS NOT NULL AND u.suspended=0 AND EXISTS(SELECT 1 FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.creator_id=u.id AND l.status='published' AND c.active=1) ORDER BY f.created_at DESC LIMIT 250").all(actor.id).map(x=>x.id);
    },
    setMessagePreference(actor,allowed){
      requireVerified(actor);
      if(typeof allowed!=='boolean')throw error('INVALID_PREFERENCE',422);
      transaction(()=>{db.prepare('UPDATE users SET allow_messages=? WHERE id=?').run(allowed?1:0,actor.id);audit(actor.id,'messages.preference.updated',actor.id,{allowed});});
      return {allowMessages:allowed};
    },
    creatorRestrictions(actor,creatorId){
      requireVerified(actor);
      if(actor.id!==creatorId)throw error('FORBIDDEN',403);
      return db.prepare(`SELECT viewer_id AS viewerId,deny_view AS view,deny_comment AS comment,
        deny_message AS message,updated_at AS updatedAt FROM creator_restrictions
        WHERE creator_id=? ORDER BY updated_at DESC LIMIT 250`).all(creatorId)
        .map(x=>({...x,view:Boolean(x.view),comment:Boolean(x.comment),message:Boolean(x.message)}));
    },
    setCreatorRestrictions(actor,creatorId,viewerId,input){
      requireVerified(actor);
      if(actor.id!==creatorId)throw error('FORBIDDEN',403);
      if(typeof viewerId!=='string'||viewerId===actor.id||
          !db.prepare("SELECT 1 FROM users WHERE id=? AND role='student'").get(viewerId))throw error('INVALID_VIEWER',422);
      const keys=['view','comment','message'];
      if(!input||typeof input!=='object'||Array.isArray(input)||
          Object.keys(input).length!==3||!keys.every(k=>typeof input[k]==='boolean'))
        throw error('INVALID_RESTRICTIONS',422);
      return transaction(()=>{
        const existing=db.prepare('SELECT deny_view,deny_comment,deny_message FROM creator_restrictions WHERE creator_id=? AND viewer_id=?')
          .get(creatorId,viewerId);
        const old=existing?{view:Boolean(existing.deny_view),comment:Boolean(existing.deny_comment),message:Boolean(existing.deny_message)}:{view:false,comment:false,message:false};
        const unchanged=keys.every(k=>old[k]===input[k]);
        if(!unchanged){
          const since=new Date(Date.now()-3600000).toISOString();
          if(db.prepare("SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='creator.restriction.changed' AND created_at>=?").get(actor.id,since).n>=60)
            throw error('RESTRICTION_RATE_LIMIT',429);
          if(keys.every(k=>!input[k])){
            db.prepare('DELETE FROM creator_restrictions WHERE creator_id=? AND viewer_id=?').run(creatorId,viewerId);
          }else{
            db.prepare(`INSERT INTO creator_restrictions(creator_id,viewer_id,deny_view,deny_comment,deny_message,updated_at)
              VALUES(?,?,?,?,?,?) ON CONFLICT(creator_id,viewer_id) DO UPDATE SET
              deny_view=excluded.deny_view,deny_comment=excluded.deny_comment,
              deny_message=excluded.deny_message,updated_at=excluded.updated_at`)
              .run(creatorId,viewerId,Number(input.view),Number(input.comment),Number(input.message),stamp());
          }
          // A newly issued viewing block permanently invalidates earlier media grants.
          // Unblocking requires a fresh authorization, not resurrection of an old cookie.
          if(input.view&&!old.view){
            commerce.recordRestrictedPurchases(creatorId,viewerId);
            const revoked=db.prepare(`DELETE FROM playback_grants WHERE user_id=? AND lesson_id IN
              (SELECT id FROM lessons WHERE creator_id=?)`).run(viewerId,creatorId).changes;
            audit(actor.id,'video.playback.revoked',viewerId,{creatorId,revoked});
          }
          audit(actor.id,'creator.restriction.changed',viewerId,{previous:old,current:input});
        }
        return {viewerId,...input,replayed:unchanged};
      });
    },
    sendMessage(actor,recipientId,body){
      requireVerified(actor);
      if(actor.id===recipientId)throw error('CANNOT_MESSAGE_SELF',422);
      if(typeof body!=='string'||body.trim().length<1||body.trim().length>2000)throw error('INVALID_MESSAGE',422);
      return transaction(()=>{
        requireCreatorAction(actor,recipientId,'message');
        const recipient=db.prepare("SELECT id,allow_messages FROM users WHERE id=? AND role='student' AND verified_at IS NOT NULL AND suspended=0").get(recipientId);
        const existingReply=Boolean(db.prepare('SELECT 1 FROM messages WHERE sender_id=? AND recipient_id=? LIMIT 1').get(recipientId,actor.id));
        if(!recipient||!(existingReply||(recipient.allow_messages&&store.publicCreator(recipientId))))throw error('RECIPIENT_UNAVAILABLE',403);
        const blocked=db.prepare('SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(actor.id,recipientId,recipientId,actor.id);
        if(blocked)throw error('CONTACT_BLOCKED',403);
        const recent=db.prepare('SELECT count(*) n FROM messages WHERE sender_id=? AND created_at>?').get(actor.id,new Date(Date.now()-60*60*1000).toISOString()).n;
        if(recent>=30)throw error('MESSAGE_RATE_LIMIT',429);
        const id=randomUUID(),createdAt=stamp();db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run(id,actor.id,recipientId,body.trim(),createdAt);
        audit(actor.id,'message.sent',id,{recipientId});
        return {id,senderId:actor.id,recipientId,body:body.trim(),createdAt};
      });
    },
    thread(actor,peerId){
      requireVerified(actor);
      const rows=db.prepare(`SELECT id,sender_id AS senderId,recipient_id AS recipientId,body,created_at AS createdAt FROM messages
         WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?) ORDER BY created_at DESC LIMIT 100`).all(actor.id,peerId,peerId,actor.id);
      return rows.reverse();
    },
    inbox(actor){
      requireVerified(actor);
      return db.prepare(`SELECT peerId,MAX(createdAt) AS lastMessageAt FROM (
        SELECT recipient_id AS peerId,created_at AS createdAt FROM messages WHERE sender_id=?
        UNION ALL SELECT sender_id AS peerId,created_at AS createdAt FROM messages WHERE recipient_id=?
      ) GROUP BY peerId ORDER BY lastMessageAt DESC LIMIT 50`).all(actor.id,actor.id);
    },
    isContactBlocked(actor,otherId){
      requireVerified(actor);
      return Boolean(db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id=? AND blocked_id=?').get(actor.id,otherId));
    },
    unblockContact(actor,otherId){
      requireVerified(actor);
      transaction(()=>{db.prepare('DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?').run(actor.id,otherId);audit(actor.id,'contact.unblocked',otherId);});
      return {blocked:false};
    },
    blockContact(actor,otherId){
      requireVerified(actor);
      if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(otherId)||actor.id===otherId)throw error('INVALID_CONTACT',422);
      transaction(()=>{db.prepare('INSERT OR IGNORE INTO user_blocks VALUES(?,?,?)').run(actor.id,otherId,stamp());audit(actor.id,'contact.blocked',otherId);});
      return {blocked:true};
    },
    reportMessage(actor,messageId,reason){
      requireVerified(actor);
      if(typeof reason!=='string'||reason.trim().length<10||reason.trim().length>1000)throw error('INVALID_REPORT',422);
      return transaction(()=>{
        const msg=db.prepare('SELECT id FROM messages WHERE id=? AND recipient_id=?').get(messageId,actor.id);
        if(!msg)throw error('MESSAGE_NOT_FOUND',404);
        const id=randomUUID();db.prepare('INSERT INTO message_reports(id,reporter_id,message_id,reason,created_at) VALUES(?,?,?,?,?)').run(id,actor.id,messageId,reason.trim(),stamp());
        audit(actor.id,'message.reported',messageId);return {reportId:id};
      });
    },
    reportQueue(actor){
      requireAdmin(actor);
      return db.prepare(`SELECT r.id,r.message_id AS messageId,r.reason,r.created_at AS createdAt,m.sender_id AS senderId,m.recipient_id AS recipientId,m.body
        FROM message_reports r JOIN messages m ON m.id=r.message_id WHERE r.status='open' ORDER BY r.created_at LIMIT 100`).all();
    },
    resolveReport(actor,reportId,resolution){
      requireAdmin(actor);
      if(typeof resolution!=='string'||resolution.trim().length<5||resolution.trim().length>1000)throw error('INVALID_RESOLUTION',422);
      return transaction(()=>{
        const affected=db.prepare("UPDATE message_reports SET status='reviewed',resolved_by=?,resolution=? WHERE id=? AND status='open'").run(actor.id,resolution.trim(),reportId).changes;
        if(affected!==1)throw error('REPORT_CONFLICT',409);
        audit(actor.id,'message.report.resolved',reportId);return {id:reportId,status:'reviewed'};
      });
    },
    communityStatus(actor,courseId){
      const {target,joined}=communityAccess(actor,courseId);
      const memberCount=db.prepare('SELECT count(*) n FROM community_members WHERE course_id=?').get(courseId).n;
      return {course:{id:target.id,title:target.title,code:target.code},joined,memberCount};
    },
    joinCommunity(actor,courseId){
      communityAccess(actor,courseId);
      return transaction(()=>{
        const inserted=db.prepare('INSERT OR IGNORE INTO community_members VALUES(?,?,?)').run(courseId,actor.id,stamp()).changes;
        if(inserted)audit(actor.id,'community.joined',courseId);
        return {joined:true,replayed:inserted===0};
      });
    },
    leaveCommunity(actor,courseId){
      communityAccess(actor,courseId);
      return transaction(()=>{
        const removed=db.prepare('DELETE FROM community_members WHERE course_id=? AND user_id=?').run(courseId,actor.id).changes;
        if(removed)audit(actor.id,'community.left',courseId);
        return {joined:false};
      });
    },
    communityPosts(actor,courseId){
      communityAccess(actor,courseId,true);
      return db.prepare(`SELECT p.id,p.course_id AS courseId,p.topic_id AS topicId,
        p.author_id AS authorId,p.parent_id AS parentId,p.body,p.created_at AS createdAt
        FROM community_posts p WHERE p.course_id=? AND p.hidden_at IS NULL
        AND (p.parent_id IS NULL OR EXISTS(
          SELECT 1 FROM community_posts parent WHERE parent.id=p.parent_id AND parent.hidden_at IS NULL
        )) ORDER BY p.created_at DESC,p.id DESC LIMIT 100`).all(courseId).reverse();
    },
    createCommunityPost(actor,courseId,{text,topicId=null,replyTo=null,creationKey}={}){
      communityAccess(actor,courseId,true);
      if(typeof text!=='string'||text.trim().length<3||text.trim().length>2000)throw error('INVALID_POST',422);
      if(typeof creationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(creationKey))throw error('INVALID_IDEMPOTENCY_KEY',422);
      if(topicId!==null && store.getTopic(topicId)?.courseId!==courseId)throw error('INVALID_TOPIC',422);
      if(replyTo!==null&&(typeof replyTo!=='string'||replyTo.length>80))throw error('INVALID_REPLY',422);
      const body=text.trim(),requestHash=sha(JSON.stringify({courseId,topicId,replyTo,body}));
      return transaction(()=>{
        const previous=db.prepare('SELECT * FROM community_posts WHERE author_id=? AND request_key=?').get(actor.id,creationKey);
        if(previous){
          if(previous.request_hash!==requestHash)throw error('IDEMPOTENCY_CONFLICT',409);
          return {post:{id:previous.id,courseId:previous.course_id,authorId:previous.author_id,
            topicId:previous.topic_id,parentId:previous.parent_id,body:previous.body,createdAt:previous.created_at},replayed:true};
        }
        if(replyTo!==null){
          const parent=db.prepare('SELECT course_id,hidden_at,parent_id FROM community_posts WHERE id=?').get(replyTo);
          if(!parent||parent.course_id!==courseId||parent.hidden_at||parent.parent_id!==null)throw error('INVALID_REPLY',422);
        }
        const recent=db.prepare('SELECT count(*) n FROM community_posts WHERE author_id=? AND created_at>?').get(actor.id,new Date(Date.now()-3600000).toISOString()).n;
        if(recent>=15)throw error('POST_RATE_LIMIT',429);
        const id=randomUUID(),createdAt=stamp();
        db.prepare('INSERT INTO community_posts(id,course_id,topic_id,author_id,parent_id,body,request_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id,courseId,topicId,actor.id,replyTo,body,creationKey,requestHash,createdAt);
        audit(actor.id,'community.post.created',id,{courseId,replyTo});
        return {post:{id,courseId,topicId,authorId:actor.id,parentId:replyTo,body,createdAt},replayed:false};
      });
    },
    reportCommunityPost(actor,postId,reason){
      requireVerified(actor);
      if(typeof reason!=='string'||reason.trim().length<10||reason.trim().length>1000)throw error('INVALID_REPORT',422);
      return transaction(()=>{
        const post=db.prepare('SELECT * FROM community_posts WHERE id=? AND hidden_at IS NULL').get(postId);
        if(!post)throw error('POST_NOT_FOUND',404);
        communityAccess(actor,post.course_id,true);
        if(post.author_id===actor.id)throw error('CANNOT_REPORT_SELF',403);
        const id=randomUUID();
        const inserted=db.prepare('INSERT OR IGNORE INTO community_reports(id,post_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)')
          .run(id,postId,actor.id,reason.trim(),stamp()).changes;
        if(!inserted)throw error('ALREADY_REPORTED',409);
        audit(actor.id,'community.post.reported',postId);
        return {id,postId};
      });
    },
    communityReportQueue(actor){
      requireAdmin(actor);
      return db.prepare(`SELECT r.id,r.post_id AS postId,r.reason,r.created_at AS createdAt,
        p.course_id AS courseId,p.author_id AS authorId,p.body FROM community_reports r
        JOIN community_posts p ON p.id=r.post_id WHERE r.status='open' ORDER BY r.created_at LIMIT 100`).all();
    },
    resolveCommunityReport(actor,reportId,{decision,reason}={}){
      requireAdmin(actor);
      if(!['dismiss','hide'].includes(decision)||typeof reason!=='string'||reason.trim().length<5||reason.trim().length>1000)throw error('INVALID_DECISION',422);
      return transaction(()=>{
        const row=db.prepare("SELECT post_id FROM community_reports WHERE id=? AND status='open'").get(reportId);
        if(!row)throw error('REPORT_CONFLICT',409);
        if(decision==='hide')db.prepare('UPDATE community_posts SET hidden_at=COALESCE(hidden_at,?) WHERE id=?').run(stamp(),row.post_id);
        const changed=db.prepare("UPDATE community_reports SET status=?,reviewed_by=?,review_note=? WHERE id=? AND status='open'").run(decision==='hide'?'hidden':'dismissed',actor.id,reason.trim(),reportId).changes;
        if(changed!==1)throw error('REPORT_CONFLICT',409);
        audit(actor.id,'community.report.resolved',reportId,{decision,postId:row.post_id});
        return {id:reportId,status:decision==='hide'?'hidden':'dismissed'};
      });
    },
    studySessions(actor,courseId){
      communityAccess(actor,courseId,true);
      const sql='SELECT s.id,s.course_id AS courseId,s.topic_id AS topicId,s.host_id AS hostId,s.title,s.description,s.starts_at AS startsAt,s.ends_at AS endsAt,s.capacity,s.status,s.cancellation_reason AS cancellationReason,s.created_at AS createdAt,(SELECT count(*) FROM study_attendees a WHERE a.session_id=s.id) AS attendeeCount,EXISTS(SELECT 1 FROM study_attendees a WHERE a.session_id=s.id AND a.user_id=?) AS joined FROM study_sessions s WHERE s.course_id=? ORDER BY s.starts_at ASC LIMIT 100';
      return db.prepare(sql).all(actor.id,courseId).map(x=>({...x,joined:Boolean(x.joined)}));
    },
    studySession(actor,id){
      requireVerified(actor);
      const row=db.prepare('SELECT * FROM study_sessions WHERE id=?').get(id);
      if(!row)throw error('SESSION_NOT_FOUND',404);
      communityAccess(actor,row.course_id,true);
      return row;
    },
    scheduleStudySession(actor,courseId,{topicId=null,title,description='',startsAt,endsAt,capacity=12,creationKey}={}){
      communityAccess(actor,courseId,true);
      if(typeof creationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(creationKey))throw error('INVALID_IDEMPOTENCY_KEY',422);
      if(topicId!==null && store.getTopic(topicId)?.courseId!==courseId)throw error('INVALID_TOPIC',422);
      if(typeof title!=='string'||title.trim().length<5||title.trim().length>120||typeof description!=='string'||description.trim().length>1000)throw error('INVALID_SESSION',422);
      if(!Number.isInteger(capacity)||capacity<2||capacity>50)throw error('INVALID_CAPACITY',422);
      const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString()===x;
      if(!validDate(startsAt)||!validDate(endsAt))throw error('INVALID_SCHEDULE',422);
      const now=Date.now(),start=Date.parse(startsAt),end=Date.parse(endsAt);
      const normalized={courseId,topicId,title:title.trim(),description:description.trim(),startsAt,endsAt,capacity};
      const requestHash=sha(JSON.stringify(normalized));
      return transaction(()=>{
        const old=db.prepare('SELECT request_hash,session_id FROM study_session_requests WHERE host_id=? AND request_key=?').get(actor.id,creationKey);
        if(old){
          if(old.request_hash!==requestHash)throw error('IDEMPOTENCY_CONFLICT',409);
          const x=db.prepare('SELECT * FROM study_sessions WHERE id=?').get(old.session_id);
          return {id:x.id,courseId:x.course_id,topicId:x.topic_id,hostId:x.host_id,title:x.title,description:x.description,startsAt:x.starts_at,endsAt:x.ends_at,capacity:x.capacity,status:x.status,attendeeCount:db.prepare('SELECT count(*) n FROM study_attendees WHERE session_id=?').get(x.id).n,joined:true,replayed:true};
        }
        if(start<now+300000||start>now+90*86400000||end<start+900000||end>start+14400000)throw error('INVALID_SCHEDULE',422);
        const recent=db.prepare('SELECT count(*) n FROM study_sessions WHERE host_id=? AND created_at>?').get(actor.id,new Date(now-86400000).toISOString()).n;
        if(recent>=10)throw error('SESSION_RATE_LIMIT',429);
        const id=randomUUID(),createdAt=stamp();
        db.prepare('INSERT INTO study_sessions(id,course_id,topic_id,host_id,title,description,starts_at,ends_at,capacity,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,courseId,topicId,actor.id,normalized.title,normalized.description,startsAt,endsAt,capacity,createdAt);
        db.prepare('INSERT INTO study_attendees VALUES(?,?,?)').run(id,actor.id,createdAt);
        db.prepare('INSERT INTO study_session_requests VALUES(?,?,?,?)').run(actor.id,creationKey,requestHash,id);
        audit(actor.id,'study.session.created',id,{courseId,capacity});
        return {id,...normalized,hostId:actor.id,status:'scheduled',attendeeCount:1,joined:true,replayed:false};
      });
    },
    rsvpStudySession(actor,id){
      this.studySession(actor,id);
      return transaction(()=>{
        const row=db.prepare('SELECT * FROM study_sessions WHERE id=?').get(id);
        if(row.status!=='scheduled'||Date.parse(row.starts_at)<=Date.now())throw error('SESSION_CLOSED',409);
        if(db.prepare('SELECT 1 FROM study_attendees WHERE session_id=? AND user_id=?').get(id,actor.id))return {joined:true,replayed:true};
        if(db.prepare('SELECT count(*) n FROM study_attendees WHERE session_id=?').get(id).n>=row.capacity)throw error('SESSION_FULL',409);
        db.prepare('INSERT INTO study_attendees VALUES(?,?,?)').run(id,actor.id,stamp());
        audit(actor.id,'study.session.joined',id);return {joined:true,replayed:false};
      });
    },
    leaveStudySession(actor,id){
      const row=this.studySession(actor,id);
      if(row.host_id===actor.id)throw error('HOST_CANNOT_WITHDRAW',409);
      return transaction(()=>{
        const current=db.prepare('SELECT * FROM study_sessions WHERE id=?').get(id);
        if(current.status!=='scheduled'||Date.parse(current.starts_at)<=Date.now())throw error('SESSION_CLOSED',409);
        const removed=db.prepare('DELETE FROM study_attendees WHERE session_id=? AND user_id=?').run(id,actor.id).changes;
        if(removed)audit(actor.id,'study.session.withdrawn',id);
        return {joined:false,replayed:removed===0};
      });
    },
    cancelStudySession(actor,id,reason){
      const row=this.studySession(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>500)throw error('INVALID_REASON',422);
      return transaction(()=>{
        const current=db.prepare('SELECT status,cancellation_reason FROM study_sessions WHERE id=?').get(id);
        if(current.status==='cancelled'){
          if(current.cancellation_reason===reason.trim())return {status:'cancelled',replayed:true};
          throw error('SESSION_CLOSED',409);
        }
        if(current.status!=='scheduled')throw error('SESSION_CLOSED',409);
        db.prepare("UPDATE study_sessions SET status='cancelled',cancellation_reason=? WHERE id=? AND status='scheduled'").run(reason.trim(),id);
        audit(actor.id,'study.session.cancelled',id,{reason:reason.trim()});
        return {status:'cancelled',replayed:false};
      });
    },
    completeStudySession(actor,id){
      const row=this.studySession(actor,id);
      if(row.host_id!==actor.id)throw error('FORBIDDEN',403);
      return transaction(()=>{
        const current=db.prepare('SELECT status,ends_at FROM study_sessions WHERE id=?').get(id);
        if(current.status==='completed')return {status:'completed',replayed:true};
        if(current.status!=='scheduled'||Date.parse(current.ends_at)>Date.now())throw error('SESSION_CLOSED',409);
        db.prepare("UPDATE study_sessions SET status='completed' WHERE id=? AND status='scheduled'").run(id);
        audit(actor.id,'study.session.completed',id);
        return {status:'completed',replayed:false};
      });
    },
    setLessonPrice:commerce.setPrice,
    createPurchaseOrder:commerce.createOrder,
    applyVerifiedTestCharge:commerce.applyVerifiedTestCharge,
    applySyntheticRefund:commerce.applySyntheticRefund,
    sandboxCheckout:commerce.sandboxCheckout,
    confirmSandboxOrder:commerce.confirmSandboxOrder,
    getPurchaseOrder:commerce.orderStatus,
    reconcilePurchase:commerce.reconcilePurchase,
    simulatePaymentReversal:commerce.simulateReversal,
    receivePaymentWebhook:commerce.receiveWebhook,
    drainPaymentInbox:commerce.drainInbox,
    recoverPendingPayments:commerce.recoverPending,
    paymentReconciliation:commerce.reconciliation,
    myPaymentDisputes:commerce.disputes,
    resolvePaymentDispute:commerce.resolveDispute,
    myPurchaseOrders:commerce.ownOrders,
    creatorEarnings:commerce.creatorEarnings,
    lessonAccess:commerce.lessonAccess,
    auditCount(){return db.prepare('SELECT count(*) AS n FROM audit_events').get().n;}
  };
  return store;
}
function validateEmail(email){const value=String(email??'').trim().toLowerCase();if(value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw error('INVALID_EMAIL',422);return value;}
function validatePassword(pw){if(typeof pw!=='string'||pw.length<12||pw.length>128)throw error('INVALID_PASSWORD',422);}
function requireAdmin(u){if(!u||u.role!=='admin'||u.suspended)throw error('ADMIN_REQUIRED',403);}
function requireVerifiedUser(u){if(!u||u.role!=='student'||!u.verifiedAt||u.suspended||!u.institutionId)throw error('VERIFICATION_REQUIRED',403);}
function validateDraft(input){
  if(input.rightsAttested!==true)throw error('RIGHTS_REQUIRED',422);
  const v={};for(const [key,max,min] of [['title',160,3],['description',2500,0],['previewText',800,0],['lessonText',25000,100]]){
    if(typeof input[key]!=='string')throw error('INVALID_LESSON',422);
    const t=input[key].trim();if(t.length<min||t.length>max)throw error('INVALID_LESSON',422);v[key]=t;
  }
  return {...v,rightsAttested:true};
}
export function getLocalDbPath(env=process.env){
  const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
  return env.LOCAL_SQLITE_PATH||resolve(repositoryRoot,'.local-data','campus.sqlite');
}
export function getLocalStore(){
  if(process.env.APP_DATA_MODE&&process.env.APP_DATA_MODE!=='local')throw error('LOCAL_MODE_DISABLED',503);
  if(process.env.VERCEL||process.env.AWS_LAMBDA_FUNCTION_NAME||process.env.NETLIFY)throw error('LOCAL_MODE_UNAVAILABLE_ON_SERVERLESS',503);
  const path=getLocalDbPath();
  const rawCap=process.env.PILOT_STUDENT_CAP;
  const pilotStudentCap=rawCap===undefined?null:(/^[1-9]\d{0,3}$/.test(rawCap)?Number(rawCap):NaN);
  const pilotAllowedEmail=process.env.PILOT_STUDENT_EMAIL??null;
  const pilotInviteToken=process.env.PILOT_STUDENT_INVITE_TOKEN??null;
  if(!globalThis.__campusLocalStore||globalThis.__campusLocalStorePath!==path){
    globalThis.__campusLocalStore?.close();
    globalThis.__campusLocalStore=openLocalStore(path,{pilotStudentCap,pilotAllowedEmail,pilotInviteToken});
    globalThis.__campusLocalStorePath=path;
  }
  return globalThis.__campusLocalStore;
}
