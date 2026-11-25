import './globals.css';
import './frontend-revamp.css';
import {isLocalMode} from '../lib/local-public.mjs';
import AppShell from './AppShell.jsx';
export const metadata={title:'Student Creators | Worthkind',description:'Discover original student-created videos, notes, projects and campus communities.'};
export const dynamic='force-dynamic';
export default function RootLayout({children}){
 return <html lang="en"><body className="creator-body"><a className="skip" href="#main">Skip to content</a><AppShell hosted={!isLocalMode()}>{children}</AppShell></body></html>;
}
