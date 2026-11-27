'use client';
import Link from 'next/link';
import {CreatorActions} from './MediaActions.jsx';
export function WatchMetadata({title,href,byline,creatorHref,children,official=false}){
 const name=byline?.split(' · ')[0]||'Student creator';
 return <div className="watch-card-info"><span className="watch-avatar" aria-hidden="true">{official?'W':name.charAt(0).toUpperCase()}</span><div className="watch-card-copy"><h3>{href?<Link href={href}>{title}</Link>:title}</h3><p>{creatorHref?<><Link href={creatorHref}>{name}</Link>{byline.slice(name.length)}</>:byline}</p>{children}</div></div>;
}
export function WatchCard({post,children,checkoutMode,terms}){
 const href='/lessons/'+post.id;
 const byline=[post.displayName||post.handle||post.institutionName||'Student creator',post.displayName||post.handle?post.institutionName:null,post.courseCode].filter(Boolean).join(' · ');
 return <article className="watch-card"><Link href={href} className="watch-poster watch-title-poster" aria-label={'Watch '+post.title}><span className="watch-poster-context">{post.courseCode||'Student Creators'}</span><span className="watch-poster-title" aria-hidden="true">{post.title}</span><span className="watch-poster-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="m8 5 12 7-12 7z"/></svg></span></Link><WatchMetadata title={post.title} href={href} byline={byline} creatorHref={post.creatorId?'/creators/'+post.creatorId:undefined}><div className="watch-card-actions"><CreatorActions post={post} checkoutMode={checkoutMode} terms={terms}/>{children}</div></WatchMetadata></article>;
}
