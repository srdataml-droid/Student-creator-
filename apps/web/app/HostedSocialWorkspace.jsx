'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useParams} from 'next/navigation';
import {useHostedAccount} from './HostedAccountProvider.jsx';
import HostedGate from './HostedGate.jsx';
import {PlatformIntro} from './PublicFeedLayout.jsx';
import {WatchCard} from './WatchCard.jsx';
import {ShareContent,ContinueWatching} from './WatchActions.jsx';
import {SavedControls} from './HostedSaved.jsx';
import {HostedCheckout} from './HostedLearningWorkspace.jsx';
import {makeDraftKey} from '../lib/studio-workflow.mjs';
import {validatePlaybackGrant,mergePrivateMessages} from '../lib/hosted-creator-client.mjs';
function useJob(){
 const lock=useRef(false);const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn(setNotice);}catch(e){setError(e.message==='HLS_UNSUPPORTED'?'This browser requires an HLS player that is not installed yet.':e.status===403?'Access denied. Check membership and viewing permissions.':e.status===401?'Sign in again.':e.code==='ASSET_NOT_READY'?'All assets must be ready and pass scanning before review.':e.status===429?'Rate limit reached. Try again later.':'The request could not be confirmed. Refresh before retrying.');}finally{lock.current=false;setBusy(false);}}
 return {busy,error,notice,run};
}
function Feedback({job}){return <>{job.error&&<p role="alert">{job.error}</p>}{job.notice&&<p role="status">{job.notice}</p>}</>;}
export function ReviewSubmission({lessonId}){
 const account=useHostedAccount(),job=useJob();const [result,setResult]=useState(null);
 return <section className="panel"><h2>Review and publish</h2><p>Send your original work for independent review. A ready video is not automatically approved.</p><button type="button" className="primary-link" disabled={job.busy||!lessonId||result===lessonId} onClick={()=>job.run(async notice=>{const out=await account.creatorRequest('submitReview',{lessonId});if(out.lesson?.id!==lessonId||out.lesson.status!=='in_review')throw Error('UNCONFIRMED');setResult(lessonId);notice('Submitted for independent review.');})}>Submit for review</button><Feedback job={job}/></section>;
}
export function HostedModeration(){
 const account=useHostedAccount(),job=useJob();
 return <HostedGate title="Content moderation"><section className="panel"><p>Staff only. The server verifies staff status and prevents self-approval. Enter the exact review item ID; a hosted review queue is not yet connected.</p><form className="form-stack" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);job.run(async notice=>{const lessonId=String(d.get('lessonId')).trim(),decision=d.get('decision');const out=await account.creatorRequest('moderate',{lessonId,decision,reason:d.get('reason')});if(out.lesson?.id!==lessonId||out.lesson.status!==(decision==='approve'?'published':'rejected'))throw Error('UNCONFIRMED');notice('Server confirmed: '+out.lesson.status);});}}><label htmlFor="review-id">Content ID</label><input id="review-id" name="lessonId" required maxLength={36}/><label htmlFor="review-decision">Decision</label><select id="review-decision" name="decision" required defaultValue=""><option value="" disabled>Choose decision</option><option value="approve">Approve</option><option value="reject">Reject</option></select><label htmlFor="review-reason">Reason</label><textarea id="review-reason" name="reason" minLength={5} maxLength={1000} required/><button className="primary-link" disabled={job.busy}>Confirm decision</button></form><Feedback job={job}/></section></HostedGate>;
}
export function HostedPersonalizedFeed({initialQuery=''}){
 const account=useHostedAccount(),job=useJob();const [items,setItems]=useState(null),[mode,setMode]=useState('all'),[query,setQuery]=useState(initialQuery);
 const campus=account.accountState?.profile?.institutionId;
 async function load(next,q=query){if(next==='campus'&&!campus)return;setMode(next);setItems(null);await job.run(async()=>{const r=await account.creatorRequest('feed',{mode:next==='following'?'following':'all',q,...(next==='campus'?{institutionId:campus}:{})});if(!Array.isArray(r))throw Error('INVALID_FEED');setItems(r);});}
 useEffect(()=>{void load('all',initialQuery);},[initialQuery]);
 return <section className="feed-area"><h2 className="visually-hidden">{initialQuery?'Search results':'Discover student content'}</h2><form className="form-stack secondary-search-form" onSubmit={e=>{e.preventDefault();load(mode);}}><label htmlFor="personalized-query">Search visible posts</label><input id="personalized-query" value={query} onChange={e=>setQuery(e.target.value)} maxLength={80} disabled={job.busy}/><button type="submit" className="secondary-link" disabled={job.busy}>Search</button></form><div className="feed-tabs" role="group" aria-label="Personalized feed"><button type="button" disabled={job.busy} aria-pressed={mode==='all'} className={mode==='all'?'active':''} onClick={()=>load('all')}>For you</button>{campus&&<button type="button" disabled={job.busy} aria-pressed={mode==='campus'} className={mode==='campus'?'active':''} onClick={()=>load('campus')}>Your campus</button>}<button type="button" disabled={job.busy} aria-pressed={mode==='following'} className={mode==='following'?'active':''} onClick={()=>load('following')}>Following</button><Link href="/shorts" className="watch-live-tab">Shorts</Link><Link href="/communities?tab=night" className="watch-live-tab">Live</Link></div>{items===null&&!job.busy&&<p className="hint">No results loaded. Select a feed to try again.</p>}{job.busy&&<p role="status">Loading…</p>}{items?.length===0&&(mode!=='all'||initialQuery)&&<p className="hint">No published posts in this feed yet.</p>}
 {mode==='all'&&!initialQuery&&items&&<ContinueWatching items={items} actor={account.session.userId}/>}<h2 className="feed-title">{initialQuery?'Search results':mode==='following'?'Following':mode==='campus'?'Your campus':'Recommended for you'}</h2><div className="watch-feed-grid watch-catalog">{mode==='all'&&!initialQuery&&<PlatformIntro/>}{items?.map(p=><WatchCard post={p} key={p.id}>{p.creatorId!==account.session.userId&&<button className="watch-action" type="button" disabled={job.busy} onClick={()=>job.run(async()=>{const expected=!p.following;const r=await account.creatorRequest(expected?'follow':'unfollow',{creatorId:p.creatorId});if(r.following!==expected)throw Error('UNCONFIRMED');setItems(old=>old?.map(x=>x.creatorId===p.creatorId?{...x,following:expected}:x).filter(x=>mode!=='following'||x.following));})}>{p.following?'Unfollow':'Follow'}</button>}{p.creatorId!==account.session.userId&&<Link className="watch-action" href={'/messages/'+p.creatorId}>Message creator</Link>}</WatchCard>)}</div><Feedback job={job}/></section>;
}
export function HostedFeedBoundary({children,query=''}){
 const account=useHostedAccount();
 if(!account||account.session.state==='guest')return children;
 if(account.session.state==='signed-in'&&account.accountState?.student===true)return <HostedPersonalizedFeed key={account.session.userId+query} initialQuery={query}/>;
 return children;
}
function Player({lessonId}){
 const account=useHostedAccount(),job=useJob(),video=useRef(null),position=useRef(0),lastSaved=useRef(0);
 const [grant,setGrant]=useState(null),[resume,setResume]=useState(0),[playerError,setPlayerError]=useState('');
 const storageKey='student-creators:resume:'+account.session.userId+':'+lessonId;
 useEffect(()=>{try{const value=Number(localStorage.getItem(storageKey)||0);if(Number.isFinite(value)&&value>=0&&value<86400){position.current=value;setResume(value);}}catch{}},[storageKey]);
 function record(time){if(!Number.isFinite(time)||time<0||time>=86400)return;position.current=time;if(Math.abs(time-lastSaved.current)>=5){lastSaved.current=time;try{localStorage.setItem(storageKey,String(Math.floor(time)));}catch{}}}
 useEffect(()=>{
  if(!grant)return;const element=video.current;if(!element)return;let cancelled=false,hls;
  const stop=()=>{element.pause();hls?.destroy();hls=null;element.removeAttribute('src');element.load();};
  const fail=()=>{if(cancelled)return;setPlayerError('Playback stopped. Request a fresh playback grant to try again.');setGrant(null);};
  const timer=setTimeout(()=>{if(!cancelled){stop();setGrant(null);}},Math.max(0,grant.expiresAt*1000-Date.now()));
  async function connect(){
   const {default:Hls}=await import('hls.js');
   if(cancelled)return;
   if(!Hls.isSupported()){if(element.canPlayType('application/vnd.apple.mpegurl')){element.src=grant.url;return;}throw Error('HLS_UNSUPPORTED');}
   hls=new Hls({enableWorker:false,capLevelToPlayerSize:true,maxBufferLength:25});
   hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)fail();});
   hls.on(Hls.Events.MEDIA_ATTACHED,()=>{if(!cancelled)hls.loadSource(grant.url);});hls.attachMedia(element);
  }
  void connect().catch(fail);
  return()=>{cancelled=true;clearTimeout(timer);stop();try{localStorage.setItem(storageKey,String(Math.floor(position.current)));}catch{}};
 },[grant,storageKey]);
 async function start(){setPlayerError('');await job.run(async()=>{const r=validatePlaybackGrant(await account.creatorRequest('playback',{lessonId}));setGrant(r);});}
 return <section className="watch-player-section" aria-label="Video player"><div className="watch-player-frame">{grant?<video ref={video} controls controlsList="nodownload" disablePictureInPicture playsInline preload="metadata" onLoadedMetadata={e=>{const t=position.current;if(t>0&&t<e.currentTarget.duration)e.currentTarget.currentTime=t;}} onTimeUpdate={e=>record(e.currentTarget.currentTime)} onError={()=>{setGrant(null);setPlayerError('Playback stopped. Request a fresh playback grant to try again.');}} onEnded={()=>{position.current=0;setResume(0);try{localStorage.removeItem(storageKey);}catch{}}}/>:<button type="button" className="watch-play-button" disabled={job.busy} onClick={start}><svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="currentColor"/><path d="M19 14 34 24 19 34Z" fill="#151515"/></svg><span>{job.busy?'Requesting access…':resume||position.current?'Resume video':'Play video'}</span></button>}</div><p className="hint">Viewing permission is checked for each playback grant. Your position is saved on this device only.</p>{playerError&&<p role="alert">{playerError}</p>}<Feedback job={job}/></section>;
}
function Engagement({lessonId}){
 const account=useHostedAccount(),job=useJob(),keyRef=useRef('');const [rows,setRows]=useState(null),[liked,setLiked]=useState(null),[text,setText]=useState(''),[reply,setReply]=useState(null);
 async function load(){const [comments,likes]=await Promise.all([account.creatorRequest('comments',{contentId:lessonId}),account.creatorRequest('myLikes',{})]);if(!Array.isArray(comments)||!Array.isArray(likes))throw Error('INVALID_RESPONSE');setRows(comments);setLiked(likes.some(x=>x.content_id===lessonId));}
 return <section className="watch-discussion"><div className="watch-social-actions"><ShareContent contentId={lessonId}/><SavedControls lessonId={lessonId}/><button type="button" className="secondary-link" disabled={job.busy} onClick={()=>job.run(load)}>{rows===null?'Load discussion and likes':'Refresh discussion'}</button>{liked!==null&&<button type="button" className="secondary-link" disabled={job.busy} onClick={()=>job.run(async()=>{await account.creatorRequest(liked?'unlike':'like',{contentId:lessonId});await load();})}>{liked?'Unlike':'Like'}</button>}</div><h2>Discussion</h2>{rows===null?<p className="hint">Open the discussion to read and reply to comments.</p>:rows.length===0?<p className="hint">No comments yet.</p>:null}{rows!==null&&<><ul className="watch-comments">{rows.map(r=><li key={r.id} className={r.parent_id?'watch-comment reply':'watch-comment'}><span className="watch-comment-avatar" aria-hidden="true">●</span><div><small>{r.author_id===account.session.userId?'You':'Community member'} · {r.created_at?new Date(r.created_at).toLocaleString():''}</small><p>{r.body}</p><button type="button" className="quiet-button" disabled={job.busy} onClick={()=>{keyRef.current='';setReply(r.id);document.getElementById('hosted-comment')?.focus();}}>Reply</button></div></li>)}</ul><form className="form-stack" onSubmit={e=>{e.preventDefault();job.run(async notice=>{keyRef.current||=makeDraftKey();await account.creatorRequest('comment',{contentId:lessonId,text,creationKey:keyRef.current,replyTo:reply});setText('');setReply(null);keyRef.current='';notice('Comment accepted.');await load();});}}>{reply&&<div className="watch-reply-context"><span>Replying to a comment</span><button type="button" className="quiet-button" onClick={()=>{setReply(null);keyRef.current='';}}>Cancel reply</button></div>}<label htmlFor="hosted-comment">{reply?'Your reply':'Your comment'}</label><textarea id="hosted-comment" value={text} onChange={e=>{setText(e.target.value);keyRef.current='';}} disabled={job.busy} required minLength={3} maxLength={800}/><button className="primary-link" disabled={job.busy}>Post comment</button></form></>}<Feedback job={job}/></section>;
}
export function HostedLesson({lessonId,preview,checkoutMode,terms}){
 const account=useHostedAccount(),signedIn=account?.session.state==='signed-in';
 return <main id="main" className="main hosted-workspace watch-detail"><Link className="watch-back" href="/">← Back to feed</Link>
 {signedIn?<div key={account.session.userId+':'+lessonId}><Player lessonId={lessonId}/><div className="watch-detail-copy"><h1>{preview?.title||'Watch student work'}</h1>{preview&&<><p className="hint">{preview.institutionName} · {preview.courseCode}</p>{preview.previewText&&<p>{preview.previewText}</p>}</>}</div><Engagement lessonId={lessonId}/><HostedCheckout lessonId={lessonId} mode={checkoutMode} terms={terms}/></div>:<><div className="watch-media-space watch-guest-player" aria-hidden="true"><span>▶</span></div><div className="watch-detail-copy"><h1>{preview?.title||'Watch student work'}</h1>{preview&&<><p className="hint">{preview.institutionName} · {preview.courseCode}</p>{preview.previewText&&<p>{preview.previewText}</p>}<ShareContent contentId={lessonId} title={preview.title}/></>}<p className="hint">Sign in to request full video access, save or purchase content.</p><Link className="primary-link" href="/sign-in">Sign in</Link></div></>}
 </main>;
}
export function HostedInbox(){
 const account=useHostedAccount(),job=useJob();const [rows,setRows]=useState(null),[before,setBefore]=useState(null),[query,setQuery]=useState('');
 const signedIn=account?.session.state==='signed-in';
 function load(append=false){if(!signedIn)return;job.run(async()=>{const r=await account.creatorRequest('inbox',{before:append?before:null});if(!Array.isArray(r.inbox))throw Error('INVALID_INBOX');setRows(old=>append?[...new Map([...(old||[]),...r.inbox].map(x=>[x.peerId,x])).values()]:r.inbox);setBefore(r.nextBefore||null);});}
 useEffect(()=>{if(signedIn)load();},[signedIn]);
 const label=x=>x.displayName||x.handle||('Student '+x.peerId.slice(0,8));
 const shown=(rows||[]).filter(x=>label(x).toLowerCase().includes(query.trim().toLowerCase()));
 return <main id="main" className="main watch-section-page watch-inbox"><h1>Inbox</h1><p className="hint">Your personal messages.</p><section aria-label="Conversations"><div className="watch-inbox-toolbar"><label className="visually-hidden" htmlFor="inbox-search">Search conversations</label><input id="inbox-search" type="search" placeholder="Search conversations" value={query} onChange={e=>setQuery(e.target.value)} disabled={!signedIn||!rows}/>{signedIn&&<button type="button" className="quiet-button" disabled={job.busy} onClick={()=>load()}>Refresh inbox</button>}</div>
 {!signedIn?<div className="watch-access-note"><h2>Sign in to see your messages</h2><p className="hint">Private conversations belong to your account.</p><Link className="primary-link" href="/sign-in">Sign in</Link></div>:job.busy&&rows===null?<p role="status">Loading messages…</p>:rows?.length===0?<div className="watch-access-note"><h2>No conversations yet</h2><p className="hint">Find student creators and start an eligible conversation.</p><Link className="secondary-link" href="/">Discover content</Link></div>:<ul className="community-preview-list">{shown.map(x=><li key={x.peerId}><Link className="community-preview-item" href={'/messages/'+x.peerId}><span className="watch-avatar" aria-hidden="true">{label(x).charAt(0).toUpperCase()}</span><span className="community-preview-copy"><strong>{label(x)}</strong>{x.lastMessageAt&&<small>{new Date(x.lastMessageAt).toLocaleString()}</small>}</span><span>{x.unreadCount>0?x.unreadCount+' unread':'›'}</span></Link></li>)}</ul>}
 {rows?.length>0&&!shown.length&&<p className="hint">No matching conversations.</p>}{before&&signedIn&&<button type="button" className="quiet-button" disabled={job.busy} onClick={()=>load(true)}>Older conversations</button>}<Feedback job={job}/></section></main>;
}
export function HostedConversation(){
 const {creatorId:peer}=useParams(),account=useHostedAccount();
 return <HostedGate title="Conversation"><Thread key={(account?.session.userId||'guest')+peer} peer={peer}/></HostedGate>;
}
function Thread({peer}){
 const account=useHostedAccount(),job=useJob();const [rows,setRows]=useState([]),[before,setBefore]=useState(null),[blocked,setBlocked]=useState(null),[text,setText]=useState('');
 async function load(append=false){const r=await account.creatorRequest('thread',{peerId:peer,before:append?before:null});if(typeof r.blocked!=='boolean')throw Error('INVALID_THREAD');const incoming=mergePrivateMessages([],r.messages,account.session.userId,peer);setRows(old=>append?mergePrivateMessages(old,incoming,account.session.userId,peer):incoming);setBefore(r.nextBefore||null);setBlocked(r.blocked);}
 useEffect(()=>{void job.run(()=>load());},[peer]);
 return <section className="panel"><Link href="/messages">Back to inbox</Link><p className="hint">Private messages are not end-to-end encrypted. Check messages before retrying an uncertain send.</p><div className="button-row"><button type="button" disabled={job.busy} onClick={()=>job.run(()=>load())}>Refresh</button>{before&&<button type="button" disabled={job.busy} onClick={()=>job.run(()=>load(true))}>Older messages</button>}{blocked!==null&&<button type="button" disabled={job.busy} onClick={()=>job.run(async()=>{const r=await account.creatorRequest(blocked?'unblock':'block',{peerId:peer});if(r.blocked!==!blocked)throw Error('UNCONFIRMED');await load();})}>{blocked?'Unblock':'Block contact'}</button>}</div><div className="message-thread">{rows.map(m=><article key={m.id} className={m.senderId===account.session.userId?'message-bubble own':'message-bubble'}><p>{m.body}</p><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time></article>)}</div>{rows.some(m=>m.recipientId===account.session.userId)&&<button type="button" disabled={job.busy} onClick={()=>job.run(async notice=>{const ids=rows.filter(m=>m.recipientId===account.session.userId).slice(-100).map(m=>m.id);await account.creatorRequest('readMessages',{peerId:peer,messageIds:ids});notice('Read acknowledgement accepted.');})}>Mark displayed messages read</button>}
 {blocked===false&&<form className="form-stack" onSubmit={e=>{e.preventDefault();job.run(async notice=>{const result=await account.creatorRequest('send',{peerId:peer,text});mergePrivateMessages([],[result],account.session.userId,peer);setText('');notice('Message accepted by server.');await load();});}}><label htmlFor="hosted-message">Message</label><textarea id="hosted-message" value={text} maxLength={2000} required disabled={job.busy} onChange={e=>setText(e.target.value)}/><button className="primary-link" disabled={job.busy||!text.trim()}>Send message</button></form>}<Feedback job={job}/></section>;
}
export function HostedNotifications(){
 const account=useHostedAccount(),job=useJob(),[rows,setRows]=useState(null);
 async function load(){const r=await account.creatorRequest('notifications',{});if(!Array.isArray(r))throw Error('INVALID_RESPONSE');setRows(r);}
 useEffect(()=>{if(account.session.state==='signed-in')void job.run(load);},[account.session.state]);
 return <HostedGate title="Notifications"><section className="panel"><button type="button" disabled={job.busy} onClick={()=>job.run(load)}>Refresh notifications</button>{rows?.length===0&&<p>No notifications.</p>}<ul>{rows?.map(n=><li key={n.id}><p>{String(n.kind).replaceAll('_',' ')} · {new Date(n.created_at).toLocaleString()}</p>{!n.read_at&&<button type="button" disabled={job.busy} onClick={()=>job.run(async()=>{await account.creatorRequest('readNotification',{id:n.id});await load();})}>Mark read</button>}</li>)}</ul><Feedback job={job}/></section></HostedGate>;
}
