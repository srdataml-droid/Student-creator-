/** Only the preview contract crosses the Server Component -> browser boundary. */
export function toFeedPreview(lesson,course,institutionName){
  return {
    id:lesson.id,
    creatorId:lesson.creatorId,
    courseId:lesson.courseId,
    topicId:lesson.topicId??null,
    title:lesson.title,
    description:lesson.description,
    previewText:lesson.previewText,
    publishedAt:lesson.publishedAt,
    hasVideo:Boolean(lesson.hasVideo),
    courseCode:course.code,
    courseTitle:course.title,
    institutionName,
  };
}
