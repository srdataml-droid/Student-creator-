import Link from 'next/link';
import {HostedFeedBoundary} from './HostedSocialWorkspace.jsx';
import {getHostedDiscovery} from '../lib/hosted-discovery.mjs';
function pageHref(path,filters,page){
 const params=new URLSearchParams();
 if(filters.q)params.set('q',filters.q);
 if(filters.courseId)params.set('courseId',filters.courseId);
 if(page!==1)params.set('page',String(page));
 return path+(params.size?'?'+params.toString():'');
}
export default async function HostedDiscovery({params={},search=false}){
 const filters={q:params.q??'',courseId:params.courseId??'',page:params.page??'1'};
 const path=search?'/search':'/';
 let data,error='';
 try{data=await getHostedDiscovery({filters});}catch(e){error=e.message==='INVALID_DISCOVERY_FILTER'?'Enter 2–80 letters or numbers and use a valid page or course.':'Discovery is temporarily unavailable. Please try again.';}
 return <HostedFeedBoundary query={typeof filters.q==='string'?filters.q.slice(0,80):''}><section className="feed-area hosted-discovery" aria-labelledby="hosted-discovery-title">
 <div className="reference-feed-heading"><h2 id="hosted-discovery-title">{filters.q?'Search results':'Recommended for you'}</h2>{filters.q&&<p className="hint">Results for “{filters.q}”</p>}</div>
 <form className="form-stack hosted-search secondary-search-form" method="GET" action="/search"><label htmlFor="hosted-query">Search public previews</label><div className="hosted-search-row"><input id="hosted-query" name="q" type="search" defaultValue={typeof filters.q==='string'?filters.q:''} placeholder="Search titles and excerpts" maxLength={80} minLength={2}/><button className="primary-link" type="submit">Search</button></div>{typeof filters.courseId==='string'&&filters.courseId&&<input type="hidden" name="courseId" value={filters.courseId}/>}</form>
 {error?<div role="alert" className="feed-empty"><h3>Unable to show results</h3><p>{error}</p><Link href={path}>Reset and retry</Link></div>:<>
 {data.items.length?<ul className="lesson-list hosted-preview-list">{data.items.map(post=><li className="lesson" key={post.id}><p className="hint">{post.institutionName} · {post.courseCode}</p><h3><Link href={'/lessons/'+post.id}>{post.title}</Link></h3>{post.previewText&&<p>{post.previewText}</p>}<Link className="secondary-link" href={'/courses/'+post.courseId}>Explore {post.courseCode||'course'}</Link></li>)}</ul>:<div className="feed-empty"><h3>{filters.q?'No matching previews':'No published previews yet'}</h3><p>{filters.q?'Try a different search.':'New student content will appear here when published.'}</p>{filters.q&&<Link href={path}>Clear search</Link>}</div>}
 <nav className="hosted-pagination" aria-label="Discovery pages">{data.page>1&&<Link className="secondary-link" href={pageHref(path,filters,data.page-1)}>Previous</Link>}<span>Page {data.page}</span>{data.hasNext&&<Link className="secondary-link" href={pageHref(path,filters,data.page+1)}>Next</Link>}</nav>
 </>}
 </section></HostedFeedBoundary>;
}
