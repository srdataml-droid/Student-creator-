'use client';
import Link from 'next/link';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export default function HostedGate({title,children}){
 const account=useHostedAccount();
 return <main id="main" className="main hosted-workspace"><h1>{title}</h1>{account?.session.state==='signed-in'?children:account?.session.state==='checking'?<p role="status">Checking account…</p>:account?.session.state==='unavailable'?<p role="alert">Account service is unavailable.</p>:<Link className="primary-link" href="/sign-in">Sign in</Link>}</main>;
}
