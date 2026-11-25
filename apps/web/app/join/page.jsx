import {isLocalMode} from '../../lib/local-public.mjs';
import LocalJoin from './LocalJoin.jsx';
import HostedAccount from '../HostedAccount.jsx';
export const dynamic='force-dynamic';
export default function Page(){return isLocalMode()?<LocalJoin/>:<HostedAccount mode="invite"/>;}
