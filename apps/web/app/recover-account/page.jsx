'use client';
import Link from 'next/link';
import {useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
export default function RecoverAccount(){
 const [email,setEmail]=useState(''),[token,setToken]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false);
 async function requestCode(e){e.preventDefault();setBusy(true);setError('');setMessage('');try{await api('auth/password/recover',{method:'POST',body:{email}});setMessage('If a verified student account can receive a code, check its email.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function reset(e){e.preventDefault();setError('');setMessage('');if(password!==confirmation){setError('The passwords do not match.');return;}setBusy(true);try{await api('auth/password/reset',{method:'POST',body:{token:token.trim(),password}});setToken('');setPassword('');setConfirmation('');setDone(true);}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main id="main" className="main"><section className="auth-shell"><div className="auth-intro"><p className="eyebrow">Student account access</p><h1>Recover your account</h1><p className="intro">Reset a student password using a private code sent to a previously verified email. Your old device sessions will be invalidated.</p><Link href="/sign-in">Return to sign in</Link></div><div className="panel">
 {done?<div role="status"><h2>Password updated</h2><p>Sign in using your new password.</p><Link className="primary-link" href="/sign-in">Sign in</Link></div>:<>
 <h2>Request a recovery code</h2><form className="form-stack" onSubmit={requestCode}><label htmlFor="recovery-email">Account email</label><input id="recovery-email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/><button className="secondary-link" disabled={busy} type="submit">Request code</button></form>
 <p className="hint">Email delivery may be disabled in a local development environment. Administrator recovery is handled separately.</p>
 <h2>Enter your recovery code</h2><form className="form-stack" onSubmit={reset}>
 <label htmlFor="recovery-code">Private recovery code</label><input id="recovery-code" type="password" autoComplete="off" required minLength={43} maxLength={43} value={token} onChange={e=>setToken(e.target.value)}/>
 <label htmlFor="new-password">New password (12–128 characters)</label><input id="new-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/>
 <label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
 <button className="primary-link" disabled={busy} type="submit">Reset password</button></form>
 </>}
 {message&&<p role="status" className="form-success">{message}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
 </div></section></main>;
}
