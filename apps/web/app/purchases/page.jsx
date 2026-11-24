'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
function Receipt({reference}){
 const [receipt,setReceipt]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');setReceipt(null);try{const result=await api('orders/'+encodeURIComponent(reference)+'/receipt');setReceipt(result.receipt);}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 const money=kobo=>'₦'+(kobo/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});
 return <div><button type="button" className="secondary-link" disabled={busy} onClick={load}>{busy?'Loading receipt…':'View receipt'}</button>
 {error&&<p role="alert">{error}</p>}
 {receipt&&<section aria-label="Purchase receipt"><h4>Purchase receipt</h4><p>Sandbox record · No real money collected</p><dl><dt>Order reference</dt><dd>{receipt.reference}</dd><dt>Recorded payment</dt><dd>{money(receipt.amountKobo)}</dd><dt>Reversed amount</dt><dd>{money(receipt.reversedKobo)}</dd><dt>Net recorded payment</dt><dd>{money(receipt.netKobo)}</dd><dt>Recorded on</dt><dd>{new Date(receipt.paidAt).toLocaleString('en-NG')}</dd><dt>Status</dt><dd>{receipt.status}</dd></dl></section>}</div>;
}
export default function PurchaseHistory(){
 const [cases,setCases]=useState([]);
 const [orders,setOrders]=useState([]),[state,setState]=useState('loading'),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  Promise.all([api('my/purchases'),api('my/payment-disputes')]).then(([d,reviews])=>{if(active){setOrders(d.orders||[]);setCases(reviews.cases||[]);setState('ready');}})
   .catch(e=>{if(active){setState('error');setError(friendlyError(e));}});
  return ()=>{active=false};
 },[]);
 return <main id="main" className="main">
  <section className="hero compact"><p className="eyebrow">YOUR LIBRARY</p><h1>Purchased creator access</h1>
   <p className="intro">Review your orders and access to original creator work. Creators retain ownership of their content.</p>
  </section>
  {state==='loading'?<p role="status">Loading your orders…</p>:
   state==='error'?<p role="alert" className="status">{error} <Link href="/sign-in">Sign in</Link></p>:
   orders.length===0?<div className="panel"><p>No purchases yet.</p><Link className="secondary-link" href="/">Discover student creators</Link></div>:
   <section className="panel"><h2>Order history</h2><ul className="review-list">{orders.map(order=><li key={order.reference}>
    <p className="eyebrow">{order.status==='paid'?'Access granted':order.status==='pending'?'Awaiting confirmation':order.status==='refunded'?'Order reversed · access revoked':'Chargeback · access revoked'}</p>
    <h3>₦{(order.amountKobo/100).toLocaleString('en-NG')} · {order.currency}</h3>
    <p className="hint">Reference: {order.reference} · Created {new Date(order.createdAt).toLocaleDateString('en-NG')}</p>
    {order.status==='paid'?<p className="hint">Viewing access was granted. No money was collected.</p>:order.status==='refunded'?<p className="hint">This order was reversed and viewing access was revoked. No money was collected.</p>:
      <p className="hint">Pending orders do not unlock lessons.</p>}
    {['paid','refunded','chargeback'].includes(order.status)&&<Receipt reference={order.reference}/>}
    <Link className="secondary-link" href={'/lessons/'+order.lessonId}>{order.status==='paid'?'Open lesson':'Check lesson access'}</Link>
   </li>)}</ul></section>}
  {state==='ready'&&cases.length>0&&<section className="panel"><h2>Access reviews</h2>
    <p>Viewing restrictions protect the creator immediately. Your purchase record remains available for review. Contact support with your case reference to request a review.</p>
    <ul className="review-list">{cases.map(item=><li key={item.caseKey}>
      <p>{item.kind.replaceAll('_',' ')} · {item.status}</p><p className="hint">Case: {item.caseKey}</p>
      {item.resolution&&<p>{item.resolution}</p>}
    </li>)}</ul>
  </section>}
 </main>;
}
