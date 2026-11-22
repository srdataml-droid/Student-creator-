'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';

const alias=id=>'Student · '+String(id||'').slice(0,6).toUpperCase();
export default function LessonEngagement({lessonId}){
 const [stats,setStats]=useState(null),[comments,setComments]=useState([]),[user,setUser]=useState(null);
 const [text,setText]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const [reportFor,setReportFor]=useState(null),[reportReason,setReportReason]=useState('');
 const creationKey=useRef(null);
 async function refresh(){
  const [e,c,me]=await Promise.all([
   api(`lessons/${lessonId}/engagement`),
   api(`lessons/${lessonId}/comments`),
   api('me').catch(()=>({user:null}))
  ]);
  setStats(e.engagement);setComments(c.comments||[]);setUser(me.user);
 }
 useEffect(()=>{
  let active=true;
  Promise.all([api(`lessons/${lessonId}/engagement`),api(`lessons/${lessonId}/comments`),api('me').catch(()=>({user:null}))])
   .then(([e,c,me])=>{if(active){setStats(e.engagement);setComments(c.comments||[]);setUser(me.user);}})
   .catch(error=>{if(active)setNotice(friendlyError(error));});
  return ()=>{active=false;};
 },[lessonId]);
 async function run(key,action,success){
  setBusy(key);setNotice('');
  try{await action();await refresh();setNotice(success);}
  catch(error){setNotice(friendlyError(error));}
  finally{setBusy('');}
 }
 async function publishComment(event){
  event.preventDefault();
  const draft=text.trim();if(draft.length<3)return;
  const key=creationKey.current||crypto.randomUUID();creationKey.current=key;
  setBusy('comment');setNotice('');
  try{
   await api(`lessons/${lessonId}/comments`,{method:'POST',body:{text:draft,creationKey:key}});
   creationKey.current=null;setText('');
   await refresh();setNotice('Your comment was published.');
  }catch(error){setNotice(friendlyError(error));}
  finally{setBusy('');}
 }
 async function report(event){
  event.preventDefault();if(!reportFor||reportReason.trim().length<10)return;
  setBusy('report');setNotice('');
  try{
   await api(`lesson-comments/${reportFor}/report`,{method:'POST',body:{reason:reportReason}});
   await refresh();setNotice('Your report has been sent for review.');
   setReportFor(null);setReportReason('');
  }catch(error){setNotice(friendlyError(error));}
  finally{setBusy('');}
 }
 return <section className="lesson-engagement panel" aria-label="Post reactions and comments">
  <h2>Join the conversation</h2>
  {!stats?<p role="status">Loading reactions…</p>:<div className="button-row">
   <button type="button" className="secondary-link" aria-pressed={Boolean(stats.liked)} disabled={Boolean(busy)}
    onClick={()=>run('like',()=>api(`lessons/${lessonId}/${stats.liked?'unlike':'like'}`,{method:'POST',body:{}}),stats.liked?'Like removed.':'You liked this post.')}>
    {stats.liked?'♥ Liked':'♡ Like'} · {stats.likes}
   </button>
   <span className="hint">{stats.comments} comments</span>
  </div>}
  {notice&&<p role="status" className="hint">{notice} {notice.includes('sign in')&&<Link href="/sign-in">Sign in</Link>}</p>}
  <ul className="small-list" aria-label="Comments">
   {comments.map(comment=><li key={comment.id} className="lesson-comment">
    <div><strong>{alias(comment.authorId)}</strong> <span className="hint">· {new Date(comment.createdAt).toLocaleDateString('en-NG')}</span></div>
    <p className="community-text">{comment.body}</p>
    {user?.id===comment.authorId?<button type="button" className="quiet-button" disabled={Boolean(busy)}
      onClick={()=>run('remove-'+comment.id,()=>api(`lesson-comments/${comment.id}/remove`,{method:'POST',body:{}}),'Your comment was removed.')}>Remove my comment</button>:
     <button type="button" className="quiet-button" disabled={Boolean(busy)}
      onClick={()=>{setReportFor(reportFor===comment.id?null:comment.id);setReportReason('');}}>Report comment</button>}
    {reportFor===comment.id&&<form className="form-stack" onSubmit={report}>
      <label htmlFor={`report-${comment.id}`}>Reason for reporting</label>
      <textarea id={`report-${comment.id}`} rows={2} minLength={10} maxLength={1000} required
       value={reportReason} onChange={event=>setReportReason(event.target.value)} />
      <button type="submit" className="secondary-link" disabled={Boolean(busy)||reportReason.trim().length<10}>Send report</button>
    </form>}
   </li>)}
   {!comments.length&&<li className="hint">No comments yet. Add a constructive question or explanation.</li>}
  </ul>
  {user?.role==='student'&&user.verifiedAt&&!user.suspended?<form className="form-stack" onSubmit={publishComment}>
    <label htmlFor="lesson-comment-text">Write a comment</label>
    <textarea id="lesson-comment-text" rows={3} required minLength={3} maxLength={800} value={text}
      onChange={event=>{setText(event.target.value);creationKey.current=null;}}
      placeholder="Ask a question or add a helpful learning insight." />
    <button type="submit" className="primary-link" disabled={Boolean(busy)||text.trim().length<3}>Post comment</button>
   </form>:<p className="hint"><Link href="/sign-in">Sign in</Link> with a verified student account to comment or like.</p>}
  <p className="hint">Be respectful. Do not share private student records, leaked assessments or someone else's work.</p>
 </section>;
}
