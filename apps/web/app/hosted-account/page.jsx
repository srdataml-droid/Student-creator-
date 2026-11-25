import {notFound} from 'next/navigation';
import {isLocalMode} from '../../lib/local-public.mjs';
import HostedAccount from '../HostedAccount.jsx';
export const dynamic='force-dynamic';
export default function Page(){if(isLocalMode())return notFound();return <HostedAccount mode="account"/>;}
