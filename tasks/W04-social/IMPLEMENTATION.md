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
