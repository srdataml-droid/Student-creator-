'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';

const outcomes=[
  ['return_to_review','Return guidance for student confirmation'],
  ['resume_guidance','Resume creator guidance'],
  ['cancel_service','Cancel service and open financial review']
];
export default function LearningOperations(){
  const [state,setState]=useState('loading'),[cases,setCases]=useState([]),[decisions,setDecisions]=useState([]),[refunds,setRefunds]=useState([]);
  const [notes,setNotes]=useState({}),[outcome,setOutcome]=useState({}),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function refresh(){
    const session=await api('me');
    if(session.user?.role!=='admin'){setState('forbidden');return;}
    const [reports,ready,reviews]=await Promise.all([
      api('admin/learning-disputes'),
      api('admin/learning-disputes/pending-finalization'),
      api('admin/learning-refund-reviews')
    ]);
    setCases(reports.disputes||[]);setDecisions(ready.requests||[]);setRefunds(reviews.reviews||[]);setState('ready');
  }
  useEffect(()=>{let active=true;refresh().catch(e=>{if(active)setState(e.status===401?'signed-out':'unavailable');});return()=>{active=false;};},[]);
  async function action(job,success){
    setError('');setMessage('');setBusy(true);
    try{await job();setMessage(success);await refresh();}
    catch(e){setError(friendlyError(e));}
    finally{setBusy(false);}
  }
  return <main id="main" className="main admin-console">
    <Link href="/manage" className="back">← Main administration</Link>
    <section className="hero compact"><p className="eyebrow">Learning operations</p>
      <h1>Classes, reports and payment reviews</h1>
      <p className="intro">Resolve tutoring concerns, review paid-service issues and close expired classes. Case review never automatically pays a refund or authorizes a withdrawal.</p>
    </section>
    {state==='loading'?<p role="status">Loading private learning operations…</p>:
      state==='signed-out'?<p role="alert" className="status">Please <Link href="/sign-in">sign in</Link> as an administrator.</p>:
      state==='forbidden'?<p role="alert" className="status">This area is reserved for authorized administrators.</p>:
      state==='unavailable'?<p role="alert" className="status">Learning administration is temporarily unavailable.</p>:<>
      {message&&<p role="status" className="status">{message}</p>}
      {error&&<p role="alert" className="status">{error}</p>}
      <section className="course-section">
        <h2>Open tutoring reports</h2>
        {cases.length===0?<p className="status">No unresolved reports.</p>:<ul className="lesson-list">
          {cases.map(item=><li className="lesson" key={item.id}>
            <h3>Request {item.requestId.slice(0,8)} · Report {item.id.slice(0,8)}</h3>
            <p>{item.reason}</p>
            <label htmlFor={'review-'+item.id}>Reasoned review notes</label>
            <textarea id={'review-'+item.id} rows={3} minLength={10} maxLength={1000} value={notes[item.id]||''}
              onChange={e=>setNotes(previous=>({...previous,[item.id]:e.target.value}))}/>
            <button type="button" className="secondary-link" disabled={busy||(notes[item.id]||'').trim().length<10}
              onClick={()=>action(()=>api('admin/learning-disputes/'+item.id+'/resolve',{method:'POST',body:{resolution:notes[item.id]}}),
                'Report reviewed. Choose a separate service outcome below.')}>Mark reviewed</button>
          </li>)}
        </ul>}
      </section>
      <section className="course-section">
        <h2>Service decisions awaiting finalization</h2>
        <p className="hint">All related reports must be reviewed first. Only the student can confirm that a delivered service is complete. Resuming a paid service requires an active payment entitlement.</p>
        {decisions.length===0?<p className="status">No reviewed cases awaiting a service decision.</p>:<ul className="lesson-list">
          {decisions.map(item=><li className="lesson" key={item.id}>
            <h3>{item.kind.replaceAll('_',' ')} · Request {item.id.slice(0,8)}</h3>
            <p className="hint">Quoted amount: {item.quoteKobo===null?'Not priced':item.quoteKobo===0?'Free':'₦'+(item.quoteKobo/100).toLocaleString('en-NG')}</p>
            <label htmlFor={'decision-'+item.id}>Service outcome</label>
            <select id={'decision-'+item.id} value={outcome[item.id]||''} onChange={e=>setOutcome(prev=>({...prev,[item.id]:e.target.value}))}>
              <option value="">Choose a decision</option>{outcomes.map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
            <label htmlFor={'reason-'+item.id}>Decision notes</label>
            <textarea id={'reason-'+item.id} rows={3} minLength={10} maxLength={1000} value={notes[item.id]||''}
              onChange={e=>setNotes(prev=>({...prev,[item.id]:e.target.value}))}/>
            <button type="button" className="secondary-link" disabled={busy||!outcome[item.id]||(notes[item.id]||'').trim().length<10}
              onClick={()=>action(()=>api('admin/learning-requests/'+item.id+'/finalize-dispute',{
                method:'POST',body:{outcome:outcome[item.id],reason:notes[item.id]}}),
              'The service decision was recorded. Financial action remains separate.')}>Finalize service decision</button>
          </li>)}
        </ul>}
      </section>
      <section className="course-section">
        <h2>Outstanding financial reviews</h2>
        <p className="hint">Read-only financial review. Confirm the actual provider charge, cancellation policy and Week 5 ledger before initiating any money movement outside this page.</p>
        {refunds.length===0?<p className="status">No payment reviews require attention.</p>:<ul className="lesson-list">
          {refunds.map(item=><li className="lesson" key={item.id}>
            <h3>{item.resourceKind==='class'?'Class':'Learning service'} · {item.resourceId.slice(0,8)}</h3>
            <p>{item.reason}</p><p className="hint">Status: {item.status.replaceAll('_',' ')}. No refund has been processed by this workflow.</p>
          </li>)}
        </ul>}
      </section>
      <section className="course-section">
        <h2>Class lifecycle recovery</h2>
        <p className="hint">Operator-initiated sweep for sessions whose scheduled end time has passed. Hosted cron automation and real provider cleanup still require staging configuration.</p>
        <button type="button" className="secondary-link" disabled={busy}
          onClick={()=>action(()=>api('admin/learning-classes/expire',{method:'POST',body:{limit:50}}),
            'Expired sessions reviewed and room cleanup queued.')}>Review expired classes</button>
      </section>
    </>}
  </main>;
}
