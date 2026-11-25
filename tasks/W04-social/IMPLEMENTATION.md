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

## Tenth increment: actual browser social acceptance
Extended existing isolated Chromium flow to exercise server-ranked following feed, lesson reply, DM delivery, unread acknowledgments, notification mark/preferences, contact block/unblock, account report, administrator role assignment, course moderator hide/leave/rejoin and creator preview restriction from actual UI. Synthetic accounts only; no new service credentials. Exact-head browser CI pending.

- Browser acceptance run 45502380159: 288 unit tests passed; web build and database contract passed. All new social browser interactions passed, but a final blocked-search assertion matched the query-echo heading via substring matching. Replaced it with exact heading/link assertions and an explicit zero-results assertion; rerun required.

## Eleventh increment: hosted PostgreSQL messaging contract
Exact local/browser head 50b087d1f7828811d685362c3ed2487b98225e41 verified all five jobs in run 45502667753, including social browser acceptance. Additive SQL in this workstream folder avoids choosing a shared migration sequence ahead of other agents. RLS owner/pair reads, authenticated invoker RPC backed by a private function with auth.uid and current affiliation checks, opt-in, contact blocks, creator deny_message, recipient-only read acknowledgments and 30/hour serialized sender quota. No service keys used. Disposable PostgreSQL test added to CI. Reviewed Supabase RLS/securing API docs; Zulip Apache-2.0 candidate search returned Django migration fragments only, not an appropriate drop-in, no code imported. The SQL is not yet applied to staging or wired to the Next.js hosted UI. No claim of actual Supabase Auth or delivery verification.

## Twelfth increment: hosted PostgreSQL communities
Course/student composite institution foreign keys, joined-member RLS, private member lists, platform-admin-only role management, course moderator hide with audit, role revocation on leave, single-level replies, replay safety and 15/hour quota. Report intake persists independently; review queue still requires integration. Private helper functions use authenticated actor, fixed search path, explicit grants, no direct client mutation. Existing local implementation and previously reviewed Discourse reference inform the contract; no external code copied. SQL tests cover nonmember/cross-campus leakage, role escalation and hidden replies. CI pending; not deployed or wired to hosted UI.

## Thirteenth increment: hosted discovery/follows
Current-student-only discovery RPC ranks campus, follow state and recency, returns allowlisted metadata and public aliases, validates cross-campus filters and uses literal substring search. Own follow graph RLS, mutation RPC and quota. Authenticated raw catalog policy now excludes creator view-denied previews; existing anonymous preview policy remains and is not an evasion defense. Paid listing metadata remains distinct from entitlement. No hosted deployment. Disposable SQL regression added; exact-head CI pending. Existing local discovery source reused conceptually, no external code copied.

## Fourteenth increment: hosted lesson replies
Additive parent FK, one-level replies, owner removal and report submission via verified student RPC. Paid entitlement and independent comment restriction are checked before writes. Hidden root also hides its replies; raw request keys/hashes removed from authenticated comment SELECT grants. Rate quota and idempotent creation retained. Tests use existing rollback-only synthetic paid fixtures; exact-head CI pending. No external code copied; this adapts existing local/hosted contracts.

## Fifteenth increment: hosted in-app notification persistence
Transaction-local notification triggers on new messages, follows, likes, lesson comments/replies and community replies. Preference changes affect subsequent events only. Recipient RLS hides actor/internal event IDs; community/comment events recheck visibility and eligibility. No external push, email or service-key dependency. Rollback-only regression covers event deduplication, foreign read-state denial and notification opt-out without blocking DM delivery. Exact-head CI pending. No external code copied.

## Sixteenth increment: hosted abuse intake and review
Account and recipient-only message reports, duplicate and hourly quota checks, admin-only queues for message/account/comment/community cases and audited resolution. Reported messages only are included in staff queue, never arbitrary private inbox access; reviews do not auto-suspend. Existing platform staff role is the Week 7 coordination boundary; no separate identity or punishment system. Tests added for unauthorized reports/review, private evidence and no automatic sanctions. Exact-head CI pending. No external code copied.

## Seventeenth increment: hosted message paging
Read-only invoker RPCs for paged history and inbox, bounded result sizes, actor-owned keyset cursors, private unread counts from RLS-visible recipient acknowledgments, and own contact-block indicator. Tests reject cross-pair cursors and unrelated history reads. Existing local paging implementation supplied the reference; no external code copied. Exact-head CI pending; hosted runtime remains unwired.

## Eighteenth increment: hosted authenticated data adapter
Server-only factory reuses Week 1 verified bearer/session/eligibility boundary and sends only publishable key + user token to fixed Supabase Data API operations. Strict per-operation fields, bounded inputs/output, no arbitrary route or service role, sanitized errors. Feed, creator discovery/follows, inbox/thread, messages/read/block, communities, comments/replies, likes, notifications, account/message report paths. Tests are injected transport tests, not actual Supabase Auth. The Next.js hosted session route and live staging migration remain blocked on shared Week 1/2 session and review gates; staff adapter integration is separate. No external code copied.

## Nineteenth increment: hosted independent creator restriction writes
Verified owner-only restriction RPC, per-hour quota, independent view/comment/DM flags and paid-view review handoff for active purchased entitlements. Does not mutate order/entitlement/ledger or claim refund resolution. View block denies new authorization through the existing gate; old Mux tokens may remain valid until expiry, pending Week 3 media integration. Handoff table is service-only and requires Week 5 review workflow; concurrent new purchases and release behavior must be coordinated. Adapter includes own restriction list/write. Exact-head CI pending. No external code copied.

## Twentieth increment: hosted direct-session defense
Exact previous head d5071dac190c11bbc96f000d65fde15f1e35a976 passed all five CI jobs in 45530688649. Data API clients could otherwise bypass adapter session checks with a still-signed revoked access token. All social private mutation/read helpers now check session_id ownership and timebox against auth.sessions, and authenticated restrictive RLS guards direct table reads/writes. No raw auth rows exposed; no change to anonymous preview policy. Disposable CI Auth fixture only emulates session rows; real sign-out/refresh acceptance remains required with Week 1. See https://supabase.com/docs/guides/auth/sessions. Exact-head CI pending.

## Twenty-first increment: concrete hosted HTTP route
Added POST /api/social/[operation], explicitly gated by hosted staging approval, separate social enable flag, pinned project, disabled enrollment and live payments. Authenticates against actual Supabase Auth user endpoint, then calls current-subject social_session_state RPC for active session and student/admin role. Existing student adapter now also supports separately authorized admin role assignment/report queue/review; no service key or arbitrary provider route. Strict bearer-only auth, body cap, origin restriction and safe errors. No cookie/token-storage changes or browser integration without shared hosted sign-in. HTTP tests use injected transport; real route is wired but disabled and not deployed. Exact-head CI pending.

## Twenty-second increment: hosted like parity
Previous exact head 95758a53 passed all five jobs in run 45534377067. Found remaining direct like write grant could bypass hourly local quota. Replace it with current-session, current-student, view-aware and audited RPC; 60 new likes per hour including unlike/re-like, own unlike remains available. Adapter uses the RPC and adds own likes/follow status reads. Disposable SQL negative tests added. No live environment changes.
## Twenty-third increment: conversation UI privacy and delivery
Keyed conversation component remounts on peer change, aborts prior requests on unmount, filters results to exact pair, clears history on session/eligibility loss, serializes polling, and acknowledges inbound rendered history in bounded batches only while document is visible. Uses returned send result instead of a second GET; no implicit retry of send. Pure state tests added. Existing local UI remains operational; actual hosted browser sign-in not yet connected. Exact-head CI pending.
