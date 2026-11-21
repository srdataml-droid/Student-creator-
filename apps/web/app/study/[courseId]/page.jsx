'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {api,friendlyError} from '../../../lib/local-client.js';

const localTime=value=>{
  const n=new Date(value),pad=x=>String(x).padStart(2,'0');
  return n.getFullYear()+'-'+pad(n.getMonth()+1)+'-'+pad(n.getDate())+'T'+pad(n.getHours())+':'+pad(n.getMinutes());
};
const clock=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

/** Next.js web page backed by SQLite on the development server, NOT an offline-first feature. */
export default function StudyRounds(){
  const {courseId}=useParams();
  const [phase,setPhase]=useState('loading'),[membership,setMembership]=useState(null),[topics,setTopics]=useState([]),[me,setMe]=useState(null),[sessions,setSessions]=useState([]);
  const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[topicId,setTopicId]=useState(''),[capacity,setCapacity]=useState('12');
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[creationKey,setCreationKey]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [cancelId,setCancelId]=useState(''),[reason,setReason]=useState('');
  useEffect(()=>{setStart(localTime(Date.now()+2*3600000));setEnd(localTime(Date.now()+3*3600000));},[]);
  const resetKey=()=>setCreationKey(crypto.randomUUID());
  async function load(){
    try{
      const [account,community,terms]=await Promise.all([api('me'),api('courses/'+courseId+'/community'),api('courses/'+courseId+'/topics')]);
      setMe(account.user);setMembership(community.status);setTopics(terms.topics);
      if(community.status.joined){
        const res=await api('courses/'+courseId+'/study-sessions');setSessions(res.sessions);
      }else setSessions([]);
      setPhase('ready');
    }catch(e){setPhase(e.status===401?'signed-out':e.status===403?'unverified':e.status===404?'not-found':'error');}
  }
  useEffect(()=>{if(courseId)load();},[courseId]);
  async function perform(action,message){
    setBusy(true);setNotice('');setError('');
    try{await action();setNotice(message);await load();}catch(e){setError(friendlyError(e));}finally{setBusy(false);}
  }
  async function schedule(e){
    e.preventDefault();
    const first=new Date(start),last=new Date(end);
    if(!Number.isFinite(first.getTime())||!Number.isFinite(last.getTime())){setError('Enter valid session times.');return;}
    await perform(async()=>{
      await api('courses/'+courseId+'/study-sessions',{method:'POST',body:{
        title,description,topicId:topicId||null,startsAt:first.toISOString(),endsAt:last.toISOString(),capacity:Number(capacity),creationKey
      }});
      setTitle('');setDescription('');setTopicId('');resetKey();
    },'Study round scheduled successfully.');
  }
  const upcoming=sessions.filter(s=>s.status==='scheduled'&&Date.parse(s.startsAt)>Date.now());
  const archive=sessions.filter(s=>s.status!=='scheduled'||Date.parse(s.startsAt)<=Date.now());
  const showSession=s=>{
    const host=me?.id===s.hostId,upcoming=s.status==='scheduled'&&Date.parse(s.startsAt)>Date.now();
    return <li className="lesson" key={s.id}>
      <p className="code">{topics.find(t=>t.id===s.topicId)?.name||'All topics'} · {s.status}</p>
      <h3>{s.title}</h3>{s.description&&<p>{s.description}</p>}
      <p className="hint">{clock(s.startsAt)} – {clock(s.endsAt)} · {s.attendeeCount}/{s.capacity} places</p>
      {s.status==='cancelled'&&<p className="status">Cancelled: {s.cancellationReason}</p>}
      <div className="button-row">
        {upcoming&&!s.joined&&<button type="button" disabled={busy||s.attendeeCount>=s.capacity} className="secondary-link" onClick={()=>perform(()=>api('study-sessions/'+s.id+'/rsvp',{method:'POST',body:{}}),'Your seat is reserved.')}>{s.attendeeCount>=s.capacity?'Full':'Reserve seat'}</button>}
        {upcoming&&s.joined&&!host&&<button type="button" disabled={busy} className="quiet-button" onClick={()=>perform(()=>api('study-sessions/'+s.id+'/withdraw',{method:'POST',body:{}}),'Seat released.')}>Withdraw</button>}
        {s.joined&&<span className="hint">{host?'Hosting':'You are attending'}</span>}
        {host&&s.status==='scheduled'&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>{setCancelId(s.id);setReason('');}}>Cancel session</button>}
        {host&&s.status==='scheduled'&&Date.parse(s.endsAt)<=Date.now()&&<button type="button" disabled={busy} className="secondary-link" onClick={()=>perform(()=>api('study-sessions/'+s.id+'/complete',{method:'POST',body:{}}),'Session marked complete.')}>Mark complete</button>}
      </div>
      {cancelId===s.id&&<form className="form-stack" onSubmit={e=>{e.preventDefault();perform(async()=>{await api('study-sessions/'+s.id+'/cancel',{method:'POST',body:{reason}});setCancelId('');},'Study round cancelled.');}}>
        <label htmlFor={'reason-'+s.id}>Cancellation reason (visible to attendees)</label>
        <textarea id={'reason-'+s.id} value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required rows={2}/>
        <div className="button-row"><button type="submit" className="secondary-link" disabled={busy||reason.trim().length<5}>Confirm cancellation</button><button type="button" className="quiet-button" onClick={()=>setCancelId('')}>Keep scheduled</button></div>
      </form>}
    </li>;
  };
  return <main id="main" className="main"><Link className="back" href={'/courses/'+courseId}>← Back to course</Link>
    <section className="hero compact"><p className="eyebrow">Study together</p><h1>Course study rounds</h1><p className="intro">Plan a discussion or worked-example session with your classmates. This schedules attendance, not a video room or an offline meeting app.</p></section>
    {phase==='loading'?<p role="status">Loading study sessions…</p>:phase==='signed-out'?<p role="status">Please <Link href="/sign-in">sign in</Link> first.</p>:phase==='unverified'?<p role="alert">Your campus identity must be verified first.</p>:phase==='not-found'?<p role="alert">This course is not available in your campus.</p>:phase==='error'?<p role="alert">The development server could not load study sessions.</p>:<>
      {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="form-success">{notice}</p>}
      {!membership?.joined?<section className="panel"><h2>Join the course discussion first</h2><p>Study rounds are open to verified class community members.</p><Link className="primary-link" href={'/communities/'+courseId}>Join course community</Link></section>:<>
        <p className="hint">{membership.course.code} · {membership.course.title}</p>
        <section className="panel"><h2>Host a study round</h2><form className="form-stack" onSubmit={schedule}>
          <label htmlFor="study-title">Title</label><input id="study-title" required minLength={5} maxLength={120} value={title} onChange={e=>{setTitle(e.target.value);resetKey();}}/>
          <label htmlFor="study-desc">Description</label><textarea id="study-desc" value={description} maxLength={1000} rows={2} onChange={e=>{setDescription(e.target.value);resetKey();}}/>
          <label htmlFor="study-topic">Course topic</label><select id="study-topic" value={topicId} onChange={e=>{setTopicId(e.target.value);resetKey();}}><option value="">All topics</option>{topics.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <label htmlFor="study-start">Starts (your local time)</label><input id="study-start" required type="datetime-local" value={start} onChange={e=>{setStart(e.target.value);resetKey();}}/>
          <label htmlFor="study-end">Ends (your local time)</label><input id="study-end" required type="datetime-local" value={end} onChange={e=>{setEnd(e.target.value);resetKey();}}/>
          <label htmlFor="study-capacity">Participants including host (2–50)</label><input id="study-capacity" type="number" required min={2} max={50} step={1} value={capacity} onChange={e=>{setCapacity(e.target.value);resetKey();}}/>
          <button className="primary-link" type="submit" disabled={busy||title.trim().length<5||!start||!end}>Schedule</button>
        </form><p className="hint">Schedule 5 minutes to 90 days ahead for 15 minutes to 4 hours. Live video is not yet available.</p></section>
        <section className="course-section"><h2>Upcoming</h2>{upcoming.length?<ul className="lesson-list">{upcoming.map(showSession)}</ul>:<p className="status">No upcoming sessions. Host the first one.</p>}</section>
        {archive.length>0&&<section className="course-section"><h2>Past and cancelled</h2><ul className="lesson-list">{archive.map(showSession)}</ul></section>}
      </>}
    </>}
  </main>;
}
