import './globals.css';
import './frontend-revamp.css';
import AppShell from './AppShell.jsx';
import HostedAccountProvider from './HostedAccountProvider.jsx';
export const metadata={title:'Student Creators | Worthkind',description:'Discover original student-created videos, notes, projects and campus communities.'};
export default function RootLayout({children}){
 return <html lang="en"><body className="creator-body"><a className="skip" href="#main">Skip to content</a><HostedAccountProvider hosted={process.env.APP_DATA_MODE==='hosted'} mediaMode={process.env.STUDENT_CREATORS_ENVIRONMENT==='production'?'private':'test'}><AppShell>{children}</AppShell></HostedAccountProvider></body></html>;
}
