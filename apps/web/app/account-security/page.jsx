'use client';
import {AppearanceSetting} from '../AppearanceProvider.jsx';
import AccountRequests from '../HostedAccountRequests.jsx';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
function LocalAccountSecurity(){
 const [state,setState]=useState('loading'),[status,setStatus]=useState(null),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function refresh(){try{setStatus(await api('me/email-status'));setState('ready');}catch(e){setState(e.status===401?'signed-out':e.status===403?'student-only':'unavailable');}}
 useEffect(()=>{refresh();},[]);
 async function run(job,success){setBusy(true);setError('');setMessage('');try{await job();setMessage(success);await refresh();}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main id="main" className="main"><section className="auth-shell"><div className="auth-intro"><p className="eyebrow">Your account</p><h1>Settings</h1><AppearanceSetting/><p className="intro">Confirm you control your email and manage sign-in sessions. Email ownership does not replace campus membership review.</p><Link href="/studio">Return to your studio</Link></div><div className="panel">
 {state==='loading'?<p role="status">Loading account security…</p>:state==='signed-out'?<p><Link href="/sign-in">Sign in</Link> to continue.</p>:state==='student-only'?<p role="alert">Email verification is available to student accounts only.</p>:state==='unavailable'?<p role="alert">Account security is unavailable.</p>:<>
 <h2>Email ownership</h2><p role="status">{status.emailVerified?'Email ownership confirmed.':'Email ownership not confirmed.'}</p>
 {!status.emailVerified&&<><p className="hint">{status.deliveryEnabled?'Request a private code and enter it below.':'Verification codes are temporarily unavailable. Please try again later.'}</p>
 <button type="button" className="secondary-link" disabled={busy||!status.deliveryEnabled} onClick={()=>run(()=>api('auth/email/verify/request',{method:'POST',body:{}}),'If a code can be issued, check your email. Wait at least one minute before requesting another.')}>Request verification code</button>
 <form className="form-stack" onSubmit={e=>{e.preventDefault();run(async()=>{await api('auth/email/verify/confirm',{method:'POST',body:{token:token.trim()}});setToken('');},'Email ownership confirmed.');}}>
 <label htmlFor="verification-code">Private verification code</label><input id="verification-code" type="password" autoComplete="off" required minLength={43} maxLength={43} value={token} onChange={e=>setToken(e.target.value)} />
 <button className="primary-link" type="submit" disabled={busy||token.trim().length!==43}>Verify email</button></form></>}
 <h2>Device sessions</h2><p className="hint">Sign out on every device, including this one. Previously issued playback grants will be invalidated.</p>
 <button className="quiet-button" disabled={busy} onClick={()=>run(async()=>{await api('auth/logout-all',{method:'POST',body:{}});window.location.assign('/sign-in');},'Signed out everywhere.')}>Sign out everywhere</button>
 </>}
 {message&&<p role="status" className="form-success">{message}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
 </div></section></main>;
}

function HostedSecurity({account}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function signOut(){setBusy(true);setError('');try{await account.logout();}catch{setError('Sign-out was not fully confirmed. Check the session status.');}finally{setBusy(false);}}
 return <main id="main" className="main hosted-account-page"><section className="account-form-wrap"><h1>Account security</h1>
 {account.session.state==='checking'?<p role="status">Checking your session…</p>:account.session.state==='signed-in'?<><p role="status">Signed in to your account.</p><p className="hint">{account.accountState?.student?'Student membership is active.':account.accountState?'Student membership is not active.':'Membership status unavailable.'}</p><p><Link href="/verification">Manage student verification</Link></p><button className="primary-link" type="button" disabled={busy} onClick={signOut}>{busy?'Signing out…':'Sign out this device'}</button></>:account.session.state==='unavailable'?<><p role="alert">Session status is unavailable.</p><button className="quiet-button" type="button" disabled={busy} onClick={signOut}>Try sign out</button></>:<Link className="primary-link" href="/sign-in">Sign in</Link>}
 {error&&<p role="alert">{error}</p>}<p><Link href="/recover-account">Reset password</Link></p></section>{account.session.state==='signed-in'&&<AccountRequests type="privacy" key={account.session.userId}/>}</main>;
}
export default function AccountSecurity(){const hosted=useHostedAccount();return hosted?<HostedSecurity account={hosted}/>:<LocalAccountSecurity/>;}
