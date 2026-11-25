import Link from 'next/link';
export default function HostedDiscovery({posts=[],available=true,heading='Discover student work',page=1,hasNext=false,filters={}}){
 const href=n=>{const p=new URLSearchParams(Object.entries(filters).filter(([,v])=>v));if(n!==1)p.set('page',String(n));return '/'+(p.size?'?'+p.toString():'');};
 return <section className="feed-area" aria-label={heading}>
  <div className="reference-feed-heading"><h2>{heading}</h2></div>
  {!available?<div className="feed-empty" role="status"><h3>Discovery temporarily unavailable</h3><p>We could not load the published catalog.</p><Link className="secondary-link" href="/" prefetch={false}>Try again</Link></div>:posts.length===0?<div className="feed-empty"><h3>{filters.q||filters.campus?'No matching previews':page>1?'No previews on this page':'No published posts yet'}</h3><p>{filters.q||filters.campus?'Try different filters.':page>1?'Return to an earlier page.':'Published student work will appear here once creators have been approved.'}</p><Link className="secondary-link" href="/communities">Explore courses</Link></div>:<div className="post-stack">{posts.map(post=><article className="creator-post discovery-card" key={post.id}>
   <Link className="discovery-media note-preview" href={'/lessons/'+post.id} prefetch={false} aria-label={'View preview: '+post.title}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg><span className="discovery-media-type">Preview</span></Link>
   <div className="discovery-copy"><h3><Link href={'/lessons/'+post.id} prefetch={false}>{post.title}</Link></h3><div className="discovery-byline"><span>{post.institutionName} · {post.courseCode}</span></div><p className="discovery-excerpt">{post.previewText||post.description}</p></div>
  </article>)}</div>}
   {available&&<nav className="hosted-pagination" aria-label="Discovery pages">{page>1&&<Link href={href(page-1)}>Previous</Link>}<span>Page {page}</span>{hasNext&&<Link href={href(page+1)}>Next</Link>}</nav>}
 </section>;
}
