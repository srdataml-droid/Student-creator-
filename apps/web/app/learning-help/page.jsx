'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';

const kinds=[['tutoring','One-to-one tutoring'],['assignment_explanation','Assignment explanation'],['project_guidance','Project guidance']];
const amount=k=>k===null||k===undefined?'Not priced':k===0?'Free':'₦'+(k/100).toLocaleString('en-NG');

export default function PersonalizedHelpPage(){
 const [me,setMe]=useState(null),[status,setStatus]=useState('loading'),[requests,setRequests]=useState([]),[notifications,setNotifications]=useState([]);
 const [creatorId,setCreatorId]=useState(''),[kind,setKind]=useState('tutoring'),[description,setDescription]=useState(''),[budget,setBudget]=useState('');
 const [agreed,setAgreed]=useState(false),[creationKey,setCreationKey]=useState('wk06-'+crypto.randomUUID());
 const [quotes,setQuotes]=useState({}),[reasons,setReasons]=useState({});
 const [slots,setSlots]=useState([]),[day,setDay]=useState('1'),[from,setFrom]=useState('19:00'),[until,setUntil]=useState('21:00');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function reload(){
   const [items,alerts]=await Promise.all([api('me/learning-requests'),api('me/learning-notifications')]);
   setRequests(items.requests||[]);setNotifications(alerts.notifications||[]);
 }
 useEffect(()=>{
   let active=true;
   const params=new URLSearchParams(window.location.search);
   setCreatorId(params.get('creatorId')||'');
   api('me').then(async account=>{
     if(!active)return;
     setMe(account.user);
     const avail=await api('creators/'+account.user.id+'/availability');
     if(active)setSlots(avail.availability?.slots||[]);
     await reload();if(active)setStatus('ready');
   }).catch(e=>{if(active)setStatus(e.status===401?'signed-out':'unavailable');});
   return()=>{active=false;};
 },[]);
 async function act(operation,message){
   setBusy(true);setNotice('');setError('');
   try{await operation();setNotice(message);await reload();}
   catch(e){setError(friendlyError(e));}
   finally{setBusy(false);}
 }
 function createRequest(e){
   e.preventDefault();
   const naira=budget===''?null:Number(budget);
   if(naira!==null&&(!Number.isSafeInteger(naira)||naira<0)){setError('Budget must be a whole-naira amount.');return;}
   act(async()=>{
     await api('learning-requests',{method:'POST',body:{creatorId,kind,description,
       budgetKobo:naira===null?null:naira*100,integrityAttested:agreed,creationKey}});
     setDescription('');setBudget('');setAgreed(false);setCreationKey('wk06-'+crypto.randomUUID());
   },'Your learning request has been sent to the creator.');
 }
 function quote(request){
   const k=quotes[request.id]??'';
   const naira=Number(k);
   if(k===''||!Number.isSafeInteger(naira)||naira<0){setError('Enter a valid whole-naira quote.');return;}
   act(()=>api('learning-requests/'+request.id+'/quote',{method:'POST',body:{quoteKobo:naira*100}}),'Your quote is ready for the student to review.');
 }
 function shortAction(request,action,body,message){
   return act(()=>api('learning-requests/'+request.id+'/'+action,{method:'POST',body}),message);
 }
 function addSlot(e){
   e.preventDefault();
   const next=[...slots,{day:Number(day),start:from,end:until}];
   setBusy(true);setError('');
   api('me/creator-availability',{method:'POST',body:{slots:next}})
     .then(x=>{setSlots(x.availability.slots);setNotice('Availability updated.');})
     .catch(e=>setError(friendlyError(e))).finally(()=>setBusy(false));
 }
 function removeSlot(index){
   const next=slots.filter((_,i)=>i!==index);
   act(async()=>{const x=await api('me/creator-availability',{method:'POST',body:{slots:next}});setSlots(x.availability.slots);},'Availability updated.');
 }
 const showRequest=request=>{
   const own=request.studentId===me?.id,creator=request.creatorId===me?.id;
   const reason=reasons[request.id]??'';
   return <li className="lesson" key={request.id}>
     <p className="code">{kinds.find(([key])=>key===request.kind)?.[1]||request.kind} · {request.status.replaceAll('_',' ')}</p>
     <p>{request.description}</p>
     <p className="hint">Proposed budget: {amount(request.budgetKobo)} · Creator quote: {amount(request.quoteKobo)}</p>
     <div className="button-row">
       {creator&&['requested','quoted'].includes(request.status)&&<>
         <label htmlFor={'quote-'+request.id}>Offer price (NGN)
           <input id={'quote-'+request.id} type="number" min="0" step="1" value={quotes[request.id]??''}
             onChange={e=>setQuotes(q=>({...q,[request.id]:e.target.value}))}/>
         </label>
         <button type="button" className="secondary-link" disabled={busy} onClick={()=>quote(request)}>Send quote</button>
       </>}
       {own&&request.status==='quoted'&&<button type="button" className="secondary-link" disabled={busy}
         onClick={()=>shortAction(request,'accept',{expectedQuoteKobo:request.quoteKobo},request.quoteKobo>0?'Quote accepted. Paid progress requires a verified payment entitlement.':'Quote accepted.')}>Accept quote</button>}
       {creator&&request.status==='accepted'&&<button type="button" className="secondary-link" disabled={busy}
         onClick={()=>shortAction(request,'start',{},'Service started.')}>Start guidance</button>}
       {creator&&request.status==='in_progress'&&<button type="button" className="secondary-link" disabled={busy}
         onClick={()=>shortAction(request,'submit',{},'Guidance submitted for student confirmation.')}>Mark ready for review</button>}
       {own&&request.status==='submitted'&&<button type="button" className="secondary-link" disabled={busy}
         onClick={()=>shortAction(request,'confirm',{},'Learning service confirmed complete.')}>Confirm completion</button>}
     </div>
     {['requested','quoted'].includes(request.status)&&creator&&<form className="form-stack" onSubmit={e=>{e.preventDefault();shortAction(request,'reject',{reason},'The request was declined.');}}>
       <label htmlFor={'decline-'+request.id}>Decline with reason</label>
       <input id={'decline-'+request.id} minLength={5} maxLength={500} required value={reason} onChange={e=>setReasons(x=>({...x,[request.id]:e.target.value}))}/>
       <button type="submit" className="quiet-button" disabled={busy}>Decline request</button>
     </form>}
     {['accepted','in_progress','submitted','completed'].includes(request.status)&&<form className="form-stack" onSubmit={e=>{e.preventDefault();shortAction(request,'dispute',{reason},'A dispute was filed for independent review.');}}>
       <label htmlFor={'dispute-'+request.id}>Report a service concern</label>
       <textarea id={'dispute-'+request.id} rows={2} minLength={10} maxLength={1000} required value={reason} onChange={e=>setReasons(x=>({...x,[request.id]:e.target.value}))}/>
       <button type="submit" className="quiet-button" disabled={busy}>Submit report</button>
     </form>}
     <p className="hint">{own?'Your requested guidance':'Student learning request'} · No impersonation or submission services permitted.</p>
   </li>;
 };
 return <main id="main" className="main">
   <section className="hero compact"><p className="eyebrow">Personalized support</p><h1>Learn directly from creators.</h1>
     <p className="intro">Ask for tutoring, explanations or guidance on your own work. Agree on the scope and price before the creator begins.</p></section>
   {status==='loading'?<p role="status">Loading your learning space…</p>:status==='signed-out'?<p className="status">Please <Link href="/sign-in">sign in</Link> first.</p>:status!=='ready'?<p className="status">A verified student account is required.</p>:<>
     {error&&<p role="alert" className="status">{error}</p>}{notice&&<p role="status" className="status">{notice}</p>}
     <section className="course-section"><h2>Ask a student creator</h2><form className="form-stack" onSubmit={createRequest}>
       <label htmlFor="help-creator">Creator ID</label><input id="help-creator" required value={creatorId} onChange={e=>setCreatorId(e.target.value)} placeholder="Choose a creator from their profile"/>
       <label htmlFor="help-kind">What would you like?</label><select id="help-kind" value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
       <label htmlFor="help-description">Describe the concept or problem you want to understand</label>
       <textarea id="help-description" minLength={20} maxLength={2000} required rows={4} value={description} onChange={e=>setDescription(e.target.value)}/>
       <label htmlFor="help-budget">Optional budget in naira</label><input id="help-budget" value={budget} onChange={e=>setBudget(e.target.value)} type="number" step="1" min="0"/>
       <label><input type="checkbox" checked={agreed} required onChange={e=>setAgreed(e.target.checked)}/> This is legitimate tutoring or explanation of my own work, not a request to impersonate me or complete an assessment for submission.</label>
       <button type="submit" disabled={busy||!agreed} className="creator-btn filled">Send request</button>
     </form></section>
     <section className="course-section"><h2>Your service requests</h2>
       {requests.length?<ul className="lesson-list">{requests.map(showRequest)}</ul>:<p className="status">No personalized learning requests yet.</p>}
     </section>
     <section className="course-section"><h2>Your creator availability</h2><p className="hint">Share the times you can accept learning requests. Times are shown in your local timezone.</p>
       <ul className="lesson-list">{slots.map((slot,index)=><li className="lesson" key={index}>
         <span>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][slot.day]} · {slot.start}–{slot.end}</span>
         <button type="button" className="quiet-button" disabled={busy} onClick={()=>removeSlot(index)}>Remove</button></li>)}</ul>
       <form className="form-stack" onSubmit={addSlot}>
         <label htmlFor="slot-day">Day</label><select id="slot-day" value={day} onChange={e=>setDay(e.target.value)}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=><option key={i} value={i}>{d}</option>)}</select>
         <label htmlFor="slot-from">Available from</label><input id="slot-from" type="time" required value={from} onChange={e=>setFrom(e.target.value)}/>
         <label htmlFor="slot-until">Until</label><input id="slot-until" type="time" required value={until} onChange={e=>setUntil(e.target.value)}/>
         <button type="submit" className="secondary-link" disabled={busy}>Add time</button>
       </form>
     </section>
     <section className="course-section"><h2>Updates and reminders</h2>
       {notifications.length?<ul className="lesson-list">{notifications.slice(0,20).map(n=><li key={n.id} className="lesson">
         <p>{n.body}</p><p className="hint">{new Date(n.createdAt).toLocaleString()}</p>
         {!n.seenAt&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>act(()=>api('learning-notifications/'+n.id+'/read',{method:'POST',body:{}}),'Marked as read.')}>Mark read</button>}
       </li>)}</ul>:<p className="status">You have no service updates yet.</p>}
     </section>
   </>}
 </main>;
}
