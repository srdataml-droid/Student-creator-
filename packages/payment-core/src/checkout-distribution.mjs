/** Server deployment policy, not a client-supplied store/platform claim.
 * Independent web checkout only. A Play build needs a reviewed billing path or
 * consumption-only UI; this gate does not by itself establish store compliance.
 */
export function canInitializePaystackCheckout({environment,channel,nodeEnv}={}){
 if(!['test','live'].includes(environment))return false;
 if(channel==='independent_web')return true;
 if(channel===undefined&&environment==='test'&&nodeEnv!=='production')return true;
 return false;
}
