import {cookies} from 'next/headers';
import {getLocalStore,SESSION_COOKIE} from '../../../packages/local-core/src/store.mjs';
export const isLocalMode=()=>!process.env.APP_DATA_MODE||process.env.APP_DATA_MODE==='local';
export function getLocalPublicCourses(){return getLocalStore().listCourses();}
export function getLocalCourse(id){return getLocalStore().getCourse(id);}
export function getLocalTopics(id){return getLocalStore().listTopics(id);}
export function getLocalCourseLessons(id,topicId=null){return getLocalStore().publicLessons(id,topicId);}
export async function getLocalViewablePublishedLesson(id){
  const store=getLocalStore();
  const token=(await cookies()).get(SESSION_COOKIE)?.value;
  return store.viewableLesson(store.getSession(token),id);
}

/** Preview fields only: never serialize protected lessonText to a paywall. */
export function getLocalPublishedPricePreview(id){
 const lesson=getLocalStore().publicLesson(id);
 return lesson?{id:lesson.id,title:lesson.title,priceKobo:lesson.priceKobo??0}:null;
}

export function getLocalPublicCreator(id){return getLocalStore().publicCreator(id);}

export function getLocalPublicInstitutions(){return getLocalStore().listInstitutions();}
export function searchLocalPublishedLessons(filters){return getLocalStore().searchLessons(filters);}
