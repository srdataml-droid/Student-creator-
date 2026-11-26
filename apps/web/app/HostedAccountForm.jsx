'use client';
import Link from 'next/link';
import {useState,useRef} from 'react';
import {useRouter} from 'next/navigation';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export default function HostedAccountForm({mode}){
 const account=useHostedAccount(),router=useRouter(),locked=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[stage,setStage]=useState(mode);
 async function submit(e){
  e.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  const data=new FormData(e.currentTarget);
  try{
   if(stage==='sign-in'){await account.signIn(String(data.get('email')),String(data.get('password')));router.replace('/');}
   else if(stage==='join'){await account.invite(String(data.get('inviteCode')));setStage('invite-confirm');setNotice('Invitation request accepted. Check the email associated with your invitation. Delivery is not confirmed.');}
   else if(stage==='recover'){await account.recover(String(data.get('email')));setStage('recovery-confirm');setNotice('If your account is eligible, check your email for a recovery code.');}
   else{const password=String(data.get('password'));if(password!==String(data.get('confirmation'))){setError('Passwords do not match.');return;}await account.complete(String(data.get('email')),stage==='invite-confirm'?'invite':'recovery',String(data.get('code')),password);setStage('done');}
  }catch(e){setError(e.status===429?'Too many attempts. Try again later.':stage==='sign-in'&&e.status===401?'Sign-in was not accepted. Check your credentials.':e.status===503||e.status===404?'Account service is temporarily unavailable.':'Unable to complete this request. Check the details and try again.');}
  finally{locked.current=false;setBusy(false);}
 }
 const confirm=stage==='invite-confirm'||stage==='recovery-confirm';
 const heading=stage==='sign-in'?'Sign in':stage==='join'?'Join Student Creators':stage==='recover'?'Recover your account':stage==='done'?'Password set':stage==='invite-confirm'?'Confirm your invitation':'Enter your recovery code';
 return <main id="main" className="main hosted-account-page"><section className="account-form-wrap"><header><h1>{heading}</h1><p className="hint">{stage==='join'?'Student Creators is currently accepting invited students only.':stage==='sign-in'?'Continue to your student account.':stage==='done'?'Sign in with your new password.':'Follow the private account instructions below.'}</p></header>
 {stage==='done'?<Link href="/sign-in" className="primary-link">Sign in</Link>:<form key={stage} className="form-stack" onSubmit={submit}>
 {stage==='join'?<><label htmlFor="inviteCode">Invitation code</label><input id="inviteCode" name="inviteCode" type="password" minLength={32} maxLength={128} pattern="[A-Za-z0-9_-]{32,128}" required autoComplete="off"/></>:<><label htmlFor="account-email">Email</label><input id="account-email" name="email" type="email" maxLength={254} required autoComplete="email"/></>}
 {confirm&&<><label htmlFor="account-code">Verification code</label><input id="account-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required/></>}
 {(stage==='sign-in'||confirm)&&<><label htmlFor="account-password">Password</label><input id="account-password" name="password" type="password" minLength={12} maxLength={128} required autoComplete={confirm?'new-password':'current-password'}/></>}
 {confirm&&<><label htmlFor="account-confirmation">Confirm password</label><input id="account-confirmation" name="confirmation" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 {notice&&<p role="status" className="hint">{notice}</p>}
 <button className="primary-link" disabled={busy} type="submit">{busy?'Please wait…':stage==='join'?'Request invitation':stage==='recover'?'Request recovery code':confirm?'Confirm password':'Sign in'}</button></form>}
 {stage==='sign-in'?<p><Link href="/recover-account">Forgot password?</Link> · <Link href="/join">Join</Link></p>:stage!=='done'&&<p><Link href="/sign-in">Return to sign in</Link></p>}
 {(stage==='join'||stage==='recover')&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>{setStage(stage==='join'?'invite-confirm':'recovery-confirm');setError('');setNotice('');}}>I already have a code</button>}
 <p className="hint">Email access does not establish verified student membership.</p>
 </section></main>;
}
