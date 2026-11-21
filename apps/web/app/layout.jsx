import Link from 'next/link';
import './globals.css';
export const metadata={title:'Campus Learning | Learn better together',description:'Original university course explanations from verified student creators'};
export default function RootLayout({children}){
 return <html lang="en"><body><a className="skip" href="#main">Skip to content</a><header className="top"><Link className="mark" href="/" aria-label="Campus Learning home"><span className="brand-icon" aria-hidden="true">C</span><span>Campus<span className="brand-alt">Learning</span></span></Link><nav aria-label="Primary"><Link href="/">Courses</Link><Link href="/search">Search</Link><Link href="/saved">Saved</Link><Link href="/studio">Creator studio</Link><Link href="/messages">Messages</Link><Link href="/manage">Manage</Link><Link href="/sign-in">Sign in</Link></nav></header>{children}<footer className="footer"><strong>Campus Learning</strong><span>Independent learning, responsibly shared. Original explanations, not work completed for submission.</span><span>Local-first engineering release · No real payments</span></footer></body></html>;
}
