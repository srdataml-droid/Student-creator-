# Worthkind Expert and Open-Source Engineering Playbook
Research date: 23 November 2026
Primary project: srdataml-droid/Student-creator-
Reusable for Worthkind Flow, Hotel OS, SignalBridge, USSD Flow, ChurchScreen AI, Student Attendance, Anchor/Reader, and other Worthkind products.

STATUS: Research and architecture guidance only. This source library is drawn from public official articles, public LinkedIn/social posts, open-source repository READMEs/architecture descriptions, talks and podcasts. It is NOT a full security/code audit of the third-party repositories, an indication of expert endorsement, a test result for our app, or permission to copy code regardless of license.

## A. Functions every working product must cover

| Function | Main deliverable | First-pilot owner |
|---|---|---|
| Founder/product manager | Vision, outcomes, roadmap, decisions | Founder |
| User researcher | Real interviews, assumptions, price demand | Founder + volunteers |
| UX/product designer | Mobile flows, prototype, accessibility | AI-assisted designer + student tests |
| Engineering/architect | Component boundaries, architecture decisions | Founder + AI + reviewer |
| Frontend & mobile | Video feed, accounts, studio, creator profile | Next.js/TypeScript developers |
| Backend & database | Authentication, authorization, entitlements, transactions | Node/TypeScript + PostgreSQL |
| Media/real-time | Uploads, encoding, CDN, class video | Managed video/live vendors |
| Payments/finance engineer | Orders, webhook, ledger, settlement/refund | Backend + independent review |
| Security & privacy | ID documents, auth threats, moderation, copyright | Founder + trained reviewer |
| QA engineer | Unit, integration, browser and negative-case tests | Team + automation |
| SRE/DevOps | Logs, uptime, backups, restore, rollback, CI/CD | Founder + managed services |
| Data/AI specialist | Analytics, ranking, moderation evaluations | Simple rules first; AI later |
| Growth/creator operations | Student recruitment, creator activation, support | Volunteer/campus representatives |
| Legal/compliance | PSP terms, copyright, privacy, country policies | Appropriate outside specialist |

These are responsibilities, not 14 separate salaries.

## B. Practitioners, public work, and proposed applications

### Product management / research
Teresa Torres — Product Talk: https://www.producttalk.org/opportunity-solution-trees/ ; LinkedIn https://www.linkedin.com/in/teresatorres ; recorded Lenny interview https://www.youtube.com/watch?v=9RFaz9ZBXpk . Her published Opportunity Solution Tree maps desired outcome -> customer opportunities -> solution ideas -> assumption tests. She advises real story-based interviews before the tree. APPLICATION: start with two-sided student/creator interviews and separate proposed features from observed needs.

Marty Cagan — Silicon Valley Product Group: https://www.svpg.com/product-model-concepts/ ; articles https://www.svpg.com/articles/ ; LinkedIn https://www.linkedin.com/in/cagan . APPLICATION: feasibility, usability, desirability and business viability should be verified separately; shipping features is not the same as user success.

Shreyas Doshi — LNO priority framework: https://lno.dev/ ; recorded interview https://www.youtube.com/watch?v=YP_QghPLG-8 . APPLICATION: prioritize the purchase-access loop and real users over low-leverage feature lists.

Lenny Rachitsky — product/growth interviews and publicly posted practice: https://www.lennysnewsletter.com/p/start-here ; LinkedIn https://www.linkedin.com/in/lennyrachitsky . APPLICATION: structured cohort observations and repeatable customer research.

### UX & frontend
Julie Zhuo — design leadership, former Facebook VP Product Design: https://www.juliezhuo.com/ ; writing https://substack.com/@joulee . APPLICATION: creator-first flows, clear visual hierarchy and iterative critique, not aesthetic mockups without working journeys.

Nielsen Norman Group — primary usability research library: https://www.nngroup.com/articles/ . APPLICATION: test sign-up, upload, creator profile, paid preview and playback with real students.

Addy Osmani — former Chrome developer-experience leader, web performance: https://addyosmani.com/ ; GitHub https://github.com/addyosmani ; JavaScript patterns https://patterns.dev/about/ . APPLICATION: mobile-first, lightweight feed, data-usage controls, Web Vitals and responsive loading.

Kent C. Dodds — React Testing Library and testing philosophy: https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications ; source https://github.com/testing-library/react-testing-library ; LinkedIn https://www.linkedin.com/in/kentcdodds . APPLICATION: test behavior as the student experiences it, using integration and browser tests. Public post on proof-of-concept versus product: https://www.linkedin.com/posts/kentcdodds_its-easy-both-for-humans-and-agents-to-activity-7457775244360175616-D0rS .

### Architecture & data
Simon Brown — C4 and Structurizr: https://github.com/simonbrowndotje ; source https://github.com/structurizr/structurizr ; recorded talk https://www.youtube.com/watch?v=FqTL-_tLf6I ; public LinkedIn architecture-tool post https://www.linkedin.com/posts/simonbrownjersey_a-bunch-of-new-structurizr-community-tools-activity-7453001438718406656-As8g . APPLICATION: context, container and component diagrams as versioned engineering records before major changes.

Martin Kleppmann — Designing Data-Intensive Applications: https://martin.kleppmann.com/ ; recorded discussion https://www.youtube.com/watch?v=SVOrURyOu_U . APPLICATION: reason about transactions, concurrency, recovery and cross-service consistency.

### Payments and financial reliability
Brandur Leach — former Stripe API engineering: https://brandur.org/about ; implementation article https://brandur.org/idempotency-keys ; reference code https://github.com/brandur/rocket-rides-atomic ; LinkedIn https://www.linkedin.com/in/brandur1 . Actual documented demo: API requests carry idempotency keys, foreign payment calls cannot be rolled back with local DB transactions, responses are persisted for replay, and completer/enqueuer background processes recover interrupted work. APPLICATION: verified order -> atomic entitlement+ledger exactly once, retried webhook safe, reconcile after failure.

Paystack — local engineering and product practices: https://paystack.com/blog/category/engineering-design ; developer resources https://paystack.com/docs/payments/webhooks/ ; its 2026 dashboard rebuild https://paystack.com/blog/product-engineering/introducing-the-new-paystack-dashboard-rebuilt-for-the-first-time-in-10-years . The official case describes a small multidisciplinary team, reuse of established APIs and the team wishing they had introduced AI evaluations earlier. APPLICATION: preserve established modules, release small verified features, add evals early where AI is used.

### Video and live classes
Jon Dahl — Mux cofounder, HLS/transcoding writing: https://www.mux.com/team/jon-dahl ; article https://www.mux.com/blog/video-is-too-hard ; public LinkedIn https://www.linkedin.com/in/zencoder ; linked open-source player https://github.com/videojs/video.js . APPLICATION: managed encoding/CDN, low-data streaming, secure playback, buffering analytics, avoid custom video CDN.

David Zhao — LiveKit cofounder: https://console.dev/interviews/livekit-david-zhao/ ; server source https://github.com/livekit/livekit ; LinkedIn https://www.linkedin.com/in/davidzhao . APPLICATION: camera-optional classes require real-time/WebRTC admission, participant auth and reconnection; use managed service before self-hosting SFU.

### AI and recommendation systems
Eugene Yan — AI/recommendation engineering: https://eugeneyan.com/ ; curated industry projects https://github.com/eugeneyan/applied-ml ; LinkedIn https://www.linkedin.com/in/eugeneyan . Public research index includes Instagram, TikTok, Spotify, LinkedIn and YouTube recommendations. APPLICATION: start with school/interests/follows/recency, gather legitimate behavior data, then investigate embeddings and ranking.

Chip Huyen — ML systems design: https://github.com/chiphuyen/machine-learning-systems-design ; https://github.com/chiphuyen/dmls-book . APPLICATION: specify objective, data availability, human evaluation and model failures before selecting a model.

### Reliability, safety, business and growth
Charity Majors — Honeycomb CTO/cofounder, observability: https://www.honeycomb.io/author/charity ; public LinkedIn https://www.linkedin.com/in/charity-majors ; 2026 recorded AI engineering discussion https://www.youtube.com/watch?v=HC8T1OlgYi0 . APPLICATION: code-generation speed does not replace production observability, independent reviews or incident learning.

Liz Fong-Jones — site reliability/observability: https://lizthegrey.com/ ; Google's SRE recorded conversation and transcript https://sre.google/prodcast/transcripts/sre-prodcast-03-04/ . APPLICATION: logs/traces and error budgets for payment, video and identity journeys; restore testing and deployment monitoring.

Casey Winters — marketplace/growth experience: https://www.linkedin.com/in/caseywinters ; public marketplace post https://www.linkedin.com/posts/caseywinters_how-to-build-and-scale-winning-marketplaces-activity-7202000928126717952-nEsn . APPLICATION: recruit creators and viewers in small campus communities; repeat usage matters more than a one-off signup burst.

Alex Schultz — growth/retention commentary: https://uk.linkedin.com/in/alexorig . APPLICATION: cohort retention, activation and engagement, rather than vanity account counts.

Troy Hunt — security writer and creator of Have I Been Pwned: https://www.troyhunt.com/about/ ; https://haveibeenpwned.com/ . APPLICATION: secure student accounts, leakage prevention, account recovery and breach readiness.

Paystack Trust & Safety senior product role description: https://careers.paystack.com/jobs/8764318-senior-product-manager-trust-safety . This public job description explicitly separates productized fraud-prevention/limits/monitoring from risk and compliance case review, and requires clear explanations for false holds. APPLICATION: creator viewing/comment/DM restrictions plus appeal, payout holds with transparent reasons, fraud monitoring and moderation queues.

Nigeria official requirements: NDPC https://ndpc.gov.ng/ ; Copyright Act https://copyright.gov.ng/CopyrightAct/ ; copyright registration https://eregistration.copyright.gov.ng/ncc/about . APPLICATION: protect student ID information, retain originals only with lawful purpose, define copyright licenses, complaints and takedowns, secure student-created content.

## C. Open-source repository shortlist — inspected at public project/documentation level

| Reference | What the public source shows | What to learn |
|---|---|---|
| https://github.com/structurizr/structurizr | C4 models as code | Maintainable architecture diagrams |
| https://github.com/supabase/supabase | Postgres/Auth/Storage/Realtime composition | Access policies, schema and Auth separation |
| https://github.com/medusajs/medusa | Separate pricing, order, payment, module providers and workflows | Ecommerce module boundaries and lifecycle |
| https://github.com/brandur/rocket-rides-atomic | API, completer, enqueuer, reaper, simulated faults | Retry safety and recoverable transactions |
| https://github.com/stripe/stripe-node | SDK and idempotency-key/error handling examples | Payment client correctness; not local-PSP availability |
| https://github.com/tus/tusd | Resumable HTTP upload reference implementation | Network interruptions and upload continuation |
| https://github.com/videojs/video.js | Open-source HLS/DASH media player | Playback UI, accessibility and media formats |
| https://github.com/livekit/livekit | Go WebRTC SFU with SDKs and JWT auth | Secure rooms, realtime audio/video |
| https://github.com/PostHog/posthog | Event analytics, flags, experiments, replay and surveys | Activation, conversion, retention measurement |
| https://github.com/testing-library/react-testing-library | React component testing approach | Test student-visible behavior |
| https://github.com/microsoft/playwright | Browser E2E automation | Verifiable real-world journeys |
| https://github.com/OWASP/CheatSheetSeries | Security guidance and checklists | Authorization and application safety |
| https://github.com/eugeneyan/applied-ml | Production-ML research index | Gradual feed/recommender improvements |
| https://github.com/chiphuyen/machine-learning-systems-design | ML design questions and data pipeline notes | Data, evals and failure criteria |
| https://github.com/dubinc/dub.link | Links and conversion attribution | Referrals and attribution architecture |
| https://github.com/PaystackHQ/documentation | Official payment documentation repository | Provider-specific contracts and payment events |

CAUTION: Reviewing an open-source README or source organization is NOT equivalent to auditing implementation code, running its test suite, or verifying it is suitable or legally licensed for our own deployment. Check each actual license and version before reuse.

## D. Reusable Worthkind engineering procedure

1. Confirm actual need from users/operations. Identify desired measured result.
2. Find first-party expert/source and record the actual lesson and link.
3. Produce a small requirements and failure-flow specification.
4. Make C4 component/data-flow diagram and threat model.
5. Add unit/integration/negative tests BEFORE relying on generated code.
6. Implement with AI assistance in a focused change, preserve existing code.
7. Run dependency/type/build, API tests, browser tests and security checks.
8. Verify CI checks on the exact commit; get an independent financial/security review for high-stakes features.
9. Deploy to staging, test recovery/rollback, then release gradually.
10. Observe actual errors, costs, support tickets, retention and usage; adjust roadmap.

## E. Student Creators immediate application

Product: creator-first campus social feed, verified students as creators/viewers, creator-owned copyright and paid personal VIEWING ACCESS from NGN 200, independent viewing/comment/DM blocks, private paid media, safe payments, earnings, portfolios and later communities/classes/sponsor-funded qualified views.

Next release gates:
- Audit latest canonical main, feature branches, tests and deployments. Do not transplant legacy school-learning-platform source.
- Add backend negative access tests for blocked viewing, comment, messaging, private media URL and account/identity leakage.
- Build price snapshots, sandbox order, PSP verification, atomic entitlements and financial ledger; retry/duplicate/refund tests.
- Real-device video upload/playback and low-bandwidth measurements.
- Pilot with 5-10 people, only then expand toward 80-100 students if protections and operations pass.
- Monetized views need FUNDED campaigns, qualified human traffic and fraud safeguards; never invent creator revenue from view counter increments.

## F. Adaptations to other Worthkind projects

| App | Reference practices |
|---|---|
| Worthkind Flow / Hotel OS | Medusa orders/workflows + Brandur idempotency + Postgres isolation + Playwright booking and payment E2E |
| SignalBridge | Brandur transaction recovery + immutable money ledger + Paystack/Stripe failure cases + security review |
| USSD Flow | Robust mobile E2E/Android permissions, independent transfer state and failed-session recovery; Android-specific docs additionally required |
| ChurchScreen AI | Real-time audio engineering + AI model evals + operator-approved projection + incident/recovery |
| Student Attendance | Privacy, identity verification, bias/false-match metrics and appeals |
| Anchor/Reader | Durable scheduling/notification state + backup/restore + user-centered tests |
| Landlord/Tenant | Tenant isolation, financial ledger and reconciliation, verified documents and support |

## G. Public recordings — no copying/rehosting of copyrighted audio

- Teresa Torres: https://www.youtube.com/watch?v=9RFaz9ZBXpk (discovery and user interviews)
- Shreyas Doshi: https://www.youtube.com/watch?v=YP_QghPLG-8 (prioritization)
- Simon Brown: https://www.youtube.com/watch?v=FqTL-_tLf6I (C4 system architecture)
- Charity Majors, Aug 2026: https://www.youtube.com/watch?v=HC8T1OlgYi0 (AI and production engineering)
- Liz Fong-Jones: https://sre.google/prodcast/transcripts/sre-prodcast-03-04/ (production observability)
- Martin Kleppmann: https://www.youtube.com/watch?v=SVOrURyOu_U (data-intensive systems)
- Jon Dahl articles on streaming: https://www.mux.com/team/jon-dahl (video fundamentals)

Research completion criteria for this edition: selected verified public source links and a practical application for each critical function. Ongoing tasks: inspect relevant source submodules and selected talks in greater depth; attach issue-specific architecture/test decisions before adopting any implementation. No person named here has been contacted, offered a role or agreed to assist.
