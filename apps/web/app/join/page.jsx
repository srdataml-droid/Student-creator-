'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
export default function Join(){
 const [schools,setSchools]=useState([]),[state,setState]=useState('loading'),[form,setForm]=useState({email:'',password:'',institutionId:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[created,setCreated]=useState(false);
 useEffect(()=>{api('institutions').then(d=>{setSchools(d.institutions);setState('ready')}).catch(()=>setState('unavailable'));},[]);
 async function submit(e){e.preventDefault();setError('');setBusy(true);try{await api('auth/register',{method:'POST',body:form});setCreated(true);}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main className="main campus-onboarding" id="main"><section className="auth-shell"><div className="auth-intro"><p className="eyebrow">Student creators · early access</p><h1>Learn, create &amp; grow on campus.</h1><p className="intro">A space to learn from students who understand your classes and share original work of your own. Start with a private verified student account.</p><ol className="onboarding-steps"><li><strong>Find your campus</strong><span>Explore original explanations and student creators.</span></li><li><strong>Create what you know</strong><span>Publish videos or notes after membership review.</span></li><li><strong>Own your work</strong><span>You keep copyright. Paid access and payouts are not live yet.</span></li></ol><p className="onboarding-caveat">One consenting student is being tested first; invitations may be restricted.</p></div><div className="panel">
 {created?<div role="status"><h2>Account created</h2><p>Your account is pending campus verification. An administrator must approve your membership before you can publish.</p><Link href="/sign-in" className="primary-link">Sign in</Link></div>:<><h2>Create your account</h2><p className="hint">Local accounts are stored only on this machine. Do not use an important password.</p>
 {state==='loading'?<p role="status">Loading campuses…</p>:state==='unavailable'?<p role="alert">The local campus database is unavailable.</p>:schools.length===0?<p role="status">No campuses have been created yet. Ask the local administrator to set one up in Manage.</p>:<form className="form-stack" onSubmit={submit}>
  <label htmlFor="campus">University or school</label><select id="campus" required value={form.institutionId} onChange={e=>setForm({...form,institutionId:e.target.value})}><option value="">Choose your school</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
  <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
  <label htmlFor="password">Password (12+ characters)</label><input id="password" type="password" minLength="12" autoComplete="new-password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
  {error&&<p role="alert" className="form-error">{error}</p>}<button type="submit" disabled={busy} className="primary-link">{busy?'Creating account…':'Create account'}</button>
 </form>}
 <p className="hint">Already registered? <Link href="/sign-in">Sign in</Link></p></>}
 </div></section></main>;
}
