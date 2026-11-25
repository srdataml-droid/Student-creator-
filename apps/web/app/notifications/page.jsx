'use client';
import Link from 'next/link';
import {HostedNotifications} from '../HostedSocialWorkspace.jsx';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
export default function Notifications(){const a=useHostedAccount();return a?<HostedNotifications key={a.session.userId||a.session.state}/>:<main id="main" className="main"><h1>Notifications</h1><p>In-app notification integration is not available in this local branch.</p><Link href="/messages">Messages</Link></main>;}
