import Link from 'next/link';
import {HostedClassEntry} from '../HostedLearningWorkspace.jsx';
export const dynamic='force-dynamic';
export default function Classes(){return process.env.APP_DATA_MODE==='hosted'?<HostedClassEntry integrity={process.env.STUDENT_CREATORS_LIVEKIT_CLIENT_INTEGRITY||''}/>:<main id="main" className="main"><h1>Live classes</h1><p>The interactive classroom service is not part of this local branch. Use the course discussion and study round features.</p><Link href="/communities">Course communities</Link></main>;}
