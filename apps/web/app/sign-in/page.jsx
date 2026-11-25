'use client';
import HostedAccountForm from '../HostedAccountForm.jsx';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
import Link from 'next/link';
import {useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
function LocalSignIn(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e){e.preventDefault();setError('');setBusy(true);try{const result=await api('auth/login',{method:'POST',body:{email,password}});window.location.assign(result.user.role==='admin'?'/manage':'/studio');}catch(e){setError(friendlyError(e));setBusy(false);}}
 return <main className="main" id="main"><section className="auth-shell"><div className="auth-intro"><p className="eyebrow">Your knowledge, your community</p><h1>Welcome back.</h1><p className="intro">Pick up where you left off. Your drafts stay private until you submit them and a separate reviewer approves their publication.</p></div><div className="panel"><h2>Sign in</h2><form className="form-stack" onSubmit={submit}><label htmlFor="email">Email</label><input id="email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/><label htmlFor="password">Password</label><input id="password" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/>{error&&<p role="alert" className="form-error">{error}</p>}<button className="primary-link" type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p className="hint"><Link href="/recover-account">Forgot your password?</Link></p><p className="hint">New to Student Creators? <Link href="/join">Create a student account</Link>.</p></div></section></main>;
}

export default function SignIn(){const hosted=useHostedAccount();return hosted?<HostedAccountForm mode="sign-in"/>:<LocalSignIn/>;}
