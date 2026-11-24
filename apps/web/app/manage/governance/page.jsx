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
 const [verificationAppeals,setVerificationAppeals]=useState([]),[copyrightCases,setCopyrightCases]=useState([]),
 [copyrightAppeals,setCopyrightAppeals]=useState([]),[privacyCases,setPrivacyCases]=useState([]),[financeCases,setFinanceCases]=useState([]);
 const [staff,setStaff]=useState({userId:'',role:'verification_reviewer'});
 const [incident,setIncident]=useState({category:'unauthorized_access',severity:'medium',summary:''});
 const [notes,setNotes]=useState({}),[retention,setRetention]=useState({dataset:'verification_evidence',days:30,rationale:''});
 async function refresh(){
  try{
   const [me,permissions]=await Promise.all([api('me'),api('admin/governance/permissions')]);
   setUser(me.user);setCap(permissions.capabilities);
   const may=s=>permissions.capabilities.includes(s);
   const [d,i,h,r,g,v,c,ca,p,fin]=await Promise.all([
    may('dashboard.read')?api('admin/governance/dashboard'):null,
    may('incident.read')?api('admin/governance/incidents'):null,
    may('audit.read')?api('admin/governance/history?limit=30'):null,
    may('retention.review')?api('admin/governance/retention'):null,
    may('staff.assign')?api('admin/governance/roles'):null,
    may('verification.review')?api('admin/verification-appeals'):null,
    may('copyright.review')?api('admin/copyright-claims'):null,
    may('copyright.review')?api('admin/copyright-appeals'):null,
    may('privacy.review')?api('admin/privacy-requests'):null,
    may('finance.review')?api('admin/payment-disputes'):null
   ]);
   setDashboard(d?.dashboard??null);setIncidents(i?.incidents??[]);setHistory(h?.events??[]);
   setProposals(r?.proposals??[]);setGrants(g?.roles??[]);
   setVerificationAppeals(v?.appeals??[]);setCopyrightCases(c?.claims??[]);
   setCopyrightAppeals(ca?.appeals??[]);setPrivacyCases(p?.requests??[]);setFinanceCases(fin?.cases??[]);
   setState('ready');
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

   {may('verification.review')&&<section className="panel"><p className="eyebrow">Institutional identity</p><h2>Verification appeals</h2>
    <p className="hint">Review appeals without automatically granting membership or changing the institution's evidence.</p>
    {verificationAppeals.length===0?<p role="status">No pending institutional appeals.</p>:<ul className="review-list">{verificationAppeals.map(x=><li key={x.caseId}>
     <h3>Appeal {x.caseId.slice(0,8)}…</h3><p>{x.reason}</p>
     <label htmlFor={'verify-appeal-'+x.caseId}>Operator decision note</label>
     <textarea id={'verify-appeal-'+x.caseId} rows={2} value={notes[x.caseId]||''} onChange={e=>setNotes(n=>({...n,[x.caseId]:e.target.value}))}/>
     <div className="button-row">{['review_requested','rejected'].map(decision=><button key={decision} className="secondary-link"
      disabled={busy||(notes[x.caseId]||'').trim().length<10}
      onClick={()=>act(()=>api('admin/verification-appeals/'+x.caseId,{method:'POST',body:{decision,note:notes[x.caseId]}}),'Appeal decision audited. Membership not automatically changed.')}>{decision.replace('_',' ')}</button>)}</div>
    </li>)}</ul>}
   </section>}
   {may('copyright.review')&&<section className="panel"><p className="eyebrow">Creator rights</p><h2>Copyright complaints</h2>
    <p className="hint">A takedown blocks publication, but does not automatically refund purchases or decide copyright ownership.</p>
    {copyrightCases.length===0?<p role="status">No open copyright complaints.</p>:<ul className="review-list">{copyrightCases.map(x=><li key={x.caseId}>
     <h3>Complaint {x.caseId.slice(0,8)}…</h3><p>{x.reason}</p>
     <label htmlFor={'rights-'+x.caseId}>Documented review reason</label>
     <textarea id={'rights-'+x.caseId} rows={2} value={notes[x.caseId]||''} onChange={e=>setNotes(n=>({...n,[x.caseId]:e.target.value}))}/>
     <div className="button-row">{['dismiss','take_down'].map(decision=><button key={decision} className="secondary-link"
       disabled={busy||(notes[x.caseId]||'').trim().length<15}
       onClick={()=>act(()=>api('admin/copyright-claims/'+x.caseId+'/resolve',{method:'POST',body:{decision,note:notes[x.caseId]}}),'Complaint decision recorded. Financial review remains separate.')}>{decision.replace('_',' ')}</button>)}</div>
    </li>)}</ul>}
    <h3>Creator takedown appeals</h3>
    {copyrightAppeals.length===0?<p role="status">No creator appeals.</p>:<ul className="review-list">{copyrightAppeals.map(x=><li key={x.caseId}>
     <h3>Appeal {x.caseId.slice(0,8)}…</h3><p>{x.reason}</p><p className="hint">Status: {x.status}</p>
     {x.status==='open'&&<form className="form-stack" onSubmit={submit(()=>api('admin/copyright-appeals/'+x.caseId+'/triage',{method:'POST',body:{decision:'further_review',note:notes[x.caseId]}}),'Appeal escalated; content remains hidden.')}>
      <label htmlFor={'copyright-appeal-'+x.caseId}>Independent review escalation note</label>
      <textarea id={'copyright-appeal-'+x.caseId} rows={2} value={notes[x.caseId]||''} onChange={e=>setNotes(n=>({...n,[x.caseId]:e.target.value}))}/>
      <button className="secondary-link" disabled={busy||(notes[x.caseId]||'').trim().length<15}>Escalate without restoring</button>
     </form>}
    </li>)}</ul>}
   </section>}
   {may('privacy.review')&&<section className="panel"><p className="eyebrow">Privacy</p><h2>Account and evidence requests</h2>
    <p className="hint">These requests require identity validation and approved retention/legal-hold review. This screen never performs account deletion.</p>
    {privacyCases.length===0?<p role="status">No privacy requests.</p>:<ul className="review-list">{privacyCases.map(x=><li key={x.requestId}>
     <h3>{x.kind.replaceAll('_',' ')} · {x.status}</h3>
     {x.status==='open'&&<form className="form-stack" onSubmit={submit(()=>api('admin/privacy-requests/'+x.requestId+'/triage',{method:'POST',body:{decision:'request_review',note:notes[x.requestId]}}),'Privacy request escalated; no data deleted.')}>
      <label htmlFor={'privacy-'+x.requestId}>Review justification</label>
      <textarea id={'privacy-'+x.requestId} rows={2} value={notes[x.requestId]||''} onChange={e=>setNotes(n=>({...n,[x.requestId]:e.target.value}))}/>
      <button className="secondary-link" disabled={busy||(notes[x.requestId]||'').trim().length<15}>Require independent review</button>
     </form>}
    </li>)}</ul>}
   </section>}
   {may('finance.review')&&<section className="panel"><p className="eyebrow">Commerce integrity</p><h2>Financial dispute cases</h2>
    <p className="hint">Only case references and categories appear. Resolving a case does not move funds, refund a purchase, or modify accounting records.</p>
    {financeCases.length===0?<p role="status">No open financial disputes.</p>:<ul className="review-list">{financeCases.map(x=><li key={x.caseKey}>
     <h3>{x.kind} · {x.caseKey.slice(0,12)}…</h3>
     <p className="hint">Order reference: {x.reference.slice(0,12)}…</p>
     <form className="form-stack" onSubmit={submit(()=>api('admin/payment-disputes/'+x.caseKey,{method:'POST',body:{resolution:notes[x.caseKey]}}),'Dispute review recorded, without financial settlement.')}>
      <label htmlFor={'finance-'+x.caseKey}>Disposition and documented review</label>
      <textarea id={'finance-'+x.caseKey} rows={2} value={notes[x.caseKey]||''} onChange={e=>setNotes(n=>({...n,[x.caseKey]:e.target.value}))}/>
      <button className="secondary-link" disabled={busy||(notes[x.caseKey]||'').trim().length<10}>Record review</button>
     </form>
    </li>)}</ul>}
   </section>}
   </div></>}
 </main>;
}
