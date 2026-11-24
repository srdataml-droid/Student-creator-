# Local email ownership and recovery checkpoint

This is an isolated synthetic transport contract, not production email delivery or hosted Auth.
- POST auth/email/verify/request (signed-in student, empty body), POST auth/email/verify/confirm (same account session, token).
- GET me/email-status reports the current student's ownership proof and delivery availability.
- POST auth/password/recover (email), POST auth/password/reset (token and new password).
- The HTTP handler accepts an explicitly injected synthetic emailDelivery adapter only outside production; normal web configuration does not send mail. No debug token endpoint. Tokens are random, hashed at rest, purpose-bound, single-use and expiring; password recovery requires an existing ownership proof and excludes administrator accounts.
- Recovery revokes sessions and their grants. Suspension and restore revoke outstanding challenges. The prior local membership verification workflow is unchanged; email ownership is not yet a mandatory membership gate. Do not enroll a real student based on these tests.
- Persistent local request limits use HMAC digests (8 per normalized email/purpose and 120 aggregate per rolling hour); a failed synthetic delivery invalidates its exact challenge. These limits are not a substitute for hosted edge abuse protection.
- Hosted Auth, real delivery, asynchronous abuse controls, email-change policy and independent review remain release gates. No provider account or paid service is configured.
