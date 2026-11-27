'use client';
import {useEffect,useRef,useState} from 'react';
import {useHostedAccount} from './HostedAccountProvider.jsx';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states={pending:'Awaiting ownership review',reviewed:'Awaiting independent registration',processing:'Registration in progress',uncertain:'Registration needs investigation',active:'Registered',rejected:'Rejected',cancelled:'Cancelled'};
const openStates=['pending','reviewed','processing','uncertain'];
function readRows(rows,staff=false){
 if(!Array.isArray(rows)||rows.length>(staff?100:10))throw Error('INVALID_BANK_STATUS');
 return rows.map(x=>{
  if(!uuid.test(x?.id??'')||!Object.hasOwn(states,x.state)||typeof x.bank_code!=='string'||!/^\d{3,6}$/.test(x.bank_code)||typeof x.last4!=='string'||!/^\d{4}$/.test(x.last4)||!Number.isFinite(Date.parse(x.created_at))||(staff&&!uuid.test(x.creator_id??'')))throw Error('INVALID_BANK_STATUS');
  return {id:x.id,bankCode:x.bank_code,last4:x.last4,state:x.state,createdAt:x.created_at,...(staff?{creatorId:x.creator_id,reviewer:x.reviewer}: {})};
 });
}
function useTask(){
 const lock=useRef(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setNotice('');setError('');
 try{await fn(setNotice);}catch(e){setError(e.status===403?'Access is restricted to eligible accounts.':e.status===409?'The request needs review or conflicts with an existing record. Refresh before retrying.':e.status===429?'Lookup limit reached. Try again later.':e.status===401?'Sign in again.':'Payout service unavailable. No success has been confirmed.');}finally{lock.current=false;setBusy(false);}}
 return {busy,notice,error,run};
}
function Feedback({task}){return <>{task.error&&<p role="alert" className="form-error">{task.error}</p>}{task.notice&&<p role="status" className="form-success">{task.notice}</p>}</>;}
export function CreatorPayoutBank(){
 const account=useHostedAccount();
 return account?.session.state==='signed-in'?<CreatorBank key={account.session.userId}/>:null;
}
function CreatorBank(){
 const account=useHostedAccount(),task=useTask(),[status,setStatus]=useState(null),[banks,setBanks]=useState(null),[bank,setBank]=useState(''),[number,setNumber]=useState(''),[consent,setConsent]=useState(false),[resolved,setResolved]=useState(null);
 const request=(op,input={})=>account.creatorRequest(op,input);
 async function load(){
  const data=await request('payoutBankStatus');
  if(typeof data.recipientVerified!=='boolean')throw Error('INVALID_BANK_STATUS');
  setStatus({recipientVerified:data.recipientVerified,rows:readRows(data.requests)});
 }
 async function list(){
  const data=await request('payoutBanks');
  if(!Array.isArray(data.banks)||!data.banks.length||data.banks.length>2000||data.banks.some(b=>typeof b.code!=='string'||!/^\d{3,6}$/.test(b.code)||typeof b.name!=='string'||!b.name||b.name.length>180))throw Error('INVALID_BANKS');
  setBanks(data.banks.map(b=>({code:b.code,name:b.name})));
 }
 function clear(){setNumber('');setBank('');setConsent(false);setResolved(null);}
 const hasOpen=status?.rows.some(x=>openStates.includes(x.state));
 const input={bankCode:bank,accountNumber:number,consent};
 return <section className="panel"><div className="heading-row"><h2>Payout bank account</h2><button type="button" className="quiet-button" disabled={task.busy} onClick={()=>task.run(load)}>Check account status</button></div>
 <p className="hint">Use an account you own. Paystack resolves the bank name; ownership must be independently reviewed before withdrawals. Never enter a bank PIN or password.</p>
 {status&&<><p role="status">{status.recipientVerified?'A verified payout recipient is on file.':'No currently verified payout recipient.'}</p>
 {status.rows.length===0?<p>No bank requests yet.</p>:<ul className="lesson-list">{status.rows.map(r=><li key={r.id}><strong>Bank {r.bankCode} · ending {r.last4}</strong><p>{states[r.state]} · {new Date(r.createdAt).toLocaleDateString()}</p>{['pending','reviewed'].includes(r.state)&&<button type="button" disabled={task.busy} onClick={()=>task.run(async notice=>{const out=await request('payoutBankCancel',{id:r.id});if(out.cancelled!==true)throw Error('UNCONFIRMED');clear();notice('Bank request cancelled.');await load();})}>Cancel request</button>}</li>)}</ul>}
 {!hasOpen&&<>{!banks?<button type="button" className="secondary-link" disabled={task.busy} onClick={()=>task.run(list)}>{status.recipientVerified?'Change payout bank':'Set payout bank'}</button>:<form className="form-stack" onSubmit={e=>{e.preventDefault();task.run(async notice=>{if(!resolved){const out=await request('payoutBankResolve',input);if(out.bankCode!==bank||out.accountLast4!==number.slice(-4)||typeof out.accountName!=='string'||out.ownershipVerified!==false)throw Error('UNCONFIRMED');setResolved(out);return;}const out=await request('payoutBankSubmit',input);if(!uuid.test(out.id??'')||out.state!=='pending')throw Error('UNCONFIRMED');clear();setBanks(null);notice('Submitted for independent ownership review.');await load();});}}>
 <label htmlFor="payout-bank-code">Bank</label><select id="payout-bank-code" required value={bank} disabled={task.busy} onChange={e=>{setBank(e.target.value);setResolved(null);}}><option value="">Choose bank</option>{banks.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select>
 <label htmlFor="payout-bank-number">Account number</label><input id="payout-bank-number" autoComplete="off" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} required value={number} disabled={task.busy} onChange={e=>{setNumber(e.target.value.replace(/\D/g,'').slice(0,10));setResolved(null);}}/>
 <label><input type="checkbox" required checked={consent} disabled={task.busy} onChange={e=>{setConsent(e.target.checked);setResolved(null);}}/> I own this account and consent to account lookup and encrypted processing for payout verification.</label>
 {resolved&&<div role="status"><strong>{resolved.accountName}</strong><p>Account ending {resolved.accountLast4}. Confirm the name before submitting. This is not ownership verification.</p></div>}
 <button className="primary-link" disabled={task.busy||!bank||number.length!==10||!consent}>{resolved?'Submit for verification':'Confirm account name'}</button><button type="button" disabled={task.busy} onClick={()=>{clear();setBanks(null);}}>Cancel</button>
 </form>}</>}
 {hasOpen&&<p className="hint">An unresolved bank request must be completed or cancelled before submitting another.</p>}</>}
 <Feedback task={task}/></section>;
}
export function FinancePayoutBank(){
 const account=useHostedAccount();
 return account?.session.state==='signed-in'?<FinanceBank key={account.session.userId}/>:null;
}
function FinanceBank(){
 const account=useHostedAccount(),task=useTask(),[rows,setRows]=useState(null),[details,setDetails]=useState(null),[evidence,setEvidence]=useState(''),[recoveryId,setRecoveryId]=useState(''),[recipientCode,setRecipientCode]=useState('');
 const request=(op,input={})=>account.creatorRequest(op,input);
 function clear(){setDetails(null);setEvidence('');setRecoveryId('');setRecipientCode('');}
 async function load(){clear();const out=await request('payoutBankQueue');setRows(readRows(out.requests,true));}
 useEffect(()=>{
  if(!details)return;
  const timer=setTimeout(clear,60000);
  function hide(){if(document.visibilityState!=='visible')clear();}
  document.addEventListener('visibilitychange',hide);return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',hide);};
 },[details]);
 return <section className="panel"><h2>Payout account reviews</h2><p className="hint">Finance reviewers only. Independently verify account ownership and record an approved evidence reference. A second reviewer must register the recipient. Registration does not transfer funds.</p>
 <button type="button" disabled={task.busy} onClick={()=>task.run(load)}>Load finance review queue</button>
 {rows?.length===0&&<p>No open bank reviews.</p>}
 {rows&&<ul className="review-list">{rows.map(r=><li key={r.id}><strong>Student {r.creatorId.slice(0,8)} · account ending {r.last4}</strong><p>{states[r.state]} · Bank {r.bankCode}</p>
 {['pending','reviewed'].includes(r.state)&&<button type="button" disabled={task.busy} onClick={()=>task.run(async()=>{clear();const d=await request('payoutBankDetails',{id:r.id});if(d.id!==r.id||d.creatorId!==r.creatorId||d.bankCode!==r.bankCode||typeof d.accountNumber!=='string'||!/^\d{10}$/.test(d.accountNumber)||!d.accountNumber.endsWith(r.last4)||typeof d.accountName!=='string')throw Error('INVALID_BANK_DETAILS');setDetails(d);})}>View private account details</button>}
 {details?.id===r.id&&<div><dl><dt>Account holder</dt><dd>{details.accountName}</dd><dt>Account number</dt><dd>{details.accountNumber}</dd></dl><button type="button" onClick={clear}>Hide private details</button>
 {r.state==='pending'&&<form className="form-stack" onSubmit={e=>{e.preventDefault();const decision=e.nativeEvent.submitter?.value;task.run(async notice=>{const out=await request('payoutBankReview',{id:r.id,decision,evidence});if(out.reviewed!==true)throw Error('UNCONFIRMED');notice('Review recorded.');await load();});}}>
 <label htmlFor={'bank-evidence-'+r.id}>Independent ownership evidence reference</label><input id={'bank-evidence-'+r.id} value={evidence} onChange={e=>setEvidence(e.target.value)} pattern="[A-Za-z0-9_.:-]{8,128}" required autoComplete="off" disabled={task.busy}/><p className="hint">Use a reference to approved evidence, not an account number or document contents.</p>
 <div className="button-row"><button type="submit" value="approve" disabled={task.busy}>Approve ownership</button><button type="submit" value="reject" disabled={task.busy}>Reject</button></div></form>}</div>}
 {r.state==='reviewed'&&r.reviewer!==account.session.userId&&<button type="button" disabled={task.busy} onClick={()=>task.run(async notice=>{clear();const out=await request('payoutBankRegister',{id:r.id});if(out.registered!==true)throw Error('UNCONFIRMED');notice('Recipient registered and independently verified.');await load();})}>Register reviewed recipient</button>}
 {['uncertain','processing'].includes(r.state)&&<div><p role="status">Do not register again. Investigate the existing Paystack recipient. An interrupted processing request can be recovered after ten minutes.</p>{r.reviewer!==account.session.userId&&<><button type="button" disabled={task.busy} onClick={()=>{clear();setRecoveryId(r.id);}}>Recover existing recipient</button>{recoveryId===r.id&&<form className="form-stack" onSubmit={e=>{e.preventDefault();task.run(async notice=>{const out=await request('payoutBankRecover',{id:r.id,recipientCode});if(out.registered!==true)throw Error('UNCONFIRMED');notice('Existing recipient verified and recovered.');await load();});}}><label htmlFor={'recipient-recovery-'+r.id}>Existing Paystack recipient reference</label><input id={'recipient-recovery-'+r.id} value={recipientCode} onChange={e=>setRecipientCode(e.target.value)} autoComplete="off" required pattern="RCP_[A-Za-z0-9]{8,80}" disabled={task.busy}/><button disabled={task.busy}>Verify existing recipient</button><button type="button" onClick={clear}>Cancel</button></form>}</>}</div>}</li>)}</ul>}
 <Feedback task={task}/></section>;
}
