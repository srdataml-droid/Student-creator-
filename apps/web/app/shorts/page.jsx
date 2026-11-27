import ShortsFeed from '../ShortsFeed.jsx';
import {getHostedDiscovery} from '../../lib/hosted-discovery.mjs';
import {checkoutSettings} from '../../lib/checkout-ui-settings.mjs';
export const metadata={title:'Shorts | Student Creators'};
export const dynamic='force-dynamic';
export default async function Shorts(){let items=[],hasNext=false,catalogAvailable=false;try{const result=await getHostedDiscovery({format:'short'});items=result.items;hasNext=result.hasNext;catalogAvailable=true;}catch{}const checkout=checkoutSettings();return <ShortsFeed initial={items} hasNext={hasNext} catalogAvailable={catalogAvailable} checkoutMode={checkout.mode} terms={checkout.terms}/>;}
