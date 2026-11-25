'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
export default function FinanceOverview(){
 const [finance,setFinance]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;api('admin/finance-overview').then(x=>{if(active)setFinance(x.finance);}).catch(e=>{if(active)setError(friendlyError(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false};},[]);
 const money=kobo=>'₦'+(kobo/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});
 return <main id="main" className="main admin-console"><section className="hero compact"><h1>Financial reconciliation</h1><p>Read-only sandbox accounting. No real funds or withdrawals.</p><Link href="/manage">Back to administration</Link></section>
 {loading?<p role="status">Loading financial records…</p>:error?<p role="alert">{error}</p>:finance&&<section className="panel"><h2>{finance.balanced?'Journal balances':'Journal requires investigation'}</h2><dl>
 {[[ 'Recorded charges',finance.grossKobo],['Recorded reversals',finance.reversedKobo],['Creator pending accounting',finance.creatorPendingKobo],['Duplicate payment liabilities',finance.duplicateLiabilityKobo],['Provider fee suspense',finance.providerFeeKobo],['Debits',finance.debitKobo],['Credits',finance.creditKobo]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}
 <dt>Unresolved inbox events</dt><dd>{finance.inboxUnresolved}</dd><dt>Exhausted retries</dt><dd>{finance.inboxDeadLetters}</dd></dl><p>Withdrawals are disabled. An internally balanced journal is not proof of provider settlement.</p></section>}</main>;
}
