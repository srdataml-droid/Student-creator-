# Role-by-Role Competencies and Learning Tracks
**Status:** Proposed assignments and study tasks; *no volunteer is assumed hired or authorized*.
**Baseline:** The previous docs/architecture/03 lists 18 functions. Those are responsibility areas, not 18 jobs or 18 AI agents. At most 1–2 features should be in flight during early development.

## Practical responsibilities and development learning goals
| Role/Function | First competency and source | Practice exercise | Evidence/acceptance | Est. active hours (AI + review) |
|---|---|---|---|---:|
| Founder / product lead | Opportunity Solution Tree; Teresa Torres https://www.producttalk.org/opportunity-solution-trees/ | Write one outcome tree grounded in interviews with actual creator/viewer | One priority and measurable outcome accepted | 3–5 |
| Product manager | Four product risks; Marty Cagan https://www.svpg.com/product-model-concepts/ | Write vertical-slice PRD and acceptance checks | User outcome and feasibility documented | 3–5 |
| User researcher | NN/g usability principles https://www.nngroup.com/articles/ | Run 3–6 opt-in research/task sessions | No invented interviews; findings+consent | 5–9 |
| Product/UX designer | Interaction/performance guidelines https://web.dev/learn/design | Prototype join -> studio -> preview -> view | Mobile tasks and error states tested | 8–14 |
| Engineering lead/architect | C4 https://c4model.com/ | Context, container and API ownership map from actual source | C4 plus 2 ADRs matched to repo | 5–9 |
| Frontend engineer | React/Next guidance https://nextjs.org/docs | Content preview, creator control, accessible errors | Browser tests, keyboard/Android pass | 8–14 |
| Backend engineer | Authorization and error contracts https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html | Write blocked-view and owner-only API tests | Fail-closed unauthenticated/blocked calls | 8–16 |
| Database engineer | PostgreSQL RLS https://www.postgresql.org/docs/current/ddl-rowsecurity.html | Build isolated test migration & cross-tenant cases | Data leak tests fail closed and pass | 8–16 |
| Media engineer | tus https://github.com/tus/tusd ; Mux video https://www.mux.com/blog/video-is-too-hard | Interrupt/retry uploads and secure streaming grant | Resumable test + invalid URL rejection | 9–18 |
| Finance/payments engineer | Brandur https://brandur.org/idempotency-keys | Model idempotent order, duplicate webhook and refund | Balanced journal, no duplicate grants | 12–24 |
| Security/privacy reviewer | OWASP & NDPC https://owasp.org/www-project-application-security-verification-standard/ ; https://ndpc.gov.ng/ | Threat model student ID, paid URL, admin/creator access | Role test matrix plus privacy checklist | 7–14 |
| QA/test engineer | Kent C. Dodds https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications ; Playwright https://playwright.dev/docs/intro | End-to-end creator/viewer/moderator journeys | Reproducible passing/failing evidence | 8–16 |
| SRE/DevOps | Google SRE https://sre.google/books/ | Build+restore+health+rollback drill | Test-run SHA, recovery report | 8–14 |
| Data/analytics & AI | Eugene Yan https://github.com/eugeneyan/applied-ml | Define event dictionary and simple ranking eval | Analytics with no private ID/media secrets | 5–10 |
| Trust/safety lead | Paystack trust, OWASP authorization | Explain report, copyright, block, dispute & appeal decisions | Reversible/audited decisions and support script | 5–10 |
| Creator success / community lead | Casey Winters marketplace perspective | Help 5 creators complete their first publication | Task observations, not just signups | 5–9 |
| Growth/referral lead | Product experiment methodology | Track creator invite -> verification -> meaningful activity | No rewards for raw fake signup; budget cap | 4–8 |
| Compliance/accounting adviser | Relevant Nigerian laws, PSP terms; licensed professional when needed | Review licensed access, refunds, ID retention, settlement eligibility | Written owner/provider/legal release gate | Variable; external |

**Important:** Learning hours are estimated focused practice, **not** additional software-feature completion hours; overlap intentionally with engineering work. New roles may be combined into a 3–5 person volunteer group with explicit agreement; specialist financial/security review still needs qualified oversight.

## Reusable leadership matrix (RACI)
| Decision/Work | Founder | AI assistant | Volunteer/student creator | Independent security/finance reviewer |
|---|---|---|---|---|
| Vision, fee, users, countries | A/R | C | C | C |
| Source analysis, architecture options | A | R (assist) | C | C |
| Content upload usability | A | R (assist) | R (test by consent) | I |
| Student ID handling | A | C | I (no raw ID access) | C |
| Checkout and ledger | A | R (code/tests assist) | I | C/R (audit) |
| Staging release approval | A | C | R (feedback only) | C |
| Financial compliance approval | A for business | I | I | R for professional review |
A = accountable, R = responsible, C = consulted, I = informed. AI cannot independently be the legal operator or sole release approver.

## Role learning loop
~~~mermaid
flowchart TD
 A["Read primary source"] --> B["Explain principles in own words"]
 B --> C["Select one relevant project defect/feature"]
 C --> D["Propose flow and failure modes"]
 D --> E["Implement small experiment with AI"]
 E --> F["Test and inspect output"]
 F --> G{"Can explain and reproduce result?"}
 G -->|No| B
 G -->|Yes| H["Apply to app; attach evidence and lesson to issue"]
 H --> I["Peer/founder review; mark learned vs implemented"]
~~~

## Skill installation manifest
This repo will include targeted reusable Agent Skills with compatible frontmatter under .agents/skills:
1. product-discovery
2. architecture-lead
3. secure-content-access
4. payments-ledger
5. media-upload
6. qa-release
7. team-leadership

Root AGENTS.md supplies always-on repo rules, while SKILL.md files are invoked only when relevant. This prevents large redundant instruction prompts for all tasks. Official skill layouts: https://docs.github.com/en/copilot/reference/customization-cheat-sheet and https://developers.openai.com/blog/skills-agents-sdk.

## Team and volunteer boundaries
- Student creator collaborator: provide opt-in practical video/upload/edit/view feedback; no assumption about her personal relationships, expertise, availability or willingness to join staff.
- Founder controls GitHub/PSP/hosting access. Give narrowly scoped collaborator roles only after agreement; never share owner MFA or service tokens.
- No fabricated progress, fake testimonials or dummy money.
- Every work item should declare role, expected hours, link to one learning source, deliverable and exact proof of completion.
