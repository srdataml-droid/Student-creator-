# Student 001 — physical Android acceptance checklist

STATUS: NOT EXECUTED. Founder/independent QA must check these items on a real phone only after a dedicated private staging environment, privacy approval and test-domain payment provider exist. Browser automation is NOT a substitute for this checklist.

Recording template: date/time; device/Android version; browser/build; screen orientation; selected Wi-Fi/LTE; test domain; anonymous case IDs; exact deployed commit SHA; Pass/Fail/Blocked; actual test duration; measured video usage; screenshots/video (no student ID, passwords, tokens or other person's data).

## Gate A: release prerequisites, no real student yet
- [ ] Dedicated Student Creators Supabase project in founder-approved organization, private Auth and separate private identity/media buckets, fully reviewed migrations 0001–0006 and RLS tested in its own environment
- [ ] Student email ownership verification and first-person invite code both checked server-side, no public registration
- [ ] Moderator account independent from founder Student 001, permissions and case-specific access independently reviewed
- [ ] Synthetic payment only with Paystack test mode; no live charges, automatic payouts or withdrawals
- [ ] Media quarantine/virus scan and access revocation tested; private storage object URLs cannot be shared to unauthorized accounts
- [ ] Encrypted independent backup restored to a separately authorized environment, documented rollback
- [ ] Legal/privacy/retention/delete/appeal policy approved, real identity evidence protected
- [ ] Independent QA and security reviewer authorize a single consenting founder account

## Gate B: first Android visit, not a desktop emulation
- [ ] Open invited staging URL using real mobile Chrome, plus a second Android browser if available
- [ ] Portrait viewport (approximately 360–430px): no side-scroll, clipped buttons, obscured bottom tabs or overlapping keyboard
- [ ] Landscape / tablet-width responsive layout; dark onboarding, white feed and dark video viewer remain consistent
- [ ] Login/password manager, student email ownership, invite code, rejection of wrong/expired invite and repeated registration
- [ ] Browser back/forward, reload, focus order, tap target size, contrast and visible errors; reduce motion if enabled
- [ ] Screen reader (Android TalkBack), keyboard / external keyboard if available, caption toggle and labels
- [ ] Clear loading, no-content, expired-session and permission errors without exposing another student or internal exceptions

## Gate C: end-to-end original creator journey
- [ ] Student 001 remains student role; moderator is an independent staff identity
- [ ] Upload original MP4 and English WebVTT, confirm copyright; reject unsupported/excessive files
- [ ] Draft and in-review media hidden from anonymous and other-account access
- [ ] Moderator independently approves; discovered content shows school relevance and public preview only
- [ ] Creator profile, follow, like, bookmark, comments, messaging permissions and course community work normally
- [ ] Test free and ₦200 paid video flows on synthetic viewer accounts, not a real paid charge
- [ ] Unpaid buyer cannot GET/HEAD/Range video, notes, comments or WebVTT; current entitled buyer can
- [ ] Creator view/comment/DM restrictions remain independent after payment
- [ ] Verify refunded/blocked/suspended/graduated viewer cannot obtain new video bytes even with earlier URL/cookie

## Gate D: real-device playback and low bandwidth
- [ ] Play H.264/AAC MP4 in Chrome; record actual play/seek/rewind/rotate/fullscreen success, not only a valid HTTP range
- [ ] Actual English captions match sound and timing; no separate unauthorized caption transcript URL
- [ ] Playhead not reset on five-minute grant renewal, video buffering or temporary disconnect; note exact second before/after
- [ ] Apply slow 3G/4G network limitation; document startup buffering, failed download behavior and retry
- [ ] Measure MiB consumed per minute for mobile data and Wi-Fi using device network controls
- [ ] Low-power mode, screen lock/unlock, browser background and foreground, interruption during playback
- [ ] Paused/resumed upload, lost connection and failed authorization do not create duplicate publications
- [ ] If unsupported codec, clearly display error; do not call this a passed playback acceptance
- [ ] Watermark displayed but do NOT claim to stop screen record, screenshot, external camera or authorized plaintext copying

## Gate E: safety, recovery and privacy
- [ ] School verification cannot be self-issued from a client claim or photo alone
- [ ] Expired institutional enrollment removes protected access but allows appeal submission
- [ ] Duplicate institutional digest across two user accounts is rejected; staff escalation via browser JSON is rejected
- [ ] Copyright notice and appeal visible only to correct users/staff; takedown prevents public playback
- [ ] Account/evidence deletion request receipt generated without immediately destroying financial or legally retained records
- [ ] Wrong token, untrusted Origin, cross-account account lookup and URL sharing denied
- [ ] Existing staff and platform finance remain separate; no live payment operations

## Required signoff
- Founder: real Student 001 informed consent (only after all gates above)
- Engineering coordinator: exact SHA and no unfinished regressions
- Security reviewer: Auth, RLS, authorization, media and roster evidence
- Payment engineer: provider test and ledger/entitlement review
- Independent QA: actual device screenshots, bug tracking, low-bandwidth metrics, accessibility
- Privacy/legal reviewer: signed evidence handling, retention and appeals
- Release result: NOT APPROVED until above reviewers record evidence. Only then may the founder decide whether to consider 100 students; 1,000 requires a later separate review.
