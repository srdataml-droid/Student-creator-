import {isLocalMode} from '../../lib/local-public.mjs';
import LocalRecovery from './LocalRecovery.jsx';
import HostedAccount from '../HostedAccount.jsx';
export const dynamic='force-dynamic';
export default function Page(){return isLocalMode()?<LocalRecovery/>:<HostedAccount mode="recover"/>;}
