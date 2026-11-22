/** Immutable, replay-safe helpers for displaying account-scoped bookmark state. */
export function savedIdsFromLessons(lessons) {
  if (!Array.isArray(lessons)) return [];
  return [...new Set(lessons.map(item => item?.id).filter(id => typeof id === 'string' && id.length > 0))];
}
export function isLessonSaved(lessons, lessonId) {
  return savedIdsFromLessons(lessons).includes(lessonId);
}
export function afterBookmarkRequest(ids, lessonId, previouslySaved) {
  const current = savedIdsFromLessons(Array.isArray(ids) ? ids.map(id => ({id})) : []);
  return previouslySaved ? current.filter(id => id !== lessonId) : current.includes(lessonId) ? current : [...current, lessonId];
}
