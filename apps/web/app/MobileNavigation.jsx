'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';

const items=[
  {href:'/',icon:'⌂',label:'Home'},
  {href:'/search',icon:'⌕',label:'Explore'},
  {href:'/studio',icon:'＋',label:'Create',className:'mobile-create-tab'},
  {href:'/messages',icon:'◌',label:'Chats'},
  {href:'/purchases',icon:'▣',label:'My access'},
];

export default function MobileNavigation(){
  const pathname=usePathname();
  return <nav className="mobile-creator-tabs" aria-label="Mobile navigation">
    {items.map(({href,icon,label,className})=>{
      const exact=pathname===href;
      const inSection=href!=='/'&&pathname?.startsWith(href+'/');
      return <Link key={href} href={href} className={className} aria-current={exact?'page':inSection?'location':undefined}>
        <span aria-hidden="true">{icon}</span><small>{label}</small>
      </Link>;
    })}
  </nav>;
}
