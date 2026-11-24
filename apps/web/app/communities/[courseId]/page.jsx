'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {api,friendlyError} from '../../../lib/local-client.js';

/** Course discussions are local-first and visible only to verified joined students. */
export default function CourseCommunity(){
  const {courseId}=useParams();
  const [state,setState]=useState('loading'),[status,setStatus]=useState(null),[posts,setPosts]=useState([]),[topics,setTopics]=useState([]);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [draft,setDraft]=useState(''),[topicId,setTopicId]=useState(''),[replyTo,setReplyTo]=useState(null),[key,setKey]=useState(()=>crypto.randomUUID());
  const [reportId,setReportId]=useState(null),[reportReason,setReportReason]=useState('');
  async function refresh(){
    try{
      const [feed,taxonomy]=await Promise.all([api(`courses/${courseId}/community`),api(`courses/${courseId}/topics`)]);
      setStatus(feed.status);setPosts(feed.posts);setTopics(taxonomy.topics);setState('ready');
    }catch(e){setState(e.status===401?'signed-out':e.status===404?'not-found':e.status===403?'unverified':'unavailable');}
  }
  useEffect(()=>{if(courseId)refresh();},[courseId]);
  async function action(task,success){setBusy(true);setError('');setMessage('');try{await task();setMessage(success);await refresh();}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
  async function submit(event){
    event.preventDefault();
    await action(async()=>{
      await api(`courses/${courseId}/posts`,{method:'POST',body:{text:draft,topicId:topicId||null,replyTo,creationKey:key}});
      setDraft('');setTopicId('');setReplyTo(null);setKey(crypto.randomUUID());
    },'Your contribution was saved.');
  }
  async function hide(postId){
    const reason=window.prompt('Reason for hiding this contribution (minimum 5 characters)');
    if(reason===null)return;
    await action(()=>api(`courses/${courseId}/posts/${postId}/hide`,{method:'POST',body:{reason}}),'Contribution hidden; the action is recorded for review.');
  }
  const roots=posts.filter(p=>p.parentId===null);
  return <main id="main" className="main"><Link className="back" href={`/courses/${courseId}`}>← Back to course</Link>
    <section className="hero compact"><p className="eyebrow">Verified campus community</p><h1>{status?.course?.code||'Course'} discussion</h1>
      <p className="intro">Ask how a concept works, show your reasoning and help classmates learn. No exam leaks or assignments written for someone else.</p></section>
    {state==='loading'?<p role="status">Loading community…</p>:
      state==='signed-out'?<p className="status">Please <Link href="/sign-in">sign in</Link> to join your course community.</p>:
      state==='unverified'?<p role="alert" className="status">Your campus membership must be verified first. Contact your administrator.</p>:
      state==='not-found'?<p role="alert" className="status">This community is not available in your campus.</p>:
      state==='unavailable'?<p role="alert" className="status">Local community data is unavailable. Check your local server.</p>:<>
      <p className="hint">{status.memberCount} member{status.memberCount===1?'':'s'} · {status.course.title}{status.canModerate?' · Community moderator':''}</p>
      {error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status" className="form-success">{message}</p>}
      {!status.joined?<section className="panel"><h2>Join this class discussion</h2><p>Only verified students enrolled at the matching campus can join. Posts are not publicly indexed.</p>
        <button disabled={busy} className="primary-link" onClick={()=>action(()=>api(`courses/${courseId}/join`,{method:'POST',body:{}}),'You joined the course discussion.')}>Join discussion</button></section>:<>
        <div className="heading-row"><h2>Discussions</h2><button disabled={busy} className="quiet-button" onClick={()=>action(()=>api(`courses/${courseId}/leave`,{method:'POST',body:{}}),'You left this community. Your previous contributions remain.')}>Leave discussion</button></div>
        <section className="panel community-composer"><h3>{replyTo?'Reply to discussion':'Start a discussion'}</h3>
          <form className="form-stack" onSubmit={submit}><label htmlFor="communityText">Your question or explanation</label>
          <textarea id="communityText" required minLength={3} maxLength={2000} rows={4} value={draft} onChange={e=>{setDraft(e.target.value);setKey(crypto.randomUUID());}} placeholder="For example: Why does the derivative of x² become 2x?"/>
          {!replyTo&&<><label htmlFor="topicPick">Course topic (optional)</label><select id="topicPick" value={topicId} onChange={e=>{setTopicId(e.target.value);setKey(crypto.randomUUID());}}><option value="">General discussion</option>{topics.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></>}
          {replyTo&&<button type="button" className="quiet-button" onClick={()=>{setReplyTo(null);setKey(crypto.randomUUID());}}>Cancel reply</button>}
          <button type="submit" disabled={busy||draft.trim().length<3} className="primary-link">Post to class</button></form></section>
        {roots.length===0?<p className="status">No discussions yet. Start with a question from today's lesson.</p>:<ul className="lesson-list community-feed">{roots.map(post=><li key={post.id} className="lesson"><p className="code">{topics.find(t=>t.id===post.topicId)?.name||'Class discussion'}</p><p className="community-text">{post.body}</p><p className="hint">Posted {new Date(post.createdAt).toLocaleString()}</p>
          <div className="button-row"><button className="quiet-button" onClick={()=>{setReplyTo(post.id);setTopicId('');setKey(crypto.randomUUID());document.getElementById('communityText')?.focus();}}>Reply</button><button className="quiet-button" onClick={()=>{setReportId(post.id);setReportReason('');}}>Report</button>{status.canModerate&&<button className="quiet-button" disabled={busy} onClick={()=>hide(post.id)}>Hide contribution</button>}</div>
          {posts.filter(p=>p.parentId===post.id).map(reply=><article key={reply.id} className="community-reply"><p className="community-text">{reply.body}</p><p className="hint">Reply · {new Date(reply.createdAt).toLocaleString()}</p><button className="quiet-text" onClick={()=>{setReportId(reply.id);setReportReason('');}}>Report reply</button>{status.canModerate&&<button className="quiet-text" disabled={busy} onClick={()=>hide(reply.id)}>Hide reply</button>}</article>)}
          {reportId&&(reportId===post.id||posts.some(p=>p.parentId===post.id&&p.id===reportId))&&<form className="form-stack community-report" onSubmit={e=>{e.preventDefault();action(async()=>{await api('community/posts/report',{method:'POST',body:{postId:reportId,reason:reportReason}});setReportId(null);setReportReason('');},'Your report was sent for administrator review.');}}><label htmlFor={`reason-${post.id}`}>Reason for reporting</label><textarea id={`reason-${post.id}`} required minLength={10} maxLength={1000} value={reportReason} onChange={e=>setReportReason(e.target.value)}/><div className="button-row"><button disabled={busy||reportReason.trim().length<10} className="secondary-link" type="submit">Send report</button><button className="quiet-button" type="button" onClick={()=>setReportId(null)}>Cancel</button></div></form>}
        </li>)}</ul>}
      </>}
    </>}
  </main>;
}
