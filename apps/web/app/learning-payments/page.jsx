'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';

const statusLabel={pending:'Awaiting verified sandbox payment',paid:'Paid — access confirmed',
 paid_review:'Payment needs operator refund review',refunded:'Refund recorded (test only)',
 chargeback:'Chargeback recorded (test only)'};
function amount(value){return '₦'+(value/100).toLocaleString('en-NG');}
export default function LearningPayments(){
 const [orders,setOrders]=useState([]),[phase,setPhase]=useState('loading'),
  [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState('');
 async function load(){
  const data=await api('me/learning-orders');
  setOrders(data.orders||[]);
 }
 useEffect(()=>{
  let active=true;
  api('me/learning-orders').then(x=>{
    if(!active)return;
    setOrders(x.orders||[]);setPhase('ready');
  }).catch(e=>{if(active)setPhase(e.status===401?'signed-out':'unavailable');});
  return()=>{active=false;};
 },[]);
 async function action(reference,kind){
   setBusy(reference+':'+kind);setNotice('');setError('');
   try{
     const data=await api('learning-orders/'+reference+'/'+kind,{method:'POST',body:{}});
     if(kind==='checkout'){
       const url=data?.checkout?.authorizationUrl;
       const host=new URL(url);
       if(host.protocol!=='https:'||!['checkout.paystack.com','paystack.com'].includes(host.hostname))
         throw Error('INVALID_CHECKOUT_RESPONSE');
       // Payment happens ONLY on the trusted Paystack test checkout site.
       setNotice('Opening the verified sandbox checkout. Return here to confirm with the provider.');
       window.open(url,'_blank','noopener,noreferrer');
     }else{
       setNotice(data.order?.status==='paid'?'Test payment confirmed and access granted.':
         data.order?.status==='paid_review'?'Payment recorded for operator review; access remains locked.':
         'Payment verification complete. See order status.');
     }
     await load();
   }catch(e){setError(friendlyError(e));}
   finally{setBusy('');}
 }
 return <main id="main" className="main">
  <Link href="/classes" className="back">← Classes</Link>
  <section className="hero compact">
    <p className="eyebrow">Safe checkout</p><h1>Your learning purchases</h1>
    <p className="intro">Test-mode checkout and verified access for classes and personalized tutoring. An order or a return from checkout does not mean payment succeeded.</p>
  </section>
  {phase==='loading'?<p role="status">Loading orders…</p>:
   phase==='signed-out'?<p className="status">Please <Link href="/sign-in">sign in</Link> to view purchases.</p>:
   phase==='unavailable'?<p className="status">Orders are available to verified students in local development only.</p>:<>
      {error&&<p className="status" role="alert">{error}</p>}
      {notice&&<p className="status" role="status">{notice}</p>}
      {orders.length===0?<p className="status">No learning purchases yet. Find a class or agree on a tutoring quote first.</p>:
       <ul className="lesson-list">
       {orders.map(o=><li className="lesson" key={o.reference}>
        <p className="code">{o.resourceKind==='class'?'Night class':'Personalized guidance'} · {o.currency}</p>
        <h2>{amount(o.amountKobo)}</h2>
        <p className="hint">{statusLabel[o.status]??o.status}</p>
        <p className="hint">Reference: {o.reference}</p>
        {o.status==='pending'&&<div className="button-row">
          <button type="button" className="secondary-link" disabled={Boolean(busy)}
            onClick={()=>action(o.reference,'checkout')}>{busy===o.reference+':checkout'?'Opening…':'Open test checkout'}</button>
          <button type="button" className="quiet-button" disabled={Boolean(busy)}
            onClick={()=>action(o.reference,'confirm')}>{busy===o.reference+':confirm'?'Verifying…':'Verify payment'}</button>
        </div>}
        {o.status==='paid_review'&&<p className="hint">Access is withheld because this service was closed. A financial operator must verify the refund.</p>}
       </li>)}
       </ul>}
  </>}
  <p className="hint">No live money, payouts or refund instructions can be completed here. A verified Paystack test-mode server integration is required.</p>
 </main>;
}
