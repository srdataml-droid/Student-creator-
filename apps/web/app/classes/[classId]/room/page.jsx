import Link from 'next/link';
import {HostedClassRoom} from '../../../HostedLearningWorkspace.jsx';
export const dynamic='force-dynamic';
export default async function Room({params}){const {classId}=await params;return process.env.APP_DATA_MODE==='hosted'?<HostedClassRoom classId={classId} integrity={process.env.STUDENT_CREATORS_LIVEKIT_CLIENT_INTEGRITY||''}/>:<main id="main" className="main"><h1>Class room</h1><p>The hosted media service is not configured in local mode.</p><Link href="/communities">Course communities</Link></main>;}
