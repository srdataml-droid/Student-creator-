'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';

const INCIDENT_STATES={open:'investigating',investigating:'contained',contained:'resolved'};
const ROLES=['governance_owner','verification_reviewer','content_moderator','privacy_reviewer','finance_reviewer','incident_responder','auditor'];
const DATASETS=['verification_evidence','login_sessions','analytics_events','user_reports','audit_events'];
export default function GovernanceConsole(){
 const [state,setState]=useState('loading'),[user,setUser]=useState(null),[grants,setGrants]=useState([]),[cap,setCap]=useState([]),
 [dashboard,setDashboard]=useState(null),[incidents,setIncidents]=useState([]),[history,setHistory]=useState([]),[proposals,setProposals]=useState([]);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [staff,setStaff]=useState({userId:'',role:'verification_reviewer'});
 const [incident,setIncident]=useState({category:'unauthorized_access',severity:'medium',summary:''});
 const [notes,setNotes]=useState({}),[retention,setRetention]=useState({dataset:'verification_evidence',days:30,rationale:''});
 async function refresh(){
  try{
   const [me,permissions]=await Promise.all([api('me'),api('admin/governance/permissions')]);
   setUser(me.user);setCap(permissions.capabilities);
   const may=s=>permissions.capabilities.includes(s);
   const [d,i,h,r,g]=await Promise.all([
    may('dashboard.read')?api('admin/governance/dashboard'):null,
    may('incident.read')?api('admin/governance/incidents'):null,
    may('audit.read')?api('admin/governance/history?limit=30'):null,
    may('retention.review')?api('admin/governance/retention'):null,
    may('staff.assign')?api('admin/governance/roles'):null
   ]);
   setDashboard(d?.dashboard??null);setIncidents(i?.incidents??[]);setHistory(h?.events??[]);
   setProposals(r?.proposals??[]);setGrants(g?.roles??[]);setState('ready');
  }catch(e){setState(e.status===401?'signed-out':e.status===403?'forbidden':'unavailable');}
 }
 useEffect(()=>{refresh();},[]);
 async function act(run,success){
  setBusy(true);setError('');setMessage('');
  try{await run();setMessage(success);await refresh();}
  catch(e){setError(friendlyError(e));}
  finally{setBusy(false);}
 }
 const may=s=>cap.includes(s);
 const submit=(fn,success)=>e=>{e.preventDefault();act(fn,success);};
 return <main id="main" className="main admin-console">
  <section className="hero compact"><p className="eyebrow">Operator governance</p><h1>Governance and incident operations</h1>
  <p className="intro">Role-scoped administration, operational cases and reviewable actions. This console uses the local development adapter; hosted policies and live financial operations are not enabled.</p></section>
  {state==='loading'?<p role="status">Loading authorized view…</p>:
   state==='signed-out'?<p role="alert" className="status">Please <Link href="/sign-in">sign in</Link> with an authorized operator account.</p>:
   state==='forbidden'?<p role="alert" className="status">This account has no permitted governance scope.</p>:
   state==='unavailable'?<p role="alert" className="status">Governance service is temporarily unavailable.</p>:<>
   <p className="hint">Operator: {user?.email} · Permissions: {cap.length} · <Link href="/manage">Other administration</Link></p>
   {message&&<p role="status" className="form-success">{message}</p>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="manage-grid">
   {dashboard&&<section className="panel"><p className="eyebrow">Operations</p><h2>Queue overview</h2>
    <dl>
     {Object.entries(dashboard).filter(([k,v])=>typeof v==='number').map(([k,v])=><div key={k}><dt>{k.replace(/([A-Z])/g,' $1')}</dt><dd>{v===null?'Unconfigured':v}</dd></div>)}
    </dl><p className="hint">Counts do not expose private student IDs, conversations or transaction details. Missing queue sources may show as unavailable.</p>
    <p>Automatic retention: disabled. Live payment actions: disabled.</p>
   </section>}
   {may('incident.write')&&<section className="panel"><p className="eyebrow">Security</p><h2>Report an incident</h2>
    <form className="form-stack" onSubmit={submit(()=>api('admin/governance/incidents',{method:'POST',body:incident}),'Incident recorded and audit event appended.')}>
     <label htmlFor="category">Category</label><select id="category" value={incident.category} onChange={e=>setIncident(x=>({...x,category:e.target.value}))}>
      {['unauthorized_access','account_compromise','suspected_fraud','availability','data_exposure','other'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select>
     <label htmlFor="severity">Severity</label><select id="severity" value={incident.severity} onChange={e=>setIncident(x=>({...x,severity:e.target.value}))}>
      {['low','medium','high','critical'].map(x=><option key={x}>{x}</option>)}</select>
     <label htmlFor="summary">Factual incident summary (20–1000 characters; avoid personal identifiers)</label>
     <textarea id="summary" value={incident.summary} onChange={e=>setIncident(x=>({...x,summary:e.target.value}))} minLength={20} maxLength={1000} required rows={4}/>
     <button type="submit" className="primary-link" disabled={busy||incident.summary.trim().length<20}>Record incident</button>
    </form></section>}
   {may('incident.read')&&<section className="panel"><p className="eyebrow">Incidents</p><h2>Security case history</h2>
    {incidents.length===0?<p role="status">No security incident reports.</p>:<ul className="review-list">{incidents.map(x=><li key={x.id}>
     <h3>{x.category.replaceAll('_',' ')} · {x.severity}</h3><p>{x.summary}</p><p className="hint">{x.state} · {x.createdAt}</p>
     {may('incident.write')&&INCIDENT_STATES[x.state]&&<form className="form-stack" onSubmit={submit(()=>api('admin/governance/incidents/'+x.id+'/state',{method:'POST',body:{state:INCIDENT_STATES[x.state],note:notes[x.id]}}),'Incident progressed with audit record.')}>
      <label htmlFor={'note-'+x.id}>Decision and supporting reason</label>
      <textarea id={'note-'+x.id} minLength={10} maxLength={500} rows={2} required value={notes[x.id]||''} onChange={e=>setNotes(y=>({...y,[x.id]:e.target.value}))}/>
      <button className="secondary-link" type="submit" disabled={busy||(notes[x.id]||'').trim().length<10}>Advance to {INCIDENT_STATES[x.state]}</button>
     </form>}
    </li>)}</ul>}
   </section>}
   {may('staff.assign')&&<section className="panel"><p className="eyebrow">Least privilege</p><h2>Staff role assignments</h2>
    <p className="hint">Only existing authorized administrator accounts can receive these scopes. Assigning a role does not create an account or expose sensitive records.</p>
    <form className="form-stack" onSubmit={submit(()=>api('admin/governance/roles/assign',{method:'POST',body:staff}),'Scoped role granted.')}>
     <label htmlFor="staff-id">Existing administrator ID</label><input id="staff-id" value={staff.userId} required onChange={e=>setStaff(x=>({...x,userId:e.target.value}))}/>
     <label htmlFor="staff-role">Scope</label><select id="staff-role" value={staff.role} onChange={e=>setStaff(x=>({...x,role:e.target.value}))}>{ROLES.map(x=><option key={x}>{x}</option>)}</select>
     <div className="button-row"><button className="primary-link" type="submit" disabled={busy}>Grant</button>
      <button className="secondary-link" type="button" disabled={busy||!staff.userId} onClick={()=>act(()=>api('admin/governance/roles/revoke',{method:'POST',body:staff}),'Scoped role revoked, if assigned.')}>Revoke</button>
     </div>
    </form>
    <ul className="small-list">{grants.map(x=><li key={x.userId+':'+x.role}><code>{x.userId.slice(0,8)}…</code> · {x.role}</li>)}</ul>
   </section>}
   {may('retention.propose')&&<section className="panel"><p className="eyebrow">Privacy</p><h2>Propose a retention review</h2>
    <p className="hint">Proposals do not authorize data deletion or approve a legal retention schedule. Policy signoff and separate implementation are required.</p>
    <form className="form-stack" onSubmit={submit(()=>api('admin/governance/retention',{method:'POST',body:retention}),'Review proposal recorded. No records were deleted.')}>
     <label htmlFor="dataset">Data category</label><select id="dataset" value={retention.dataset} onChange={e=>setRetention(x=>({...x,dataset:e.target.value}))}>{DATASETS.map(x=><option key={x}>{x}</option>)}</select>
     <label htmlFor="days">Proposed days</label><input id="days" type="number" min="1" max="3650" value={retention.days} onChange={e=>setRetention(x=>({...x,days:Number(e.target.value)}))}/>
     <label htmlFor="rationale">Rationale</label><textarea id="rationale" value={retention.rationale} onChange={e=>setRetention(x=>({...x,rationale:e.target.value}))} rows={3} minLength={20} maxLength={500} required/>
     <button type="submit" className="secondary-link" disabled={busy||retention.rationale.trim().length<20}>Submit for review</button>
    </form>
   </section>}
   {may('retention.review')&&<section className="panel"><p className="eyebrow">Privacy decisions</p><h2>Retention proposal history</h2>
    {proposals.length===0?<p role="status">No pending retention proposals.</p>:<ul className="review-list">{proposals.map(x=><li key={x.id}>
     <h3>{x.dataset} · {x.days} days</h3><p className="hint">Status: {x.state}. Not an approved retention policy.</p>
     {x.state==='proposed'&&<form className="form-stack" onSubmit={submit(()=>api('admin/governance/retention/'+x.id+'/reject',{method:'POST',body:{note:notes[x.id]}}),'Proposal rejected with an audit event.')}>
      <label htmlFor={'ret-'+x.id}>Reason for rejection</label><textarea id={'ret-'+x.id} minLength={10} maxLength={500} rows={2} value={notes[x.id]||''} onChange={e=>setNotes(y=>({...y,[x.id]:e.target.value}))}/>
      <button className="secondary-link" type="submit" disabled={busy||(notes[x.id]||'').trim().length<10}>Reject proposal</button>
     </form>}
    </li>)}</ul>}
   </section>}
   {may('audit.read')&&<section className="panel"><p className="eyebrow">Accountability</p><h2>Administrative action history</h2>
    <p className="hint">Audit metadata only. Raw private documents, messages, payment instruments and evidence are not included.</p>
    <ul className="small-list">{history.map(x=><li key={x.id}><strong>{x.action}</strong> · {x.createdAt} · <code>{x.actorId?.slice(0,8)||'system'}…</code></li>)}</ul>
   </section>}
   </div></>}
 </main>;
}
