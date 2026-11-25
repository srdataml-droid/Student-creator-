'use client';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
import {HostedIdentity} from '../HostedCreatorWorkspace.jsx';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';

/** Shows scoped affiliation only. There is deliberately no ID-photo upload,
 * self-issued verification badge or institutional admin impersonation flow. */
function LocalStudentVerification(){
 const [account,setAccount]=useState(null),[affiliation,setAffiliation]=useState(null);
 const [appeals,setAppeals]=useState([]),[phase,setPhase]=useState('loading');
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[success,setSuccess]=useState('');
 const [signingOut,setSigningOut]=useState(false),[confirmSignOut,setConfirmSignOut]=useState(false),[securityError,setSecurityError]=useState('');
 async function signOutEverywhere(){
  setSigningOut(true);setSecurityError('');
  try{await api('auth/logout-all',{method:'POST',body:{}});window.location.assign('/sign-in');}
  catch(e){setSecurityError(friendlyError(e));setSigningOut(false);}
 }
 async function load(){
  try{
   const [me,identity,cases]=await Promise.all([api('me'),api('me/institution-affiliation'),api('me/verification-appeals')]);
   setAccount(me.user);setAffiliation(identity.affiliation);setAppeals(cases.appeals||[]);setPhase('ready');
  }catch(e){setError(friendlyError(e));setPhase(e.status===401?'guest':'error');}
 }
 useEffect(()=>{void load();},[]);
 async function appeal(event){
  event.preventDefault();setError('');setSuccess('');setBusy(true);
  try{
   const response=await api('me/verification-appeals',{method:'POST',body:{reason:reason.trim()}});
   setSuccess(response.appeal.replayed?'Your request is already under review.':'Your review request was recorded privately.');
   setReason('');await load();
  }catch(e){setError(friendlyError(e));}finally{setBusy(false);}
 }
 return <main className="main" id="main"><section className="hero compact">
  <p className="eyebrow">STUDENT MEMBERSHIP · PRIVACY FIRST</p>
  <h1>Your campus eligibility</h1>
  <p className="intro">Your private student verification is separate from your public creator identity and from platform administration.</p>
 </section>
 {phase==='loading'?<p role="status">Checking your eligibility…</p>:
 phase==='guest'?<section className="panel"><p>Sign in to view private membership status and submit a review request.</p><Link className="primary-link" href="/sign-in">Sign in</Link></section>:
 phase==='error'?<section className="panel"><p role="alert">{error||'Membership status is unavailable.'}</p><button type="button" onClick={()=>{setPhase('loading');void load();}}>Retry</button></section>:
 <div className="verification-grid">
  <section className="panel" aria-label="Institutional membership status"><p className="eyebrow">PRIVATE ACCOUNT STATUS</p>
   <h2>{account?.verifiedAt?'Independently verified student':'Awaiting manual student review'}</h2>
   <p className="intro">{affiliation?.classification==='unconfirmed'
    ?'No authorized institution provider proof has been attached. An administrator may still verify your student status manually.'
    :'Institution affiliation: '+affiliation.classification+' · '+affiliation.state}</p>
   <p className="hint">Provider eligibility: {affiliation?.eligible?'Current':'Not currently confirmed'}. Institution status by itself never grants administrative privileges or approves a creator account.</p>
   {affiliation?.validUntil&&<p className="hint">Institution proof must be revalidated by {new Date(affiliation.validUntil*1000).toLocaleDateString('en-NG')}.</p>}
   <p className="hint">Do not upload school IDs or other personal documents into messages or public posts. A reviewed private evidence workflow is not yet enabled.</p>
  </section>
  <section className="panel" aria-label="Verification appeal form">
   <h2>Request a membership review</h2>
   <p className="hint">Use this if your affiliation was misclassified, your institution cannot yet integrate, or an eligibility decision seems wrong. This request does not override moderation or activate an institutional connection.</p>
   <form className="form-stack" onSubmit={appeal}>
    <label htmlFor="verificationReason">Describe what needs to be reviewed</label>
    <textarea id="verificationReason" rows={4} minLength={20} maxLength={800} required value={reason}
     placeholder="Explain your enrollment issue without including your student number or ID photo."
     onChange={e=>setReason(e.target.value)} disabled={busy}/>
    <button className="primary-link" type="submit" disabled={busy||reason.trim().length<20}>{busy?'Submitting…':'Request independent review'}</button>
   </form>
   {success&&<p role="status" className="form-success">{success}</p>}
   {error&&<p role="alert" className="form-error">{error}</p>}
  </section>
  <section className="panel" aria-label="Account security"><h2>Account security</h2>
   <p className="hint">Sign out on every device, including this one. Existing playback authorizations linked to those sessions are revoked. Your account and purchases are not deleted.</p>
   {confirmSignOut?<div><p>Sign out everywhere now?</p><button className="primary-link" type="button" disabled={signingOut} onClick={signOutEverywhere}>{signingOut?'Signing out…':'Confirm sign out everywhere'}</button> <button type="button" disabled={signingOut} onClick={()=>setConfirmSignOut(false)}>Cancel</button></div>:<button className="primary-link" type="button" onClick={()=>setConfirmSignOut(true)}>Sign out everywhere</button>}
   {securityError&&<p role="alert" className="form-error">{securityError}</p>}
  </section>
  <section className="panel"><h2>Your review history</h2>{appeals.length?
   <ul className="review-list">{appeals.map(item=><li key={item.caseId}>
     <strong>{item.status==='open'?'Awaiting review':item.status.replace('_',' ')}</strong>
     <p className="hint">{new Date(item.createdAt).toLocaleDateString('en-NG')} · Case reference {item.caseId}</p>
    </li>)}</ul>:<p className="hint">No verification review requests yet.</p>}
  </section>
 </div>}
 </main>;
}

export default function StudentVerification(){const hosted=useHostedAccount();return hosted?<HostedIdentity/>:<LocalStudentVerification/>;}
