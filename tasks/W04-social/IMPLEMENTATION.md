# Week 4 — Social/discovery: first isolated increment

Founder assignment supersedes provisional week mapping for parallel branch development. The original work/week-04 is seven commits behind main and contains only a W08 earnings template; this isolated work/week-04-social-unread task branch starts from main 582c9597004302a9fd0945fcb8fea05041b25782. No main merge or hosted migration authorized by this work.

## Existing source reviewed
- local-core store/http; local-flow, community, search and creator-restrictions tests; existing inbox and thread pages. Existing local features include opt-in text messaging, recipient-only reporting, 30-message/hour rate limit, blocks, campus community access and post limits; no evidence of complete hosted integration.
- Gap: inbox lacked unread state. Original implementation uses recipient-scoped explicit POST acknowledgements of received message IDs, atomic validation, repeat-safe inserts, recipient-only counts, and no public read receipts. Existing messages start unread. GET is read-only.
- Upstream research: Mattermost https://github.com/mattermost/mattermost/blob/61db2a76fcb505339001cd68a381b4ec8068401e/server/channels/store/sqlstore/read_receipt_store.go and LICENSE.txt at same SHA. Server source is AGPL/commercial and has Go dependencies/metrics integration. Rejected for incorporation; no source, dependency, external script, network or telemetry imported/run. No claim of a complete upstream security review.

## Remaining gates
- Exact-head CI and local/browser verification pending. Only local SQLite implementation changed. Hosted Supabase Auth/RLS/private message persistence and notification system remain pending; coordinate Weeks 1/2/3/7 before adopting hosted contracts. No real accounts or release.
- Existing conversation history limit 100, inbox limit 50: pagination and backlog acknowledgment remain outstanding. No read-state disclosure to other students.
- Audit verified-student discovery/feed/search, creator view restrictions across all metadata surfaces, follows/likes/comments, community administrator roles, notification preferences and moderation. Do not claim complete social lifecycle.

## Second increment: conversation history
First unread commit 074f5f93301fdd8bf7468dca4734427319c456b6 had all five jobs succeed in Actions run 45498683602. This follow-up adds pair-scoped keyset history (created timestamp + ID tie-breaker, max 100, no cursor from another pair), older-message controls and merge-on-refresh. New tests verify ordered, disjoint history and cross-pair cursor rejection. Exact-head CI for this change pending. No inbox pagination or hosted integration yet.

## Third increment: discovery
History commit 8e80f597da47edb75e8efca059eb1dc8c69222b6: all five CI jobs succeeded in run 45499542049. New server feed ranks verified viewer's campus first, then followed creators and recency, with separate following feed. Applies creator eligibility and viewer-specific deny_view to feed, search, course/profile lesson listings and saved metadata. Preserves explicitly public anonymous previews; a blocked account cannot receive its blocked creator's previews while authenticated, but public preview anonymity is not a ban-evasion defense. Full media and lesson text remain gated. Uses existing local source; GitHub search for Mastodon feed ranking returned no usable upstream candidate; no imports. Tests for ranking, filtering and negative access added, new exact-head CI pending.

## Fourth increment: in-app notifications
Transactional events for messages, follows, likes, lesson comments and community replies; recipient-only list/acknowledgement, strict category preferences, no message text/identity data, no external delivery. Community notifications are membership-, campus- and visible-post-scoped at read time. Defaults on for in-app only; preference changes apply prospectively. No push/email. Original code: upstream Zulip search returned no suitable reference; no source imported. New tests cover privacy, preferences, replay and message delivery independence; exact-head CI pending.

## Fifth increment: course moderator permissions
Platform admin assigns/revokes a verified joined student's limited per-course moderation role; membership FK automatically revokes on leave. Moderators may hide another member's contribution with recorded reason but cannot access platform report queues, assign roles, change membership, or moderate across courses. Hidden parent/child content cannot be returned via old idempotency keys. UI role controls and negative tests added. Reviewed Discourse GPL-2.0 license and category moderator lockout test at 7c5f9696a4bce4ff48603192ca9d40fcd979dfa3; no source imported or executed. Exact-head CI pending.

## Sixth increment: lesson replies
Additive nullable parent reference preserves existing comment hashes. One-level replies must target a visible root in the same entitled lesson, retain independent creator view/comment checks and rate limits, and disappear when the root is removed. Existing community reply code served as internal reference; no external dependencies. Reply UI, recipient notification and restart/replay/hidden-parent tests added. Exact-head CI pending. Hosted comment schema remains unchanged pending integration.

## Seventh increment: creator discovery and interaction guards
Server-scoped creator search supports public alias, campus, course, topic and published content matching; home suggestions and search creator links; account-specific view-denied creators excluded, no private fields. Follow mutations rate-limited; bookmark/like writes require independent view authorization without granting paid access. Tests added. No new dependencies or imported code. Exact-head CI pending.

## Eighth increment: account reports
Private categorized reports against public creators or established message contacts, one open per pair and bounded reporting frequency. Platform-admin-only review queue and resolution, no automatic suspension; profile and conversation reporting UI. Tests cover anonymous, self, unrelated account, duplicate, cross-role and review denial. No imported code. Exact-head CI pending.

## Ninth increment: inbox and abuse boundary tests
Pair-scoped inbox pagination with an actor-owned peer cursor; rejects unrelated cursor IDs, invalid bounds and spoofed message sender fields. Blocks limited to established contacts/public creators, existing blocks idempotent. Verified-student membership rechecked inside community post write transaction, hidden child reporting denied. New tests exercise 30-message/hour throttling, blocked contacts, forged sender, inbox paging and hidden child reports. Exact-head CI pending.
