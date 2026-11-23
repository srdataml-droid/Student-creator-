# Student Creators — Domain, Data, API, Safety and Money Contracts
**Version:** Proposed engineering contracts v0.1 · 23 November 2026 · main branch only.
**Status:** Architecture and test criteria. All endpoint names/schema candidates below are PROPOSALS, not verified existing API routes/migrations. Read actual source and compare with 0001 and later migrations before implementation. No production migrations, PSP charges, or identity data touched.

## 1. Entities & relationships (conceptual model)
~~~mermaid
erDiagram
  STUDENT_ACCOUNT ||--o| STUDENT_VERIFICATION : verifies
  INSTITUTION ||--o{ STUDENT_VERIFICATION : receives
  STUDENT_ACCOUNT ||--o| CREATOR_PROFILE : presents
  CREATOR_PROFILE ||--o{ CONTENT : owns
  CONTENT ||--o{ MEDIA_ASSET : stores
  CONTENT ||--o{ CONTENT_PRICE_VERSION : offers
  STUDENT_ACCOUNT ||--o{ ORDER : places
  ORDER ||--o{ ACCESS_ENTITLEMENT : funds
  CONTENT ||--o{ ACCESS_ENTITLEMENT : grants
  ORDER ||--o{ LEDGER_JOURNAL : allocates
  CREATOR_PROFILE ||--o{ CREATOR_RESTRICTION : issues
  STUDENT_ACCOUNT ||--o{ CREATOR_RESTRICTION : subject
  STUDENT_ACCOUNT ||--o{ COMMENT : authors
  CONTENT ||--o{ COMMENT : receives
  STUDENT_ACCOUNT ||--o{ REPORT : files
  CONTENT ||--o{ REPORT : concerns
  CREATOR_PROFILE ||--o{ PAYOUT_REQUEST : receives
  PAYOUT_REQUEST ||--o{ LEDGER_JOURNAL : records
  CONTENT ||--o{ ANALYTICS_EVENT : generates
~~~

**Privacy note:** private identity/student card evidence must be in separately protected storage and not automatically exposed by student account/creator profile joins. Model a privacy-minimizing verification digest carefully; use manual review, appeals and a retention schedule. Avoid biometrics by default.

## 2. Student identity state machine
~~~mermaid
stateDiagram-v2
  [*] --> Registered
  Registered --> VerificationPending: submit eligible ID evidence
  VerificationPending --> Verified: reviewer approved
  VerificationPending --> Rejected: reviewer declined with reason
  Rejected --> VerificationPending: appeal or correct evidence
  Verified --> Suspended: rule violation / review
  Suspended --> Verified: successful appeal or reinstatement
  Verified --> Graduated: per future policy
~~~
Verification is a gate for student-only capabilities, but public previews may be visible to visitors if founder policy allows. Current local application supports manual verification; production identity review and age policies are not yet final.

## 3. Content state machine
~~~mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Uploading
  Uploading --> Processing
  Processing --> Ready: valid media
  Processing --> Failed: invalid/unsafe/transcode failure
  Failed --> Uploading: new attempt
  Ready --> InReview: creator submits rights statement
  InReview --> Published: independent moderation approval
  InReview --> Rejected: needs correction
  Rejected --> Draft: edit and resubmit
  Published --> Unavailable: takedown, owner removal, expiration
  Unavailable --> InReview: authorized reinstatement
~~~
Copyright: creator retains original rights to their own works; viewer receives limited viewing ACCESS under a versioned license. A user cannot legally license work they do not own. Rights complaints and counter-notices must be supported.

## 4. Content playback policy (apply on each token issuance)
~~~mermaid
flowchart TD
  A["Request playback for content"] --> B{"Published, approved, permitted region?"}
  B -->|No| X["Deny safely"]
  B -->|Yes| C{"Platform account restriction?"}
  C -->|Yes| X
  C -->|No| D{"Creator-specific view block?"}
  D -->|Yes| Y["Deny; support paid-buyer review/refund"]
  D -->|No| E{"Free or paid?"}
  E -->|Free| F["Allow per visibility rules"]
  E -->|Paid| G{"Verified active entitlement?"}
  G -->|No| H["Offer price and checkout"]
  G -->|Yes| F
  F --> I["Short-lived protected playback grant"]
  I --> J["Managed media delivery"]
~~~
Existing apps/web/app/FeedExperience.jsx currently uses an HTML video source at /api/local/lessons/{id}/video. Do not expand this development-only approach into publicly accessible paid video. Enforce authorization in both server metadata and media authorization; do not rely on merely hiding the play button.

## 5. Role and object authorization matrix
| Actor | Discover public preview | Publish own work | Access protected media | Report/block | Verify students | Refund/payout admin |
|---|---|---|---|---|---|---|
| Visitor | If public | No | No (unless explicitly free/public) | Limited report | No | No |
| Verified student | Yes | Own work after review | Free eligible or purchased | Own reports/restrictions | No | No |
| Creator | Yes | Own work after review | Own eligible assets | Restrict others on own content | No | No |
| Suspended account | Policy-limited | No | Deny protected access | Appeal support | No | No |
| Moderator | Policy-scoped | No unilateral creator ownership | Audited case-specific only | Investigate and act | If separately authorized | No |
| Verification reviewer | Minimal necessary | No | No automatic privilege | Case only | Yes, audited | No |
| Finance operator | Only needed support info | No | No automatic privilege | Case only | No | Audited permitted |
| Platform owner | Scoped authorized operations | Must still comply with logs/approvals | Not an unrestricted content-access shortcut | Policy review | Via approved flow | Via approved controls |

Creator viewing, commenting and DM bans are **separate** booleans/relations. A ban applies to server operations, not only UI; re-registration controls may use private student verification with manual appeal, never naive campus IP blocking. A creator who blocks an existing paid buyer triggers separately defined licensed-access and refund/dispute handling.

## 6. Core API contract sketches (PROPOSED ONLY)
| Domain | Proposed HTTP contract | Preconditions | State effect |
|---|---|---|---|
| Identity | POST /api/verification/requests | signed-in; limits; consent | privately record pending request |
| Verification | POST /api/admin/verification/{id}/decision | reviewer role; independent audit | approved/rejected with reason |
| Creator content | POST /api/content/drafts | verified creator; rights attestation | draft owned by requester |
| Media | POST /api/media/upload-session | verified creator; limits | signed short-lived upload |
| Publishing | POST /api/content/{id}/submit | owner; media ready | review state only |
| Moderation | POST /api/moderation/{id}/decision | authorized separate reviewer | publish/reject; audit |
| Creator restrictions | PUT /api/creators/{id}/restrictions/{viewerId} | actor owns creator ID | scoped view/comment/DM restriction |
| Playback | POST /api/content/{id}/playback-grant | per-request rights/access check | short-lived token only |
| Pricing | PUT /api/content/{id}/price | content owner, allowed min NGN 200 | version new price terms |
| Checkout | POST /api/orders | buyer eligible; server price snapshot | pending immutable order |
| PSP webhook | POST /api/payments/webhook | validated signature + trusted lookup | verified atomic state transition |
| Creator dashboard | GET /api/creators/me/earnings | authenticated owner | audited ledger-derived view |
| Payout request | POST /api/payout-requests | cleared balance, KYC, terms | reserve, then provider attempt |
| Reports | POST /api/reports | eligible reporter | moderation case + audit |

Never implement routes by blindly creating duplicates: map these contracts to current API files first. Design idempotency, CSRF, method and request size/rate limits for every mutation.

## 7. Purchase and money invariants
1. **Price:** NGN 0 free, otherwise minimum NGN 200 (20,000 kobo); currency-specific minor units when global.
2. **Commission:** current payment-core quoteLessonPurchase has a *default 1,000 basis points* illustration in code; **not an approved business commission**. Final fee, fee bearer, refunds, tax and payout threshold must be founder-approved.
3. **Order snapshot:** immutable item, buyer, content, content-license terms version, amount minor units, currency, business fee rules, PSP environment and unique reference.
4. **Verification:** exact reference, amount, currency, buyer/order and provider status; signature alone does not mean settled. Paystack provider integration must be reviewed against current applicable webhook verification scheme; current code includes a legacy x-paystack-signature verifier.
5. **Atomic database transaction:** once provider status validated, record payment, exactly one entitlement, and balanced creator/platform ledger journal; duplicate/concurrent callbacks replay safely.
6. **Earnings:** estimated, pending, cleared, reserved, paid, refunded are separate states; balance never derived from raw views, likes or follower count.
7. **Payout:** licensed PSP + approved merchant/creator eligibility required; an initiation response is not final settlement. Reconcile via provider confirmation and safe retries.
8. **Refund/chargeback:** append compensating journal records and update entitlement according to versioned terms; never delete earlier financial evidence.

### Payment flow with failure recovery
~~~mermaid
flowchart TD
  A["Creator publishes approved paid content"] --> B["Buyer requests checkout"]
  B --> C["Server snapshots price, license, fees"]
  C --> D["Durable pending order and unique reference"]
  D --> E["PSP checkout"]
  E --> F{"PSP confirms server-side?"}
  F -->|No| G["Pending / failed / retry with same identity"]
  F -->|Yes| H["Atomic order + entitlement + balanced journal"]
  H --> I["Allow access by entitlement"]
  H --> J["Pending creator balance"]
  J --> K{"Settled and compliance-cleared?"}
  K -->|No| L["Hold / retry / risk review"]
  K -->|Yes| M["Available earnings"]
  M --> N["Eligible payout reservation"]
  N --> O["Provider transfer attempt"]
  O --> P{"Final result?"}
  P -->|Pending| Q["Reconcile / await webhook"]
  P -->|Failed| R["Release reservation once"]
  P -->|Success| S["Paid ledger record and receipt"]
~~~

## 8. Acceptance tests, with authority and failure cases
| Contract | Essential checks |
|---|---|
| Identity | self-service unverification prohibited; private ID never returned by public/feed endpoints; rate limits and appeal |
| Content | cannot publish unapproved or unsafe video; creator rights attestation auditable |
| Media | direct guessed URL fails for protected items; signed grants expire; upload interrupted/recoverable |
| Blocks | view blocks prevent new video grants; comment blocks prevent API comment writes; DM blocks prevent send; no cross-creator leakage |
| Transactions | price mismatch, duplicate webhook, concurrent callbacks, wrong environment, failed payment and replay do not unlock |
| Entitlements | buyer cannot share token or license across users; refund/expiration/restriction has defined effect |
| Ledger | journal always balances; refunds reverse via new entries; payout reservations cannot double spend |
| Student verification | shared campus IP alone does not ban legitimate users; verified duplicate review and appeal |
| Operations | full browser user journey, mobile bandwidth, backup restore and incident alert checks |

## 9. Security and privacy obligations for initial pilot
- RLS in hosted Postgres with service-role writes restricted to backend; negative cross-account and institution tests.
- Private student ID storage, least-privileged reviewers, consent and retention schedule; no raw ID data in logs or Git.
- Copyright report/takedown/appeal, student safety, moderation tools and a fair paid-viewer block/refund process.
- Secure uploads: size/type check plus safe processor quarantine; the current MP4 structure check is NOT a complete malware/security scan.
- Admin capabilities by role and audit log. Controlled security incident response, secrets management and backup restore.
- Native app store billing, global tax and creator payouts only after market-specific review.

## 10. Domain-specific engineering decisions still open
License duration, download permission, creator block/refund precedence, exact fee split, payout minimum/timing, verified student age/graduation policy, location and campus visibility, choice of protected streaming provider, partner payout eligibility and when to start subscriptions/classes.
