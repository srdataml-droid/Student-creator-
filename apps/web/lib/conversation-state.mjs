// Pure conversation identity boundary, independent of transport.
function belongs(m,peer,actor){
 return m&&typeof m.id==='string'&&typeof m.createdAt==='string'&&((m.senderId===actor&&m.recipientId===peer)||(m.senderId===peer&&m.recipientId===actor));
}
export function mergeConversationMessages(old,incoming,peer,actor){
 const unique=new Map();
 for(const m of [...old,...incoming])if(belongs(m,peer,actor))unique.set(m.id,m);
 return [...unique.values()].sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.id<b.id?-1:a.id>b.id?1:0);
}
export function pendingReadIds(messages,peer,actor,acknowledged){
 return [...new Set(messages.filter(m=>belongs(m,peer,actor)&&m.senderId===peer&&m.recipientId===actor&&!acknowledged.has(m.id)).map(m=>m.id))];
}
// A blocked send is not an authorization failure for previously permitted history.
export function isConversationAccessLost(e){
 return e?.status===401||(e?.status===403&&['VERIFICATION_REQUIRED','STUDENT_REQUIRED','STUDENT_NOT_ELIGIBLE','SESSION_NOT_ACTIVE','FORBIDDEN'].includes(e.message));
}
