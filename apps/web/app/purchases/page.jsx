'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
export default function PurchaseHistory(){
 const [orders,setOrders]=useState([]),[state,setState]=useState('loading'),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  api('my/purchases').then(d=>{if(active){setOrders(d.orders||[]);setState('ready');}})
   .catch(e=>{if(active){setState('error');setError(friendlyError(e));}});
  return ()=>{active=false};
 },[]);
 return <main id="main" className="main">
  <section className="hero compact"><p className="eyebrow">YOUR LIBRARY</p><h1>Purchased creator access</h1>
   <p className="intro">A private record of your test purchases. These are viewing entitlements, not copyright transfers or source-file ownership.</p>
  </section>
  {state==='loading'?<p role="status">Loading your orders…</p>:
   state==='error'?<p role="alert" className="status">{error} <Link href="/sign-in">Sign in</Link></p>:
   orders.length===0?<div className="panel"><p>No purchases yet.</p><Link className="secondary-link" href="/">Discover student creators</Link></div>:
   <section className="panel"><h2>Order history</h2><ul className="review-list">{orders.map(order=><li key={order.reference}>
    <p className="eyebrow">{order.status==='paid'?'Verified test purchase':order.status==='refunded'?'Synthetic refund · access revoked':'Awaiting sandbox verification'}</p>
    <h3>₦{(order.amountKobo/100).toLocaleString('en-NG')} · {order.currency}</h3>
    <p className="hint">Reference: {order.reference} · Created {new Date(order.createdAt).toLocaleDateString('en-NG')}</p>
    {order.status==='paid'?<p className="hint">Access was granted in the local synthetic ledger; no bank settlement or creator withdrawal occurred.</p>:order.status==='refunded'?<p className="hint">This synthetic purchase was reversed using a balanced journal adjustment, and viewing access was revoked.</p>:
      <p className="hint">Pending orders do not unlock lessons.</p>}
    <Link className="secondary-link" href={'/lessons/'+order.lessonId}>{order.status==='paid'?'Open lesson':'Check lesson access'}</Link>
   </li>)}</ul></section>}
 </main>;
}
