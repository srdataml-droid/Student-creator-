# Student Creators — product, entitlement and engineering process flows
**Date:** 2026-11-23 | **Status:** proposed system behavior; diagrams are not production test evidence.

## A. Founder/product lifecycle

```mermaid
flowchart TD
    A["Founder vision and scope"] --> B["Student creator and viewer interviews"]
    B --> C{"Demand and willingness to return?"}
    C -->|No| D["Refine proposition and test again"]
    D --> B
    C -->|Yes| E["Requirements and usable prototype"]
    E --> F["Architecture and testable acceptance criteria"]
    F --> G["Build secure student/creator foundation"]
    G --> H["Private video feed and social features"]
    H --> I["Paid access and financial safety tests"]
    I --> J["Closed alpha: 5–10 testers"]
    J --> K{"Core journeys work?"}
    K -->|No| L["Fix and retest"]
    L --> J
    K -->|Yes| M["Pilot toward 80–100 verified students"]
    M --> N{"Creators publish, viewers return, costs viable?"}
    N -->|No| O["Improve discovery, value, economics"]
    O --> M
    N -->|Yes| P["Country-aware expansion"]
    P --> Q["Continuous ops, fraud, reliability and new services"]
    Q -.-> E
```

## B. User journey: viewer and creator are the same account

```mermaid
flowchart TD
    A["Register -> choose institution/course"] --> B["Submit student ID privately"]
    B --> C{"Verification accepted?"}
    C -->|No| D["Pending / appeal / resubmit"]
    D --> B
    C -->|Yes| E["Creator-first For You / Following feed"]
    E --> F{"What would student like to do?"}
    F -->|Watch| G["Open content / creator profile"]
    G --> H{"Free or entitled?"}
    H -->|Yes| I["Play video, follow, save, comment"]
    H -->|No| J["Purchase limited viewing access"]
    J --> K["Verified payment and entitlement"]
    K --> I
    F -->|Create| L["Creator studio and rights attestation"]
    L --> M["Upload, price, moderate, publish"]
    M --> N["Audience, views and paid access"]
    N --> O["Creator insights and pending earnings"]
    O --> P["Available balance and eligible payout"]
    F -->|Connect| Q["Communities, DMs, classes, tutoring"]
    Q --> R["Interactions and permitted paid events"]
    I --> S["Portfolio and returning community"]
    P --> S
    R --> S
    S --> E
```

## C. Protected video playback and copyright

```mermaid
flowchart TD
    A["Request video"] --> B["Authenticate if required"]
    B --> C{"Student/account suspended?"}
    C -->|Yes| D["Deny + safe notice"]
    C -->|No| E{"Creator view-block applies?"}
    E -->|Yes| F["Deny; paid buyer policy/refund review"]
    E -->|No| G{"Content free?"}
    G -->|Yes| H["Issue short-lived playback token"]
    G -->|No| I{"Valid scoped entitlement?"}
    I -->|No| J["Preview and buy-access checkout"]
    I -->|Yes| H
    H --> K["Private stream/CDN delivery"]
    K --> L["Accurate, fraud-resistant watch analytics"]
```

Creator retains rights; platform hosts under limited permission, buyer acquires defined access. Moderators/creator block events invalidate future token grants; token TTL and cached permissions require explicitly tested revocation timing. Author-only content settings and institutional privacy must be enforced on the server as well as any PostgreSQL RLS policies.

## D. Purchase, commission, access and payout

```mermaid
flowchart TD
    A["Buyer confirms access terms and currency"] --> B["Create order with immutable price snapshot"]
    B --> C["Licensed PSP checkout"]
    C --> D{"Server-verified success?"}
    D -->|No| E["Pending / failed / cancel; never grant access"]
    D -->|Yes| F["Atomic, idempotent order + entitlement + ledger"]
    F --> G["Buyer unlocked for contract-defined term"]
    F --> H["Creator/platform commission allocation"]
    H --> I["Pending creator earnings"]
    I --> J["Provider settlement + risk + refund checks"]
    J --> K{"Cleared?"}
    K -->|No| L["Hold, investigate, or reverse per policy"]
    K -->|Yes| M["Available creator earnings"]
    M --> N["Withdrawal request and identity check"]
    N --> O{"Provider-approved and balance reserved?"}
    O -->|No| P["Pending/rejected with reason"]
    O -->|Yes| Q["Provider payout request"]
    Q --> R{"Provider confirmed outcome?"}
    R -->|Pending| Q
    R -->|Failure| S["Release reservation once"]
    R -->|Success| T["Finalize ledger + receipt + reconcile"]
```

## E. Sponsor-funded qualified-view rewards (future)

```mermaid
flowchart TD
    A["Free video viewed"] --> B["Collect minimal playback signals"]
    B --> C{"Meets human and engagement policy?"}
    C -->|No| D["Not monetizable; abuse review if needed"]
    C -->|Yes| E{"Verified sponsorship/ad fund?"}
    E -->|No| F["Analytics only, no cash promise"]
    E -->|Yes| G["Reconcile eligible campaign revenue"]
    G --> H["Allocate capped creator share"]
    H --> I["Pending earnings"]
    I --> J["Fraud and settlement check"]
    J --> K["Available earnings"]
```

## F. Creator restrictions and attempted ban evasion

```mermaid
flowchart TD
    A["Creator blocks viewer for VIEW/COMMENT/MESSAGE"] --> B["Persist scoped restriction and audit"]
    B --> C["Enforce per server request"]
    C --> D["Deny affected functionality and explain when safe"]
    D --> E["User requests appeal if permitted"]
    E --> F["Human/policy review; purchased-access obligations"]
    F --> G["Uphold or reverse, audit outcome"]
    B --> H["Suspicious repeat-registration check"]
    H --> I{"High-confidence lawful identity match?"}
    I -->|Yes| J["Review/deny per published terms"]
    I -->|No| K["Never ban solely on shared IP; monitor safely"]
```

## G. Delivery pipeline for every feature

```mermaid
flowchart LR
    A["Requirements + owner decisions"] --> B["UX + acceptance tests"]
    B --> C["Code in scoped branch"]
    C --> D["Unit/integration/security tests"]
    D --> E{"Pass?"}
    E -->|No| C
    E -->|Yes| F["PR and independent review"]
    F --> G["Merge + staging deploy"]
    G --> H["Real browser and PSP/media sandbox E2E"]
    H --> I{"Release gate passed?"}
    I -->|No| C
    I -->|Yes| J["Founder-approved controlled release"]
    J --> K["Monitor + support + report"]
    K -.-> A
```

## H. Logical architecture and dependencies

```mermaid
flowchart TD
    A["Responsive student web/PWA"] --> B["API/auth + account policy"]
    B --> C["Identity and verification"]
    B --> D["Creator/feed/social domain"]
    B --> E["Upload and access domain"]
    B --> F["Commerce and earnings domain"]
    B --> G["Messaging/communities/classes"]
    B --> H["Admin, trust and safety"]
    C --> DB[("Dedicated PostgreSQL/Supabase")]
    D --> DB
    E --> DB
    F --> DB
    G --> DB
    H --> DB
    E --> S["Managed video encoder + signed-stream CDN"]
    F --> P["Licensed payment/payout providers"]
    F --> L[("Auditable ledger")]
    B --> Q["Background jobs, monitoring and alerts"]
    Q --> AI["Optional captions, ranking and moderation assistance"]
```

**Architecture priority:** Modular monolith at 100 users; grow service boundaries based on actual traffic and operations. Use queues for asynchronous media/notifications and separate payment reconciliation processes. Distinguish implementation from planned third-party integrations.

## Release checklist

- Gate 0 source/CI and product contract audited.
- Gate 1 identity, profiles, video and feed browser-tested.
- Gate 2 private playback/creator restrictions/security tests.
- Gate 3 provider sandbox, idempotency, financial ledger, refunds/payout policies.
- Gate 4 closed student beta and low-data mobile performance.
- Gate 5 community/live class/rewards expansion.
- Gate 6 country-specific currency, KYC, tax, privacy and PSP corridor verification.

Refer to `CREATOR_FIRST_PRODUCT_BLUEPRINT_2026-11-23.md`, `CREATOR_COMMERCE_RIGHTS_AND_GLOBAL_STRATEGY_2026-11-23.md` and `PILOT_AND_ENGINEERING_RELEASE_PLAN_2026-11-23.md` for requirements and evidence boundaries.