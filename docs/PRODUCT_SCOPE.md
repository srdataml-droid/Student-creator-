# Student Creators — owner-confirmed product scope

This is **not a course-management system or ad-funded YouTube clone**. It is a creator-first student social network with public and campus-scoped posts, video, creator subscriptions, direct conversations and a revenue-sharing marketplace.

## People and permissions
One verified student account can browse/watch, follow, create content and earn after separate payment onboarding. Viewing public posts does not require purchasing. Only verified creators may publish new content after moderation. Sensitive messages and campus-only communities require authenticated, authorized membership.

## Main screens and journeys
1. **For You / Following:** creator-driven stream of original short and long videos, written posts, academic projects, completed original assignment *examples*, notes, and interests.
2. **Creator profile:** public creator identity, own posts, follow/unfollow, DM (opt-in), offerings and insights (pending).
3. **Creator studio:** upload and tag original videos/notes/projects; attest rights; choose free/paid price; publish through review. Current local version has free content only; pricing is not yet implemented in UI.
4. **Community:** school/course/interest-based members, posts, replies, reports and moderation. A campus-private group must not be visible through public content routes.
5. **Private requests:** message a creator; permit explanation, tutoring and feedback, not commissioned work to submit dishonestly as one's own. Quotes/payments require a separate verified transaction.
6. **Commerce:** creator sets content price (owner's prior ₦200 minimum), optional subscription term and bank account through a licensed PSP. Buyer sees full checkout price; successful provider-verified payment grants one entitlement; creator/platform shares recorded and settled to verified destinations.
7. **Earnings:** creator dashboard displays reconciled gross/fees/net/pending/settled/refunded. Do not claim money merely from clicks or fake orders.

## Content rights
The student may share their own completed academic work only where they own the relevant rights and are permitted to redistribute it. Purchasing access does not automatically transfer copyright. Do not host leaked exams, copyrighted faculty material without permission or ghostwritten current assignments submitted as another student's own.

## Required production work
Dedicated Supabase Auth/Postgres/Storage, strict RLS, tested hosted video, PSP-approved settlement/subaccounts, payment verification, refunds, privacy policies, copyright handling, campus moderation, performance/accessibility/security tests, staging and user pilot. No real payments authorized before these gates.
