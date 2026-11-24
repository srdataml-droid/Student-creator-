'use client';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';

/** Deliberately test-only: live purchases and payouts are not enabled. */
export default function PurchasePanel({lessonId,priceKobo}){
 const [checkoutAvailable,setCheckoutAvailable]=useState(false);
 const [order,setOrder]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 useEffect(()=>{
  let active=true;
  Promise.all([api('health'),api('my/purchases')]).then(([health,purchases])=>{
   if(!active)return;
   setCheckoutAvailable(Boolean(health.sandboxCheckoutEnabled));
   setOrder((purchases.orders||[]).find(x=>x.lessonId===lessonId)||null);
  }).catch(e=>{if(active)setError(friendlyError(e));});
  return ()=>{active=false};
 },[lessonId]);
 const naira=(priceKobo/100).toLocaleString('en-NG');
 async function checkout(){
  setError('');setMessage('');setBusy(true);
  try{
   const requestKey=globalThis.crypto?.randomUUID?.();
   if(!requestKey)throw new Error('Secure checkout initialization is unavailable.');
   const result=order|| (await api('lessons/'+lessonId+'/orders',{method:'POST',body:{requestKey}})).order;
   setOrder(result);
   if(result.status==='paid'){window.location.reload();return;}
   const response=await api('orders/'+result.reference+'/checkout',{method:'POST',body:{}});
   const url=new URL(response.checkout.authorizationUrl);
   if(url.protocol!=='https:'||!['checkout.paystack.com','paystack.com'].includes(url.hostname))
    throw new Error('Untrusted checkout destination.');
   window.location.assign(url.toString());
  }catch(e){setError(friendlyError(e));}
  finally{setBusy(false);}
 }
 async function verify(){
  if(!order?.reference)return;
  setError('');setMessage('');setBusy(true);
  try{
   const result=await api('orders/'+order.reference+'/confirm',{method:'POST',body:{}});
   setOrder(result.order);
   if(result.order.status==='paid'){window.location.reload();return;}
   setMessage('Your order has not been confirmed yet.');
  }catch(e){setError(friendlyError(e));}
  finally{setBusy(false);}
 }
 return <section className="panel paid-access-card" aria-label="Paid creator access">
  <p className="eyebrow">PAID CREATOR WORK</p>
  <h2>Unlock access for ₦{naira}</h2>
  <p>Buying access lets you view this creator’s original work. The creator retains the copyright. Republishing or sharing source files is not included.</p>
  <p className="hint">{checkoutAvailable?'No real payment will be collected.':'Checkout is currently unavailable.'}</p>
  {order?.status==='refunded'?<p role="status" className="hint">This order was reversed and viewing access was revoked. Repurchase is currently unavailable.</p>:checkoutAvailable?<div className="button-row">
   <button className="primary-link" type="button" disabled={busy} onClick={checkout}>{busy?'Checking…':'Open checkout'}</button>
   {order?.status==='pending'&&<button className="secondary-link" type="button" disabled={busy} onClick={verify}>Check order status</button>}
  </div>:<p role="status" className="hint">Access is not available until your order is confirmed.</p>}
  {order&&<p className="hint">Order status: {order.status}. </p>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
