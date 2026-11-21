# Security and disclosure

This is an engineering baseline, not a deployed public service. Do not post live payment credentials, student IDs or vulnerability proof-of-concepts in public issues. Once the private GitHub repository exists, notify its maintainers privately through GitHub's supported security reporting mechanisms. Security-sensitive changes must be tested for cross-campus access, data leakage, payment duplication, missing ownership checks and logs containing PII. Never apply `db/migrations/0001_proposed_core.sql` to production without DB/RLS tests and an approved rollback.
