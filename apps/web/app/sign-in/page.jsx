import {isLocalMode} from '../../lib/local-public.mjs';
import LocalSignIn from './LocalSignIn.jsx';
import HostedAccount from '../HostedAccount.jsx';
export const dynamic='force-dynamic';
export default function Page(){return isLocalMode()?<LocalSignIn/>:<HostedAccount mode="sign-in"/>;}
