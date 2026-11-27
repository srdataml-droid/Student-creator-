'use client';
import {useRef,useState} from 'react';
import {useHostedAccount} from './HostedAccountProvider.jsx';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validAmount=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0||typeof x==='string'&&/^[1-9]\d{0,15}$/.test(x)&&BigInt(x)<=9007199254740991n;
const money=x=>{const n=BigInt(x);return '₦'+(n/100n).toLocaleString('en-NG')+'.'+String(n%100n).padStart(2,'0');};
const labels={authorize:'Authorize transfer for worker review',recheck:'Request provider status verification',void_before_dispatch:'Void before dispatch',confirm_paid:'Confirm independently verified bank payment',confirm_returned:'Confirm independently verified bank return'};
function actions(r){
 if(r.stage===null)return ['authorize'];
 const result=[];
 if(!r.dispatch_attempted_at&&['ready','review'].includes(r.stage))result.push('void_before_dispatch');
 if(r.dispatch_attempted_at&&['review','verifying','observed'].includes(r.stage))result.push('recheck');
 if(r.stage==='observed'&&r.provider_status==='success'&&r.bank_state==='unconfirmed')result.push('confirm_paid');
 if(r.stage==='observed'&&['failed','reversed'].includes(r.provider_status)&&r.bank_state!=='returned'&&(r.bank_state!=='paid'||r.provider_status==='reversed'))result.push('confirm_returned');
 return result;
}
function read(data,transfer){
 const rows=data?.result?.items;
 if(!Array.isArray(rows)||rows.length>50)throw Error('INVALID_QUEUE');
 return rows.map(r=>{
  if(!uuid.test(r?.id??'')||!uuid.test(r.creator_id??'')||!validAmount(r.amount_kobo)||!Number.isFinite(Date.parse(r.created_at)))throw Error('INVALID_QUEUE');
  if(transfer){if(![null,'ready','verifying','observed','review','cancelled'].includes(r.stage)||![null,'unconfirmed','paid','returned'].includes(r.bank_state))throw Error('INVALID_QUEUE');}
  else if(r.state!=='pending_review')throw Error('INVALID_QUEUE');
  return r;
 });
}
export default function FinanceWithdrawalConsole(){
 const a=useHostedAccount();
 return a?.session.state==='signed-in'?<Console key={a.session.userId}/>:null;
}
function Console(){
 const a=useHostedAccount(),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[transfers,setTransfers]=useState(null),[selection,setSelection]=useState(null),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
 function clear(){setSelection(null);setNote('');setConfirmed(false);}
 async function load(){
  clear();const [p,t]=await Promise.all([a.creatorRequest('financeWithdrawalQueue',{}),a.creatorRequest('financeTransferQueue',{})]);setPending(read(p,false));setTransfers(read(t,true));
 }
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.status===403?'Finance permission or payout policy denied this action.':e.status===409?'Request state changed. Refresh before taking another action.':'Unable to confirm the operation. Refresh before retrying.');clear();}finally{lock.current=false;setBusy(false);}}
 function choose(row,action,transfer){setSelection({id:row.id,action,transfer});setNote('');setConfirmed(false);}
 const needsEvidence=selection?.transfer&&['confirm_paid','confirm_returned'].includes(selection.action);
 return <section className="panel"><h2>Withdrawal operations</h2><p className="hint">Review cleared earnings and independent bank evidence. A reservation is not a transfer. Authorizing a transfer does not confirm payment; the server and worker enforce approval gates.</p>
 <button type="button" disabled={busy} onClick={()=>run(load)}>Load withdrawals</button>
 {pending&&<><h3>Pending review</h3>{pending.length===0?<p>No pending withdrawals.</p>:<ul className="review-list">{pending.map(r=><li key={r.id}><strong>{money(r.amount_kobo)}</strong><p>Student {r.creator_id.slice(0,8)} · {new Date(r.created_at).toLocaleString()}</p><div className="button-row"><button type="button" disabled={busy} onClick={()=>choose(r,'reserve',false)}>Reserve earnings</button><button type="button" disabled={busy} onClick={()=>choose(r,'reject',false)}>Reject</button></div></li>)}</ul>}</>}
 {transfers&&<><h3>Transfer reconciliation</h3>{transfers.length===0?<p>No outstanding transfers.</p>:<ul className="review-list">{transfers.map(r=><li key={r.id}><strong>{money(r.amount_kobo)}</strong><p>Student {r.creator_id.slice(0,8)} · {r.stage??'Not authorized'}</p><p>Provider: {r.provider_status??'Not dispatched'} · Bank: {r.bank_state??'Unconfirmed'}</p><div className="button-row">{actions(r).map(action=><button key={action} type="button" disabled={busy} onClick={()=>choose(r,action,true)}>{labels[action]}</button>)}</div></li>)}</ul>}</>}
 {selection&&<form className="form-stack" onSubmit={e=>{e.preventDefault();if(!confirmed)return;run(async()=>{const s=selection;const response=await a.creatorRequest(s.transfer?'financeTransferAction':'financeWithdrawalReview',{id:s.id,...(s.transfer?{action:s.action,...(needsEvidence?{evidence:note}: {})}:{decision:s.action,note})});const result=response?.result;if(result?.id!==s.id||(!s.transfer&&result.state!==(s.action==='reserve'?'reserved':'rejected'))||(s.transfer&&typeof result.stage!=='string'))throw Error('UNCONFIRMED');clear();setNotice('Server recorded the decision. Refreshing verified status.');await load();});}}>
 <h3>Confirm {selection.transfer?labels[selection.action]:selection.action}</h3><p>Request {selection.id}</p>
 {(!selection.transfer||needsEvidence)&&<><label htmlFor="withdrawal-evidence">{needsEvidence?'Independent bank evidence reference':'Review reason'}</label><input id="withdrawal-evidence" value={note} onChange={e=>setNote(e.target.value)} required minLength={needsEvidence?8:10} maxLength={needsEvidence?128:500} autoComplete="off" disabled={busy}/></>}
 <label><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/> I have reviewed this request and authorize this recorded decision.</label><button type="submit" disabled={busy||!confirmed}>Record decision</button><button type="button" disabled={busy} onClick={clear}>Cancel</button></form>}
 {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}</section>;
}
