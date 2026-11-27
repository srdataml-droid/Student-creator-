import Link from 'next/link';
import {communityTab,publicCommunityPreview,isSessionId} from '../../lib/community-discovery.mjs';
import {NightClassPreview,MyCommunityList,CommunityRowIcon} from '../CommunityDiscovery.jsx';
import {CommunityNightDirectory} from '../HostedLearningWorkspace.jsx';
import {checkoutSettings} from '../../lib/checkout-ui-settings.mjs';
import {getLocalPublicCourses,getLocalPublicInstitutions,isLocalMode} from '../../lib/local-public.mjs';
import {getPublicCourses} from '../../lib/public-courses.mjs';

export const dynamic='force-dynamic';
export const metadata={title:'Communities | Student Creators'};
export default async function Communities({searchParams}){
 const params=(await searchParams)||{};
 const q=typeof params.q==='string'?params.q.trim().slice(0,80):'';
 const campus=typeof params.campus==='string'?params.campus.slice(0,128):'';
 const local=isLocalMode();
 const tab=communityTab(params.tab||((q||campus)?'public':'discover'));const session=isSessionId(params.session)?params.session:null;const checkout=checkoutSettings();
 let courses=[],schools=[],state='ready';
 try{
  if(local){courses=getLocalPublicCourses();schools=getLocalPublicInstitutions();}
  else{const catalog=await getPublicCourses();courses=catalog.courses;state=catalog.state==='ready'?'ready':'unavailable';}
 }catch{state='unavailable';}
 const names=new Map(schools.map(s=>[s.id,s.name]));
 const filtered=courses.filter(c=>(!campus||c.institutionId===campus)&&[c.code,c.title,names.get(c.institutionId)||''].join(' ').toLowerCase().includes(q.toLowerCase()));
 const featured=tab==='discover'?publicCommunityPreview(filtered):filtered;
 return <main id="main" className="main community-directory content-community" data-community-tab={tab}>
  <h1>{tab==='night'?'Night classes':'Community'}</h1>
  <nav className="community-switch" aria-label="Community sections">{[['discover','Discover'],['mine','My communities'],['night','Night classes'],['assignments','Assignments']].map(([key,label])=><Link key={key} href={'/communities?tab='+key} aria-current={tab===key||(key==='discover'&&tab==='public')?'page':undefined}>{label}</Link>)}</nav>
  {(tab==='discover'||tab==='public')&&<section className="community-section" aria-labelledby="public-communities">
   <div className="community-section-heading"><h2 id="public-communities">Public communities</h2>{tab==='discover'?<Link href="/communities?tab=public">View all ›</Link>:<Link href="/communities">Back to discover</Link>}</div>
   {tab==='public'&&<form className="directory-filters form-stack" action="/communities" method="GET"><input type="hidden" name="tab" value="public"/><label htmlFor="community-query">Find a community</label><input id="community-query" name="q" type="search" placeholder="Search communities" maxLength={80} defaultValue={q}/>{schools.length>0&&<><label htmlFor="community-campus">Institution</label><select id="community-campus" name="campus" defaultValue={campus}><option value="">All institutions</option>{schools.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></>}<button className="primary-link" type="submit">Search</button></form>}
   {state==='unavailable'?<div className="community-empty" role="status"><p>Could not load communities.</p><Link href={'/communities?tab='+tab}>Try again</Link></div>:featured.length===0?<p className="hint">{q||campus?'No matching communities.':'No public course communities yet.'}</p>:<ul className="community-preview-list">{featured.map(c=><li key={c.id}><Link href={'/communities/'+c.id} className="community-preview-item" prefetch={false}><span className="community-preview-symbol" aria-hidden="true"><CommunityRowIcon/></span><span className="community-preview-copy"><strong>{c.title}</strong><small>{c.code}{names.has(c.institutionId)?' · '+names.get(c.institutionId):''}</small></span><span aria-hidden="true">›</span></Link>{local&&<Link className="community-study-link" href={'/study/'+c.id}>Study rounds</Link>}</li>)}</ul>}
  </section>}
  {tab==='discover'&&<section className="community-section" aria-labelledby="night-preview"><div className="community-section-heading"><h2 id="night-preview">Night classes</h2><Link href="/communities?tab=night">View all</Link></div><NightClassPreview/></section>}
  {tab==='discover'&&<section className="community-section"><div className="community-section-heading"><h2>Assignments</h2><Link href="/communities?tab=assignments">View all</Link></div><p className="hint">Assignment workspace is not enabled yet.</p></section>}
  {tab==='assignments'&&<section className="community-section assignments-unavailable" aria-labelledby="assignments-heading"><h2 id="assignments-heading">Assignments</h2><p className="hint">Your class assignments and deadlines</p><div className="assignments-empty" role="status"><svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h8l5 5v15H6zM14 2v6h5M9 12h7M9 16h7"/></svg><strong>No assignment service connected yet</strong></div><p className="hint">When available, assignments stay linked to the relevant class or community.</p><Link className="secondary-link assignments-browse" href="/communities">Browse communities</Link></section>}
  {tab==='mine'&&<section className="community-section" aria-labelledby="my-communities"><h2 id="my-communities">My communities</h2><MyCommunityList/></section>}
  {tab==='night'&&<section className="community-section" aria-label="Night classes">{session&&<Link href="/communities?tab=night">All night classes</Link>}<CommunityNightDirectory session={session} checkoutMode={checkout.mode} terms={checkout.terms}/></section>}
 </main>;
}
