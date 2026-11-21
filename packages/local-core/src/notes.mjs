/** Public/free local lesson text export only. NOT for paid or unreviewed media. */
const publicOnly=()=>Object.assign(new Error('LESSON_NOT_FOUND'),{status:404});
const tidy=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
export function publicLessonNotesResponse(item){
  if(!item||item.status!=='published'||typeof item.lessonText!=='string'||!item.lessonText.trim())throw publicOnly();
  const id=String(item.id??'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||'study-notes';
  const title=tidy(item.title).slice(0,160);
  const description=tidy(item.description).slice(0,2500);
  const body=`${title}\n${'='.repeat(Math.min(title.length,80))}\n\n${description?description+'\n\n':''}${tidy(item.lessonText)}\n\n---\nFor studying and original understanding only; do not submit another person's work as your own.\n`;
  return new Response(body,{status:200,headers:{
    'content-type':'text/plain; charset=utf-8',
    'content-disposition':`attachment; filename="lesson-${id}.txt"`,
    'cache-control':'private, no-store',
    'x-content-type-options':'nosniff',
    'cross-origin-resource-policy':'same-origin',
  }});
}
