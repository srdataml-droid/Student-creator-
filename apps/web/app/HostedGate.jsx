'use client';
import Link from 'next/link';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export default function HostedGate({title,children}){
 const account=useHostedAccount();
 return <main id="main" className="main hosted-workspace"><h1>{title}</h1>{account?.session.state==='signed-in'?children:account?.session.state==='checking'?<p role="status">Checking account…</p>:account?.session.state==='unavailable'?<div><p>Sign in to access this feature.</p><Link className="primary-link" href="/sign-in">Sign in</Link><p className="hint">If sign-in is unavailable, try again later.</p></div>:<Link className="primary-link" href="/sign-in">Sign in</Link>}</main>;
}
