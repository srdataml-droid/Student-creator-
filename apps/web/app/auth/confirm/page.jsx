'use client';
import {useState} from 'react';
export default function ConfirmPage(){
 const [busy,setBusy]=useState(false),[result,setResult]=useState(''),[done,setDone]=useState(false);
 async function submit(event){
  event.preventDefault();setBusy(true);setResult('');
  const form=new FormData(event.currentTarget);
  try{
   const response=await fetch('/api/hosted-auth/complete',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',cache:'no-store',
    body:JSON.stringify({email:form.get('email'),purpose:form.get('purpose'),code:form.get('code'),password:form.get('password')})});
   if(!response.ok)throw Error('unavailable');
   setDone(true);setResult('Your password has been set. Sign in again to continue.');
  }catch{setResult('Unable to complete this request. Check the code or request a new one.');}finally{setBusy(false);}
 }
 return <main style={{maxWidth:480,margin:'2rem auto',padding:'1rem'}}>
  <h1>Confirm your account</h1>
  <p>Enter the code from your email and choose a password.</p>
  {!done&&<form onSubmit={submit} style={{display:'grid',gap:'1rem'}}>
   <label>Email<input name="email" type="email" autoComplete="email" required style={{display:'block',width:'100%'}}/></label>
   <label>Request<select name="purpose" required style={{display:'block',width:'100%'}}>
    <option value="invite">Invitation</option><option value="signup">Email verification</option><option value="recovery">Password recovery</option>
   </select></label>
   <label>Verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required style={{display:'block',width:'100%'}}/></label>
   <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required style={{display:'block',width:'100%'}}/></label>
   <button type="submit" disabled={busy}>{busy?'Confirming…':'Confirm account'}</button>
  </form>}
  <p role="status" aria-live="polite">{result}</p>
 </main>;
}
