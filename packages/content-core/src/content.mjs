/**
 * Course-scoped lesson publication domain rules. All `actor`, course, and
 * asset data MUST be loaded by the server from trusted DB state.
 * Neither this module nor its return values confer a DB permission.
 */
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STATUSES = new Set(['draft','processing','in_review','rejected','published','taken_down','archived']);

export class ContentRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContentRuleError';
    this.code = code;
  }
}

const reject = (code, message) => { throw new ContentRuleError(code,message); };
function requireStudent(actor) {
  if (!actor || !uuid.test(actor.id) || !uuid.test(actor.institutionId) || !actor.verifiedAt || actor.suspended === true) {
    reject('NOT_VERIFIED', 'Verified, unsuspended campus membership is required');
  }
}
function requireOwner(actor, item) {
  requireStudent(actor);
  if (item?.creatorId !== actor.id) reject('FORBIDDEN', 'Only this content creator can perform the action');
}

/** Validate and normalize a metadata-only draft; assets/body stored separately. */
export function prepareLessonDraft({ actor, course, topic = null, input } = {}) {
  requireStudent(actor);
  if (!course || !uuid.test(course.id) || course.institutionId !== actor.institutionId || course.active === false) {
    reject('WRONG_COURSE', 'Selected course is unavailable to this student');
  }
  if (topic && (!uuid.test(topic.id) || topic.courseId !== course.id)) {
    reject('WRONG_TOPIC', 'Topic does not belong to the selected course');
  }
  if (!input || typeof input.title !== 'string' || typeof input.description !== 'string' || typeof input.previewText !== 'string') {
    reject('INVALID_CONTENT', 'Valid lesson metadata is required');
  }
  const title=input.title.trim();
  const description=input.description.trim();
  const previewText=input.previewText.trim();
  if (title.length < 3 || title.length > 160 || description.length > 2500 || previewText.length > 800) {
    reject('INVALID_CONTENT', 'Lesson title, summary or preview length is invalid');
  }
  if (input.rightsAttested !== true) reject('RIGHTS_REQUIRED', 'Creator must attest ownership or permission to publish');
  return Object.freeze({ creatorId:actor.id, institutionId:actor.institutionId, courseId:course.id, topicId:topic?.id ?? null, title, description, previewText, status:'draft', rightsAttested:true });
}

/** Transition DRAFT/REJECTED to review only if media scan/transcode is complete. */
export function prepareReviewSubmission({ actor, item, assets } = {}) {
  requireOwner(actor,item);
  if (!['draft','rejected'].includes(item.status)) reject('INVALID_STATE', 'Only draft or rejected lessons can be submitted for review');
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > 12 || !assets.every(x=>x && x.processingStatus==='ready' && x.scanVerdict==='clean' && typeof x.privateObjectKey==='string' && /^private\/[A-Za-z0-9/_\-.]+$/.test(x.privateObjectKey) && !x.privateObjectKey.includes('..') && x.contentId===item.id)) {
    reject('ASSET_NOT_READY', 'All assets must be scanned, private, ready and owned by this content item');
  }
  return Object.freeze({ nextStatus:'in_review' });
}

/** Moderation decisions are always a second-person action. */
export function prepareModerationDecision({ actor, item, decision, reason } = {}) {
  if (!actor || !uuid.test(actor.id) || !['moderator','admin'].includes(actor.role) || actor.suspended === true) {
    reject('FORBIDDEN', 'Only active moderators can review lessons');
  }
  if (!item || item.status!=='in_review') reject('INVALID_STATE', 'Only submitted lessons can be moderated');
  if (item.creatorId===actor.id) reject('CONFLICT_OF_INTEREST', 'A creator cannot approve their own content');
  if (!['approve','reject'].includes(decision) || typeof reason!=='string' || reason.trim().length<5 || reason.trim().length>1000) {
    reject('INVALID_DECISION', 'Moderation decision and documented reason are required');
  }
  return Object.freeze({ nextStatus:decision==='approve'?'published':'rejected', reason:reason.trim(), reviewerId:actor.id });
}

/** Only published public metadata may appear in the general discovery feed. */
export function isDiscoverable(item) {
  return Boolean(item && STATUSES.has(item.status) && item.status==='published');
}
