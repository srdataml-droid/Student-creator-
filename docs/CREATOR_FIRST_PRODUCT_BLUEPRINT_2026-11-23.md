# Student Creators Platform — Creator-first product blueprint
**Date:** 2026-11-23 | **Status:** owner-confirmed direction + proposed implementation details | **Repository:** `srdataml-droid/Student-creator-`

## Product definition

Student Creators Platform is a student-only creator economy and social network for verified tertiary-institution students. A student can watch content, become a creator, share original videos, teach what they know, interact, build a community, earn money in supported local currencies and carry a portable public portfolio beyond university.

**This is not a learning management system, subject-card marketplace, or advertising-first YouTube clone.** Learning is one possible use of broad creator content; the primary experience is creating, discovering, interacting, earning and developing a reputation. Foundational questions: Can a verified student publish a valuable video, can another student watch or pay to access it, can the creator see accurate earnings, and will both return?

## Owner-confirmed principles

1. **Students, not subjects, are the core:** creator-first video/post feed, followers, reactions, comments, messaging, communities and classes. Videos can cover explanations, projects, experiences, original demonstrations, creative skills and student life; do not restrict the feed to mathematics/physics course cards.
2. **Campus identity:** register, select institution and course of study, submit student ID for appropriate verification. Verified student identity and public creator persona are separate. Campus information helps relevant discovery and communities, not arbitrary limits on lawful content discovery.
3. **Every viewer may also create:** one account, natural switch into publishing. A student may remain a viewer, become a creator, tutor or community host, or do all of these.
4. **Creators own their original work:** publishing grants the platform a limited hosting/display/delivery license; a buyer purchases **access**, not copyright, source files, redistribution rights or exclusive ownership. Actual copyright ownership can depend on contracts, school rules and third-party contributions.
5. **Pricing:** free access is ₦0; paid content is creator-priced from ₦200 in the Nigerian pilot. Define price, scope, duration and availability before checkout. Repricing must not silently take away an already-purchased entitlement.
6. **Creator controls:** restrict who can view, comment and message; block accounts; report harassment and copyright misuse. Apply restrictions through server-side access checks before issuing private playback credentials. Protect buyers with published rules, appeals and refunds where appropriate.
7. **No promise of perfect ban-evasion protection:** use verified student identity, abusive-account history, rate limits and review; never treat a shared IP as proof of identity. Provide appeals and privacy safeguards.
8. **Creator earnings:** transparent platform commission and applicable processing fees; accurate pending vs available funds; cash-out only when PSP settlement/KYC/approved payout setup allows. Proposed ₦5,000 minimum withdrawal and customizable withdrawal preferences are **unresolved**, not adopted policies.
9. **Classes and communities:** creators can host free/paid night classes, create communities, teach remotely, message students, schedule sessions and accept legitimate learning/help requests. Do not facilitate ghostwriting graded assignments for dishonest submission.
10. **Portfolios:** profiles showcase verified contributions, original work, skills, classes, projects and community activity. Private account identifiers and financial details never appear publicly.
11. **Global ambition, local launch:** begin with 80–100 students in a Nigerian pilot. Plan global discovery and country-aware pricing, currency, institution and payout policies; do not pretend a provider supports payouts everywhere.
12. **UI/UX:** familiar, modern, easy to navigate rather than decorated for its own sake; phone bottom navigation, tablet drawer/hamburger, desktop top horizontal navigation.

## Complete experiences

### Join
Visitor -> register -> select institution/course -> submit verification -> admin or approved verification process -> student account approved/pending/rejected -> interests and privacy -> personalized creator feed. All document uploads are private, access-controlled, logged and retention-limited.

### Watch and interact
For You/Following -> choose video -> authorize free or verify paid entitlement -> protected playback -> follow/like/comment/save/share -> discover creator portfolio -> direct message where allowed. Each playback request must enforce account and creator restrictions. Avoid autoplay that wastes mobile data.

### Create and monetize
Student -> creator studio -> original video/post upload -> confirm rights and content policy -> preview, metadata, price (₦0 or ₦200+) -> moderation status -> publish -> distribution -> audience, orders and insights -> pending/available earnings -> payout eligibility. Do not call a view an earning by itself.

### Commissioned help, classes and community
Discover creator -> DM/quote/schedule approved tutoring or guidance -> buyer accepts scope/price -> verified payment -> delivery/session -> feedback and dispute flow. Create/join communities; organize paid/free night classes with capacity, time-zone, attendance and cancellation handling. Preserve academic integrity.

### Portfolio
Profile -> public creator work, projects, clips, community contributions and verified accomplishments -> follower/social reputation -> shareable portfolio. Graduation access policy remains to be decided.

## Actors and authorization

- Viewer/verified student: view permitted content, buy access, follow and interact, publish after creator requirements are met.
- Creator: publishing, price and access policy, approved moderation actions on own posts, earnings reporting.
- Community moderator: scoped community operations only.
- Student verification operator: tightly scoped identity document access.
- Finance/support: transaction disputes, reconciliation and payout workflows with audit logging; no default access to private messages.
- Platform administrator: separately permissioned actions with audit trails; no unrestricted secret or private-document access.

## Pilot acceptance scenario

1. Two verified students are registered and isolated from each other's private records.
2. Creator uploads an owned video; approval and playback work on a modest Android network.
3. Creator makes another video paid with a price of ₦200; viewer sees a clear preview and checkout.
4. A **sandbox-verified** payment creates exactly one purchase entitlement and exactly one financial allocation, even after duplicate callbacks.
5. Entitled buyer can view, nonbuyer cannot access the video directly or through guessed URLs.
6. Creator blocks abusive viewer: applicable view/comment/message restrictions are enforced server-side. Paid-buyer refund/appeal policy is explicit and tested.
7. Creator sees accurate pending/available earnings labels; no fake withdrawal claims.
8. Reporting, appeals and admin audit events work without exposing student ID images.

## Current code status (as inspected 2026-11-23)

**Repository source, not a live deployment:** `main` contains creator-first feed, profiles, follows, saved posts, likes and moderated comments, plus local SQLite registration/verification, original MP4/text publishing, DMs, communities and a study scheduling foundation. Historic PRs #1, #2, #4, #5 are merged. Documentation reports CI/local tests, but this new blueprint does not claim a fresh end-to-end test. No production verified deployment or real payment/payout integration was observed in this inspection. Code from older `school-learning-platform` must not be copied over newer source indiscriminately.

## Open founder decisions (do not silently hardcode)

- Commission rate, processor-fee bearer, settlement model, creator bank verification and refund handling.
- Live payout threshold/cadence and eligibility, and what happens to balances after graduation.
- Content purchase access duration: lifetime while hosted vs timed access; whether creators can withdraw listings.
- Paid buyer vs creator block: circumstances for refund, appeal or continued limited access.
- Paid class cancellations, tutoring requests, scheduled delivery and no-shows.
- Under-18 student eligibility and guardian/age verification policy.
- Referral reward type, budget and anti-abuse criteria.
- First campus, testing cohort and student interview plan.
- Country-by-country availability and taxes, compliant cross-border payouts.

## Primary research references

- Paystack developer docs: https://paystack.com/docs/
- Cloudflare Stream: https://developers.cloudflare.com/stream/
- Supabase docs: https://supabase.com/docs/
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/

This document records the product contract and proposed behavior; it is not proof that the features are implemented.