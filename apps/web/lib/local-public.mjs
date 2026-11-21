import {getLocalStore} from '../../../packages/local-core/src/store.mjs';
export const isLocalMode=()=>!process.env.APP_DATA_MODE||process.env.APP_DATA_MODE==='local';
export function getLocalPublicCourses(){return getLocalStore().listCourses();}
export function getLocalCourse(id){return getLocalStore().getCourse(id);}
export function getLocalTopics(id){return getLocalStore().listTopics(id);}
export function getLocalCourseLessons(id,topicId=null){return getLocalStore().publicLessons(id,topicId);}
export function getLocalPublishedLesson(id){return getLocalStore().publicLesson(id);}

export function getLocalPublicCreator(id){return getLocalStore().publicCreator(id);}

export function getLocalPublicInstitutions(){return getLocalStore().listInstitutions();}
export function searchLocalPublishedLessons(filters){return getLocalStore().searchLessons(filters);}
