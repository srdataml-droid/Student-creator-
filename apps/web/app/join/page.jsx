'use client';
import HostedAccountForm from '../HostedAccountForm.jsx';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
function LocalJoin(){
 const [schools,setSchools]=useState([]),[inviteOnly,setInviteOnly]=useState(false),[state,setState]=useState('loading'),[form,setForm]=useState({email:'',password:'',institutionId:'',inviteCode:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[created,setCreated]=useState(false);
 useEffect(()=>{Promise.all([api('institutions'),api('health')]).then(([d,health])=>{setSchools(d.institutions);setInviteOnly(Boolean(health.pilotInviteOnly));setState('ready')}).catch(()=>setState('unavailable'));},[]);
 async function submit(e){e.preventDefault();setError('');setBusy(true);try{await api('auth/register',{method:'POST',body:form});setCreated(true);}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main className="main campus-onboarding" id="main"><section className="auth-shell"><div className="auth-intro"><p className="eyebrow">Student Creators</p><h1>Learn, create &amp; grow on campus.</h1><p className="intro">A space to learn from students who understand your classes and share original work of your own. Start with a private verified student account.</p><ol className="onboarding-steps"><li><strong>Find your campus</strong><span>Explore original explanations and student creators.</span></li><li><strong>Create what you know</strong><span>Publish videos or notes after membership review.</span></li><li><strong>Own your work</strong><span>You retain copyright in the original work you share.</span></li></ol></div><div className="panel">
 {created?<div role="status"><h2>Account created</h2><p>Your account is pending campus verification. An administrator must approve your membership before you can publish.</p><Link href="/sign-in" className="primary-link">Sign in</Link></div>:<><h2>Create your account</h2><p className="hint">Choose a strong, unique password to protect your account.</p>
 {state==='loading'?<p role="status">Loading campuses…</p>:state==='unavailable'?<p role="alert">Campus registration is temporarily unavailable. Please try again later.</p>:schools.length===0?<p role="status">No campuses are currently accepting registrations.</p>:<form className="form-stack" onSubmit={submit}>
  <label htmlFor="campus">University or school</label><select id="campus" required value={form.institutionId} onChange={e=>setForm({...form,institutionId:e.target.value})}><option value="">Choose your school</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
  <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
  <label htmlFor="password">Password (12+ characters)</label><input id="password" type="password" minLength="12" autoComplete="new-password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
  {inviteOnly&&<><label htmlFor="inviteCode">Invitation code</label><input id="inviteCode" type="password" required minLength={32} maxLength={128} pattern="[A-Za-z0-9_-]{32,128}" autoComplete="off" value={form.inviteCode} onChange={e=>setForm({...form,inviteCode:e.target.value})}/><p className="hint">Enter your invitation code. Your student membership will be verified separately.</p></>}
  {error&&<p role="alert" className="form-error">{error}</p>}<button type="submit" disabled={busy} className="primary-link">{busy?'Creating account…':'Create account'}</button>
 </form>}
 <p className="hint">Already registered? <Link href="/sign-in">Sign in</Link></p></>}
 </div></section></main>;
}

export default function Join(){const hosted=useHostedAccount();return hosted?<HostedAccountForm mode="join"/>:<LocalJoin/>;}
