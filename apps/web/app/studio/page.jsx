'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {makeDraftKey,parseAccessPrice,mediaSelectionError,submissionBlock} from '../../lib/studio-workflow.mjs';
import {api,friendlyError} from '../../lib/local-client.js';
import CreatorRestrictions from './CreatorRestrictions.jsx';
const fresh=()=>({courseId:'',topicId:'',title:'',description:'',previewText:'',lessonText:'',rightsAttested:false,creationKey:''});
export default function Studio(){
 const [earnings,setEarnings]=useState(null),[priceInputs,setPriceInputs]=useState({}),[user,setUser]=useState(null),[courses,setCourses]=useState([]),[topics,setTopics]=useState([]),[items,setItems]=useState([]),[inbox,setInbox]=useState([]),[state,setState]=useState('loading'),[form,setForm]=useState(fresh),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[editingId,setEditingId]=useState(null),[videoFiles,setVideoFiles]=useState({}),[captionFiles,setCaptionFiles]=useState({}),[profile,setProfile]=useState({handle:'',displayName:'',bio:''}),[profileBusy,setProfileBusy]=useState(false),[profileError,setProfileError]=useState(''),[profileSaved,setProfileSaved]=useState('');
 const mutation=useRef(false),draftKey=useRef(''),mediaInputs=useRef({});
 const [topicsState,setTopicsState]=useState('idle');
 function begin(){if(mutation.current)return false;mutation.current=true;setBusy(true);setError('');setMessage('');return true;}
 function finish(){mutation.current=false;setBusy(false);}
 function resetDraft(){draftKey.current='';setEditingId(null);setForm(fresh());}
 function clearMedia(id,kind){const setter=kind==='video'?setVideoFiles:setCaptionFiles;setter(v=>({...v,[id]:null}));const input=mediaInputs.current[kind+'-'+id];if(input)input.value='';}
 function blockFor(item){return submissionBlock({item,editingId,priceInput:priceInputs[item.id],videoFile:videoFiles[item.id],captionFile:captionFiles[item.id]});}
 async function load(){try{const m=await api('me');setUser(m.user);const c=await api('courses');setCourses(c.courses);if(m.user.role==='student'&&m.user.verifiedAt){const x=await api('my/lessons');setItems(x.lessons);setPriceInputs(previous=>Object.fromEntries(x.lessons.map(item=>[item.id,previous[item.id]??String((item.priceKobo??0)/100)])));const earning=await api('my/creator-earnings');setEarnings(earning.earnings);const d=await api('messages/inbox');setInbox(d.inbox);const p=await api('my/creator-profile');setProfile(p.profile||{handle:'',displayName:'',bio:''});}setState('ready');}catch(e){setState(e.status===401?'signed-out':'unavailable');}}
 useEffect(()=>{load();},[]);
 useEffect(()=>{let active=true;setTopics([]);if(!form.courseId){setTopicsState('idle');return;}setTopicsState('loading');api(`courses/${form.courseId}/topics`).then(d=>{if(active){setTopics(Array.isArray(d.topics)?d.topics:[]);setTopicsState('ready');}}).catch(()=>{if(active)setTopicsState('error');});return()=>{active=false;};},[form.courseId]);
 async function submit(e){e.preventDefault();if(!begin())return;try{if(!editingId&&!draftKey.current)draftKey.current=makeDraftKey();const result=editingId?await api(`lessons/${editingId}/edit`,{method:'POST',body:{...form,topicId:form.topicId||null}}):await api('lessons/drafts',{method:'POST',body:{...form,creationKey:draftKey.current,topicId:form.topicId||null}});setMessage(editingId?'Lesson saved. Submit the updated version for review.':result.replayed?'Previous draft found. No duplicate was created.':'Your draft has been saved privately. Submit it for review below.');resetDraft();await load();}catch(e){setError(e.message==='SECURE_RANDOM_UNAVAILABLE'?'This browser cannot safely create drafts. Open the app over HTTPS.':friendlyError(e));}finally{finish();}}
 async function setAccessPrice(item){
  const amountKobo=parseAccessPrice(priceInputs[item.id]??String((item.priceKobo??0)/100));
  if(amountKobo===null){setError('Choose ₦0 (free) or a whole-naira price of ₦200 to ₦10,000,000.');return;}
  if(!begin())return;
  try{
   await api(`lessons/${item.id}/price`,{method:'POST',body:{amountKobo}});
   setMessage('Access price saved. The price locks when your lesson is published.');await load();
  }catch(e){setError(friendlyError(e));}finally{finish();}
 }
 async function send(item){const reason=blockFor(item);if(reason){setError(reason);return;}if(!begin())return;try{await api(`lessons/${item.id}/submit`,{method:'POST',body:{}});setMessage('Lesson submitted. A separate reviewer will decide whether it can be published.');await load();}catch(e){setError(friendlyError(e));}finally{finish();}}
 async function uploadVideo(id){
  const f=videoFiles[id],problem=mediaSelectionError(f,'video');if(problem){setError(problem);return;}
  if(!begin())return;
  try{
    const r=await fetch(`/api/local/lessons/${id}/video`,{method:'POST',headers:{'content-type':'video/mp4'},body:f,credentials:'same-origin',cache:'no-store'});
    const out=await r.json().catch(()=>({error:'INVALID_SERVER_RESPONSE'}));if(!r.ok)throw new Error(out.error||'UPLOAD_FAILED');
    setMessage('Video saved privately. A reviewer can preview it before publishing.');
    clearMedia(id,'video');await load();
  }catch(e){setError(friendlyError(e));}finally{finish();}
 }
 async function uploadCaptions(id){
  const file=captionFiles[id],problem=mediaSelectionError(file,'captions');if(problem){setError(problem);return;}
  if(!begin())return;
  try{
   const response=await fetch('/api/local/lessons/'+id+'/video/captions',{
    method:'POST',headers:{'content-type':'text/vtt; charset=utf-8'},body:await file.text(),
    credentials:'same-origin',cache:'no-store'
   });
   const result=await response.json().catch(()=>({error:'INVALID_SERVER_RESPONSE'}));
   if(!response.ok)throw new Error(result.error||'CAPTIONS_UPLOAD_FAILED');
   setMessage('English captions saved privately. A reviewer can inspect them with the video.');
   clearMedia(id,'captions');await load();
  }catch(e){setError(friendlyError(e));}finally{finish();}
 }
 async function savePublicProfile(e){
  e.preventDefault();setProfileBusy(true);setProfileError('');setProfileSaved('');
  try{
   const result=await api('my/creator-profile',{method:'POST',body:profile});
   setProfile(result.profile);setProfileSaved(result.replayed?'Your public profile is already current.':'Your public profile was saved.');
  }catch(error){setProfileError(friendlyError(error));}
  finally{setProfileBusy(false);}
 }
 async function toggleMessages(){setBusy(true);setError('');try{await api('messages/preference',{method:'POST',body:{allowMessages:!user.allowMessages}});setMessage('Your direct message preference was saved.');await load();}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function logout(){await api('auth/logout',{method:'POST',body:{}});window.location.assign('/');}
 return <main className="main" id="main"><section className="hero compact"><p className="eyebrow">Creator studio</p><h1>Creator studio</h1><p className="intro">Create, publish and manage your original work.</p></section>
 {state==='loading'?<p role="status">Opening your studio…</p>:state==='signed-out'?<div className="status"><p>Sign in to create lessons.</p><Link className="primary-link" href="/sign-in">Sign in</Link></div>:state==='unavailable'?<p role="alert" className="status">Your studio is temporarily unavailable. Please try again later.</p>:<>
 <div className="studio-meta"><p>Signed in as <strong>{user.email}</strong> · {user.verifiedAt?'Verified student':'Verification pending'}</p><div className="button-row"><Link className="secondary-link" href="/account-security">Account security</Link><button className="quiet-button" onClick={logout}>Sign out</button></div></div>
 {user.role==='student'&&user.verifiedAt&&<nav className="workspace-shortcuts" aria-label="Studio sections"><a href="#studio-editor">Create content</a><a href="#studio-content">Your posts</a><a href="#studio-profile">Profile</a><a href="#studio-earnings">Earnings</a></nav>}
 {user.role==='student'&&user.verifiedAt&&<section id="studio-profile" className="panel creator-profile-edit"><h2>Your public creator identity</h2>
 <p className="hint">Use a public alias, never your private school ID or account email. Handles identify individuals but do not mean a school or Worthkind endorses them. Names claiming official staff or university authority are reserved.</p>
 <form className="form-stack" onSubmit={savePublicProfile}>
  <label htmlFor="creator-handle">Unique public handle</label>
  <input id="creator-handle" autoComplete="username" required pattern="[A-Za-z][A-Za-z0-9_]{2,23}" minLength={3} maxLength={24}
   value={profile.handle} onChange={e=>setProfile({...profile,handle:e.target.value})} placeholder="e.g. samuel_builds" />
  <label htmlFor="creator-display-name">Display name</label>
  <input id="creator-display-name" autoComplete="nickname" required minLength={3} maxLength={60}
   value={profile.displayName} onChange={e=>setProfile({...profile,displayName:e.target.value})} placeholder="e.g. Samuel Builds" />
  <label htmlFor="creator-bio">Short public introduction (optional)</label>
  <textarea id="creator-bio" rows={2} maxLength={280} value={profile.bio}
   onChange={e=>setProfile({...profile,bio:e.target.value})} placeholder="What original material do you teach?" />
  {profileError&&<p role="alert" className="form-error">{profileError}</p>}
  {profileSaved&&<p role="status" className="form-success">{profileSaved}</p>}
  <button type="submit" className="primary-link" disabled={profileBusy||busy}>{profileBusy?'Saving profile…':'Save public profile'}</button>
 </form><p className="hint">Your public profile becomes discoverable only once a separate reviewer approves one of your lessons. <Link href={`/creators/${user.id}`}>Preview your creator page</Link> once published.</p></section>}
 {user.role==='student'&&user.verifiedAt&&<section id="studio-earnings" className="panel synthetic-earnings"><h2>Creator earnings</h2><p className="intro">Earnings and withdrawals are currently unavailable.</p><p className="hint">No funds are available to withdraw.</p></section>}
 {user.role==='student'&&user.verifiedAt&&<CreatorRestrictions creatorId={user.id} inbox={inbox}/>}
 {user.verifiedAt&&<section className="message-settings"><div><h2>Peer questions & messages</h2><p className="hint">You control whether new students may contact you about approved lessons. Existing conversations stay available unless you block a contact.</p><p className="hint">{inbox.length} conversations <Link href="/messages">Open inbox</Link></p></div><button className="secondary-link" type="button" disabled={busy} onClick={toggleMessages}>{user.allowMessages?'Disable new inquiries':'Allow new inquiries'}</button></section>}
 {!user.verifiedAt?<p className="status" role="status">Your campus membership is waiting for an administrator to verify it. Publishing is disabled until approval.</p>:<div className="studio-grid"><section id="studio-editor" className="panel"><h2>{editingId?'Edit lesson draft':'New lesson draft'}</h2><p className="hint">Write an original accessible text explanation first, then attach an optional original MP4 video (up to 25 MiB) to the saved draft. Set each saved draft to free (₦0) or ₦200+ before submitting it. Paid checkout is currently unavailable.</p>
 <form className="form-stack" onSubmit={submit}><label htmlFor="course">Course</label><select id="course" required disabled={busy||Boolean(editingId)} value={form.courseId} onChange={e=>{setTopics([]);setTopicsState(e.target.value?'loading':'idle');setForm({...form,courseId:e.target.value,topicId:''});}}><option value="">Choose a course</option>{courses.filter(c=>c.institutionId===user.institutionId).map(c=><option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select>
 <label htmlFor="topic">Topic (optional)</label><select id="topic" value={form.topicId} disabled={busy||Boolean(editingId)||!form.courseId||topicsState!=='ready'} onChange={e=>setForm({...form,topicId:e.target.value})}><option value="">General course explanation</option>{topics.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>{topicsState==='loading'&&<p className="hint" role="status">Loading topics…</p>}{topicsState==='error'&&<p className="hint" role="status">Topics could not be loaded. A general course explanation is still available.</p>}<label htmlFor="title">Title</label><input id="title" disabled={busy} required minLength="3" maxLength="160" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
 <label htmlFor="desc">Description</label><textarea id="desc" disabled={busy} maxLength="2500" rows="2" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/>
 <label htmlFor="preview">Short preview</label><textarea id="preview" disabled={busy} maxLength="800" rows="2" value={form.previewText} onChange={e=>setForm({...form,previewText:e.target.value})}/>
 <label htmlFor="body">Original lesson text (at least 100 characters)</label><textarea id="body" disabled={busy} className="long-editor" required minLength="100" maxLength="25000" rows="11" value={form.lessonText} onChange={e=>setForm({...form,lessonText:e.target.value})}/>
 <label className="check-line"><input type="checkbox" required disabled={busy} checked={form.rightsAttested} onChange={e=>setForm({...form,rightsAttested:e.target.checked})}/><span>This is my original teaching material or I have permission to distribute it. It is not a completed student assignment for submission.</span></label>
 <button className="primary-link" disabled={busy} type="submit">{busy?'Saving…':editingId?'Save changes':'Save private draft'}</button>{editingId&&<button className="quiet-button" type="button" disabled={busy} onClick={resetDraft}>Cancel editing</button>}</form></section>
 <section id="studio-content" className="panel"><h2>Your lessons</h2>{items.length===0?<p className="hint">Your drafts and submissions will appear here.</p>:<ul className="review-list">{items.map(item=><li key={item.id}><span className="pill">{item.status.replaceAll('_',' ')}</span><h3>{item.title}</h3>{item.reviewReason&&<p className="hint">Review feedback: {item.reviewReason}</p>}
 {item.hasVideo&&<div className="lesson-video-preview"><p className="hint">Original video</p><video controls playsInline preload="none" aria-label={`Video preview for ${item.title}`}><source src={`/api/local/lessons/${item.id}/video`} type="video/mp4"/>{item.hasCaptions&&<track kind="captions" srcLang="en" label="English captions" src={`/api/local/lessons/${item.id}/video/captions`} default/>}Your browser cannot play this video.</video></div>}
 {['draft','rejected'].includes(item.status)&&<div className="media-form"><label htmlFor={`price-${item.id}`}>Viewer access price (₦; 0 means free)</label><input id={`price-${item.id}`} type="text" inputMode="numeric" maxLength={8} value={priceInputs[item.id]??String((item.priceKobo??0)/100)} disabled={busy} onChange={e=>setPriceInputs(v=>({...v,[item.id]:e.target.value}))}/><button className="secondary-link" type="button" disabled={busy} onClick={()=>setAccessPrice(item)}>Save access price</button><p className="hint">Current price: {item.priceKobo>0?'₦'+(item.priceKobo/100).toLocaleString('en-NG'):'Free'} · this locks on publication.</p></div>}
 {['draft','rejected'].includes(item.status)&&<div className="media-form"><label htmlFor={`video-${item.id}`}>Upload {item.hasVideo?'a replacement':'an original'} MP4 video (max 25 MiB)</label><input id={`video-${item.id}`} type="file" accept="video/mp4,.mp4" ref={el=>{mediaInputs.current['video-'+item.id]=el;}} disabled={busy} onChange={e=>setVideoFiles(v=>({...v,[item.id]:e.target.files?.[0]||null}))}/><button className="secondary-link" type="button" disabled={busy||!videoFiles[item.id]} onClick={()=>uploadVideo(item.id)}>Upload video</button>{videoFiles[item.id]&&<button className="quiet-button" type="button" disabled={busy} onClick={()=>clearMedia(item.id,'video')}>Remove selected video</button>}<p className="hint">Private until a separate administrator approves this lesson. Do not upload confidential or unlicensed materials.</p></div>}{['draft','rejected'].includes(item.status)&&item.hasVideo&&<div className="media-form">
 <label htmlFor={`captions-${item.id}`}>Optional English captions (.vtt, max 128 KiB)</label>
 <input id={`captions-${item.id}`} type="file" accept=".vtt,text/vtt" ref={el=>{mediaInputs.current['captions-'+item.id]=el;}} disabled={busy}
   onChange={e=>setCaptionFiles(v=>({...v,[item.id]:e.target.files?.[0]||null}))}/>
 <button className="secondary-link" type="button" disabled={busy||!captionFiles[item.id]} onClick={()=>uploadCaptions(item.id)}>
  {item.hasCaptions?'Replace captions':'Upload captions'}
 </button>{captionFiles[item.id]&&<button className="quiet-button" type="button" disabled={busy} onClick={()=>clearMedia(item.id,'captions')}>Remove selected captions</button>}
 <p className="hint">{item.hasCaptions?'Captions saved for this video.':'Captions can help students learn with sound off.'} Use WebVTT timing and original, rights-cleared text. Replacing the MP4 clears its previous captions.</p>
 </div>}{['draft','rejected'].includes(item.status)&&<div className="button-row"><button className="secondary-link" disabled={busy} onClick={()=>{draftKey.current='';setEditingId(item.id);setForm({courseId:item.courseId,topicId:item.topicId||'',title:item.title,description:item.description,previewText:item.previewText,lessonText:item.lessonText,rightsAttested:true,creationKey:''});document.getElementById('studio-editor')?.scrollIntoView({block:'start'});}}>Edit</button><button className="primary-link" disabled={busy||Boolean(blockFor(item))} onClick={()=>send(item)}>Submit for review</button>{blockFor(item)&&<p className="hint" role="status">{blockFor(item)}</p>}</div>}{item.status==='published'&&<Link className="secondary-link" href={`/lessons/${item.id}`}>Read published lesson</Link>}</li>)}</ul>}</section></div>}
 {error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status" className="form-success">{message}</p>}
 </>}
 </main>;
}
