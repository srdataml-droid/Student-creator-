import {ContentRuleError} from './content.mjs';

// Inputs are trusted server-loaded records, never client-supplied identities.
// Archiving retains purchase and moderation evidence; it is not physical deletion.
export function prepareCreatorVisibility({actor,item,action}={}){
  if(!actor?.verifiedAt || actor.suspended || !actor.id || actor.id!==item?.creatorId)
    throw new ContentRuleError('FORBIDDEN','Active verified owner required');
  if(action==='unpublish' && item.status==='published')
    return Object.freeze({expectedStatus:'published',nextStatus:'draft',revokePlayback:true});
  if(action==='archive' && ['draft','rejected','published'].includes(item.status))
    return Object.freeze({expectedStatus:item.status,nextStatus:'archived',revokePlayback:true});
  throw new ContentRuleError('INVALID_STATE','Content transition unavailable');
}

// The persistence adapter must compare expectedStatus and owner atomically,
// invalidate playback grants, and preserve financial records.
