'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';

const alias=id=>'Student · '+String(id||'').slice(0,6).toUpperCase();
export default function LessonComments({lessonId}){
 const [comments,setComments]=useState([]),[user,setUser]=useState(null),[loading,setLoading]=useState(true);
 const [text,setText]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const [reportFor,setReportFor]=useState(null),[reportReason,setReportReason]=useState(''),[replyTo,setReplyTo]=useState(null);
 const creationKey=useRef(null);
 async function refresh(){
  const [list,me]=await Promise.all([api(`lessons/${lessonId}/comments`),api('me').catch(()=>({user:null}))]);
  setComments(list.comments||[]);setUser(me.user);
 }
 useEffect(()=>{
  let active=true;
  setLoading(true);
  Promise.all([api(`lessons/${lessonId}/comments`),api('me').catch(()=>({user:null}))])
   .then(([list,me])=>{if(active){setComments(list.comments||[]);setUser(me.user);setLoading(false);}})
   .catch(err=>{if(active){setNotice(friendlyError(err));setLoading(false);}});
  return ()=>{active=false;};
 },[lessonId]);
 async function run(key,action,success){
  setBusy(key);setNotice('');
  try{await action();await refresh();setNotice(success);return true;}
  catch(error){setNotice(friendlyError(error));return false;}
  finally{setBusy('');}
 }
 async function publishComment(event){
  event.preventDefault();
  const draft=text.trim();if(draft.length<3)return;
  const key=creationKey.current||crypto.randomUUID();creationKey.current=key;
  const ok=await run('comment',()=>api(`lessons/${lessonId}/comments`,{method:'POST',body:{text:draft,creationKey:key,replyTo}}),'Your comment was published.');
  if(ok){creationKey.current=null;setText('');setReplyTo(null);}
 }
 async function report(event){
  event.preventDefault();if(!reportFor||reportReason.trim().length<10)return;
  const ok=await run('report',()=>api(`lesson-comments/${reportFor}/report`,{method:'POST',body:{reason:reportReason}}),'Report submitted for independent review.');
  if(ok){setReportFor(null);setReportReason('');}
 }
 return <section className="lesson-engagement panel" aria-label="Lesson discussion">
  <h2>Discussion</h2><p className="hint">Ask questions and discuss original lessons respectfully. Reports go to independent campus moderators.</p>
  {notice&&<p role="status" className="hint">{notice} {notice==='Please sign in to continue.'&&<Link href="/sign-in">Sign in</Link>}</p>}
  {loading?<p role="status">Loading comments…</p>:<ul className="small-list" aria-label="Recent lesson comments">
   {comments.map(comment=><li key={comment.id} className="lesson-comment">
    <div><strong>{alias(comment.authorId)}</strong> <span className="hint">· {new Date(comment.createdAt).toLocaleDateString('en-NG')}</span></div>
    {comment.parentId&&<p className="hint">↳ Reply to {comments.find(c=>c.id===comment.parentId)?alias(comments.find(c=>c.id===comment.parentId).authorId):'earlier comment'}</p>}
    <p className="community-text">{comment.body}</p>
    {!comment.parentId&&user?.verifiedAt&&!user?.suspended&&<button type="button" className="quiet-button" disabled={Boolean(busy)} onClick={()=>{setReplyTo(comment.id);creationKey.current=null;document.getElementById('lesson-comment-text')?.focus();}}>Reply</button>}
    {user?.id===comment.authorId?<button type="button" className="quiet-button" disabled={Boolean(busy)}
      onClick={()=>run('remove-'+comment.id,()=>api(`lesson-comments/${comment.id}/remove`,{method:'POST',body:{}}),'Your comment was removed.')}>Remove my comment</button>:
     <button type="button" className="quiet-button" disabled={Boolean(busy)}
      onClick={()=>{setReportFor(reportFor===comment.id?null:comment.id);setReportReason('');}}>Report comment</button>}
    {reportFor===comment.id&&<form className="form-stack" onSubmit={report}>
      <label htmlFor={`comment-report-${comment.id}`}>Why are you reporting this comment?</label>
      <textarea id={`comment-report-${comment.id}`} rows={2} minLength={10} maxLength={1000} required
       value={reportReason} onChange={event=>setReportReason(event.target.value)} />
      <button type="submit" className="secondary-link" disabled={Boolean(busy)||reportReason.trim().length<10}>Submit report</button>
    </form>}
   </li>)}
   {!comments.length&&<li className="hint">No comments yet. Add a helpful question or explanation.</li>}
  </ul>}
  {user?.role==='student'&&user.verifiedAt&&!user.suspended?<form className="form-stack" onSubmit={publishComment}>
    <label htmlFor="lesson-comment-text">{replyTo?'Your reply':'Your comment'}</label>
    {replyTo&&<button type="button" className="quiet-button" onClick={()=>{setReplyTo(null);creationKey.current=null;}}>Cancel reply</button>}
    <textarea id="lesson-comment-text" rows={3} required minLength={3} maxLength={800} value={text}
      onChange={event=>{setText(event.target.value);creationKey.current=null;}}
      placeholder="Ask a question or add a learning insight."/>
    <button type="submit" className="primary-link" disabled={Boolean(busy)||text.trim().length<3}>Post comment</button>
   </form>:<p className="hint"><Link href="/sign-in">Sign in</Link> with a verified student account to comment.</p>}
  <p className="hint">Never share private student records, leaked tests or work submitted as someone else's.</p>
 </section>;
}
