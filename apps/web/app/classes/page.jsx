'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';

const localDate=ms=>{
 const d=new Date(ms),pad=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
};
const when=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

export default function ClassesPage(){
  const [me,setMe]=useState(null),[state,setState]=useState('loading'),[courses,setCourses]=useState([]);
  const [courseId,setCourseId]=useState(''),[classes,setClasses]=useState([]),[mine,setMine]=useState([]);
  const [title,setTitle]=useState(''),[description,setDescription]=useState('');
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[capacity,setCapacity]=useState('12'),[price,setPrice]=useState('0');
  const [key,setKey]=useState('week06-'+crypto.randomUUID());
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [cancelId,setCancelId]=useState(''),[cancelReason,setCancelReason]=useState('');

  useEffect(()=>{setStart(localDate(Date.now()+60*60000));setEnd(localDate(Date.now()+120*60000));},[]);
  useEffect(()=>{
    let mounted=true;
    Promise.all([api('me'),api('courses')]).then(([account,list])=>{
      if(!mounted)return;
      const available=(list.courses||[]).filter(c=>c.institutionId===account.user?.institutionId);
      setMe(account.user);setCourses(available);setCourseId(available[0]?.id||'');setState('ready');
    }).catch(e=>{if(mounted)setState(e.status===401?'signed-out':'unavailable');});
    return()=>{mounted=false;};
  },[]);
  async function refresh(){
    if(!courseId)return;
    try{
      const [published,yours]=await Promise.all([api('courses/'+courseId+'/classes'),api('me/classes')]);
      setClasses(published.classes||[]);setMine(yours.classes||[]);
    }catch(e){setError(friendlyError(e));}
  }
  useEffect(()=>{if(courseId)refresh();},[courseId]);
  async function act(action,message){
    setBusy(true);setError('');setNotice('');
    try{await action();setNotice(message);await refresh();}
    catch(e){setError(friendlyError(e));}
    finally{setBusy(false);}
  }
  function newClass(e){
    e.preventDefault();
    const amountNaira=Number(price);
    if(!Number.isSafeInteger(amountNaira)||amountNaira<0){setError('Enter a valid price in whole naira.');return;}
    act(async()=>{
      await api('courses/'+courseId+'/classes',{method:'POST',body:{
        title,description,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),
        capacity:Number(capacity),priceKobo:amountNaira*100,creationKey:key
      }});
      setTitle('');setDescription('');setKey('week06-'+crypto.randomUUID());
    },'Class scheduled. Students can now discover and enroll.');
  }
  function classItem(item){
    const host=item.hostId===me?.id,paid=item.priceKobo>0,canOpen=item.status==='scheduled';
    const enrolled=item.enrolled||mine.some(m=>m.id===item.id)||host;
    return <li className="lesson" key={item.id}>
      <p className="code">{host?'YOUR CLASS':'STUDENT CLASS'} · {item.status.replaceAll('_',' ')}</p>
      <h3>{item.title}</h3>
      {item.description&&<p>{item.description}</p>}
      <p className="hint">{when(item.startsAt)} – {when(item.endsAt)} · {paid?'₦'+(item.priceKobo/100).toLocaleString('en-NG'):'Free'} · {item.attendeeCount??1}/{item.capacity} places</p>
      <div className="button-row">
        {!host&&!enrolled&&canOpen&&<button type="button" className="secondary-link" disabled={busy} onClick={()=>act(()=>api('classes/'+item.id+'/enroll',{method:'POST',body:{}}),paid?'Seat requested. Paid access requires verified checkout before joining.':'You have a seat in this class.')}>Enroll</button>}
        {!host&&enrolled&&canOpen&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>act(()=>api('classes/'+item.id+'/withdraw',{method:'POST',body:{}}),'Enrollment withdrawn; paid cases require a financial review.')}>Withdraw</button>}
        {host&&canOpen&&<button type="button" className="secondary-link" disabled={busy} onClick={()=>act(()=>api('classes/'+item.id+'/open',{method:'POST',body:{}}),'Room opened for authorized participants.')}>Open room</button>}
        {host&&item.status==='room_open'&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>act(()=>api('classes/'+item.id+'/finish',{method:'POST',body:{}}),'Class closed.')}>End session</button>}
        {(enrolled||host)&&item.status==='room_open'&&<Link className="secondary-link" href={'/classes/'+item.id+'/room'}>Join live room</Link>}
        {host&&item.status!=='cancelled'&&item.status!=='completed'&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>{setCancelId(item.id);setCancelReason('');}}>Cancel</button>}
      </div>
      {cancelId===item.id&&<form className="form-stack" onSubmit={e=>{
        e.preventDefault();act(async()=>{
          await api('classes/'+item.id+'/cancel',{method:'POST',body:{reason:cancelReason}});
          setCancelId('');
        },'Class cancelled. Any paid enrollments are queued for financial review.');}}>
        <label htmlFor={'cancel-'+item.id}>Reason for cancellation</label>
        <textarea id={'cancel-'+item.id} required minLength={8} maxLength={500} rows={2} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/>
        <div className="button-row"><button type="submit" className="secondary-link" disabled={busy}>Confirm cancellation</button><button type="button" className="quiet-button" onClick={()=>setCancelId('')}>Keep class</button></div>
      </form>}
    </li>;
  }
  return <main id="main" className="main">
    <section className="hero compact"><p className="eyebrow">Learn with a creator</p><h1>Interactive classes</h1>
      <p className="intro">Find a night class, reserve your place, or host your own guided session. Live room access is restricted to verified students with the required permission.</p></section>
    {state==='loading'?<p role="status">Loading classes…</p>:state==='signed-out'?<p className="status">Please <Link href="/sign-in">sign in</Link> to discover classes.</p>:state!=='ready'?<p className="status">Classes require an active verified student account.</p>:<>
      {error&&<p role="alert" className="status">{error}</p>}
      {notice&&<p role="status" className="status">{notice}</p>}
      <section className="course-section"><h2>Explore classes</h2>
        <label htmlFor="class-course">Your course</label>
        <select id="class-course" value={courseId} onChange={e=>setCourseId(e.target.value)}>
          {courses.map(c=><option value={c.id} key={c.id}>{c.code} — {c.title}</option>)}
        </select>
        {courseId?classes.length?<ul className="lesson-list">{classes.map(classItem)}</ul>:<p className="status">No upcoming classes have been scheduled in this course yet.</p>:<p className="status">Your campus courses will appear after an administrator sets them up.</p>}
      </section>
      {courseId&&<section className="course-section"><h2>Create a class</h2><p className="hint">Share your own explanation or host an interactive revision session. Paid attendance remains locked until a verified payment entitlement is available.</p>
        <form className="form-stack" onSubmit={newClass}>
          <label htmlFor="class-title">Class title</label><input id="class-title" value={title} minLength={5} maxLength={120} required onChange={e=>setTitle(e.target.value)}/>
          <label htmlFor="class-description">What will students learn?</label><textarea id="class-description" value={description} maxLength={1200} rows={3} onChange={e=>setDescription(e.target.value)}/>
          <label htmlFor="class-start">Start time</label><input id="class-start" type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/>
          <label htmlFor="class-end">End time</label><input id="class-end" type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/>
          <label htmlFor="class-capacity">Maximum people (including host)</label><input id="class-capacity" type="number" min={2} max={50} value={capacity} onChange={e=>setCapacity(e.target.value)}/>
          <label htmlFor="class-price">Price in naira (0 for free)</label><input id="class-price" type="number" min={0} step={1} value={price} onChange={e=>setPrice(e.target.value)}/>
          <button disabled={busy} className="creator-btn filled" type="submit">Schedule class</button>
        </form>
      </section>}
      <p className="hint">A class schedule or access token does not certify a successful live stream. Room connection and attendance are verified separately.</p>
    </>}
  </main>;
}
