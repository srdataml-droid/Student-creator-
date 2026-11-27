import Link from 'next/link';
import {checkoutSettings} from '../lib/checkout-ui-settings.mjs';
import PublicFeedLayout,{PlatformIntro} from './PublicFeedLayout.jsx';
import {HostedFeedBoundary} from './HostedSocialWorkspace.jsx';
import {getHostedDiscovery} from '../lib/hosted-discovery.mjs';
export default async function HostedDiscovery({params={},search=false}){
 const filters={q:params.q??'',courseId:params.courseId??'',page:params.page??'1'};
 const checkout=checkoutSettings();
 const path=search?'/search':'/';let data,error='';
 try{data=await getHostedDiscovery({filters});}catch(e){error=e.message==='INVALID_DISCOVERY_FILTER'?'Enter a valid search.':'The content catalog could not be reached. You can still browse this page.';}
 const q=typeof filters.q==='string'?filters.q.slice(0,80):'',courseId=typeof filters.courseId==='string'?filters.courseId:'';
 return <HostedFeedBoundary query={q} checkoutMode={checkout.mode} terms={checkout.terms}><section className="feed-area hosted-discovery" aria-labelledby="hosted-discovery-title">
 <nav className="feed-tabs public-feed-tabs" aria-label="Discover content"><Link aria-current="page" href="/">For you</Link><Link href="/sign-in">Your campus</Link><Link href="/sign-in">Following</Link><Link href="/shorts">Shorts</Link><Link href="/communities?tab=night">Live</Link></nav>
 <div className="reference-feed-heading"><h2 id="hosted-discovery-title">{q?'Search results':'Recommended for you'}</h2>{q&&<p className="hint">Results for “{q}”</p>}</div>
 {error?<>{!q&&!search&&<PlatformIntro/>}<p className="hint" role="status">{error}</p><Link className="quiet-button" href={path}>Retry discovery</Link></>:<PublicFeedLayout key={q+':'+courseId+':'+data.page} initial={data} query={q} courseId={courseId} showIntro={!q&&!search} checkoutMode={checkout.mode} terms={checkout.terms}/>}
 </section></HostedFeedBoundary>;
}
