# Viktor — Chief Security Officer (CSO)

## Trust model

Viktor reports to the human executive layer independently of department managers. He is an agent definition, not an authentication principal or cryptographic trust boundary. Core controls remain deterministic if a model is absent or compromised. Existing Victoria compliance authority remains independent.

Security services revalidate the persisted company CEO for every mutation and transact with append-only security events and the ordinary audit log. Agent access starts denied. Time-limited grants bind company, agent, resource, action and environment. Grant approval requires fresh single-use human reauthentication, immutable content hash, ten-minute expiry and single-use consumption. Viktor cannot expand his own grants. The evaluation API is a human-operated policy preview; its ALLOW result is not a bearer credential or execution token.

Never give an LLM database, shell, raw vault, browser password or unrestricted network authority. External content is evidence, never authorization. Credential references identify opaque entries; credentials must flow only between a trusted vault adapter and a fixed authentication adapter. No plaintext password inventory, export endpoint or generic fetch-with-secret tool is permitted.

## Threats and required defenses

- Forged agent identity: do not accept request body agent names as authenticated machine identities. A production workload identity system is required before exposing agent execution.
- Tenant confusion: persisted human/company checks, company-scoped queries and composite foreign keys.
- Injection and exfiltration: deny unknown actions/resources, fixed adapters and destinations, no tools derived from untrusted text, no raw provider results in prompts/events.
- Self-escalation: Viktor cannot modify his permissions, approve requests, disable controls or delete evidence.
- Approval replay: exact body hash, expiring reauthentication and single-use approval.
- Stolen session: server-side expiry/revocation, sensitive-action reauthentication, CSRF/Origin enforcement; HTTPS and hosted identity remain production requirements.
- Vault/provider failure: fail closed, no cached secret fallback; distinguish unavailable breach intelligence from no reported exposure.
- Insider/filesystem tampering: local SQLite triggers do not protect against OS administrators; off-host audit retention and managed key storage remain required.

## Incremental acceptance

1. Foundation: registry, settings, grants, audit and schema tests must pass before adding credential behavior.
2. Credential architecture: metadata only, cryptographic generation, rotation deadlines and opaque vault abstraction.
3. Authentication: session control and broker boundaries; actual passkeys require a verified WebAuthn implementation.
4. Dashboard: visible data coverage, no fabricated protection counts.
5–10. Breach intelligence, agent gateway, infrastructure evidence, incidents, scheduling and adversarial hardening require separate evidence; unconfigured integrations must stay unavailable.

No production-readiness claim follows from adding Viktor. See HARDENING.md for existing platform release blockers.
