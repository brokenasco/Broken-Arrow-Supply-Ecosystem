# Customer Intelligence — Phase 8

Oliver, Николай, Jessica and Андрей now have a human-operated workspace for Voice of Customer, customer insights, versioned personas, recurring complaints and support drafts. No autonomous model or external support integration is activated.

## Evidence and privacy

Capture a redacted observation from a review, survey, complaint, support interaction or aggregate purchase pattern. Include provenance, authorized-use basis, observation time, review deadline and a normalized theme. Explicitly attest to redaction and authorized use. Simulation is the default and is stored on the evidence. Do not enter names, contact details, addresses, order identifiers or sensitive personal details.

The server rejects common email and long-number patterns. These checks do not detect all identifying information and are not proof of anonymization or legal compliance. Humans must minimize data before entry. There are no raw mailbox/helpdesk imports or arbitrary URL fetches.

Evidence begins UNVERIFIED. A CEO records a verification or dispute note. Dependent documents and support drafting require VERIFIED evidence with an unexpired review date. Verification is a human assertion, not independent fact checking. Evidence content is immutable; corrected evidence requires a new snapshot.

Withdraw from use is terminal and remains available while stopped. It hides the evidence body and dependent persona/insight and support-draft bodies from active state and blocks further use. It is NOT erasure: original content, metadata, review notes and audit history remain in SQLite/backups. No retention purge, subject-erasure workflow or hosted privacy compliance is claimed. Use only appropriately minimized observations in this local pilot.

## Personas and insights

Choose fresh verified evidence; simulation and real evidence cannot be mixed in one document. Record observed findings separately from inferred attributes, confidence and evidence gaps. Personas require summary, interests, purchasing behavior, preferred products, aesthetic preferences, price sensitivity, average order value, objections, motivations, recurring language, channel preferences and unmet needs. Mark each attribute observed, inferred or unknown in its text; unknown is appropriate where evidence is absent. The application does not infer demographic stereotypes or fabricate attributes.

Documents are immutable. Selecting Previous version creates the next version, retains lineage and requires fresh evidence. Only the latest version may be extended. Insight documents instead capture an evidence-based recommendation. They are available in authenticated company state and the customer workspace; automatic cross-agent consumption is not implemented.

## Complaint signals and support

Recurring complaint detection groups fresh verified COMPLAINT records from the last 30 days by exact normalized human-assigned theme. A group appears at three records. Simulation and real groups remain separate. Counts are observations, not unique people; duplicate reports across sources may overlap. There is no semantic clustering or representative-sample claim.

Support classification is human-entered, aided by a labeled keyword suggestion. Refund/billing categories or matching keywords require ESCALATE, as do selected safety/fraud/legal keywords. Keyword detection is incomplete and humans must escalate unusual cases. Only verified SUPPORT/COMPLAINT evidence can create a case. One case is allowed per evidence record.

Андрей stays DRAFT ONLY. Template responses are deterministic acknowledgements without an order lookup, refund or promised outcome. Human-written alternatives create new immutable drafts. Review binds the exact content hash and sets REVIEWED or REJECTED once; REVIEWED does not grant send authority. Closure records a human resolution note and changes only local status.

Analytics count usable local cases by category, open/closed status and open escalations, with simulation and real-evidence totals disclosed. No response-time, customer satisfaction, refund outcome or provider-synced metrics are invented.

## Boundaries and implementation

Migration 009 adds customer_evidence, customer_documents, customer_document_sources, support_cases and support_drafts. Routes under /api/customers/: capture, review-evidence, withdraw, document, support, draft, review-draft, close. Read state via authenticated /api/state.

Mutations validate the persisted CEO, scope all records to the company, enforce relevant employee/department stop controls and audit transactionally. No send, refund or order-lookup endpoint is added. No external credentials, customer messages, financial action or paid request is used.
