# Technology & UX — Phase 9

Дмитрий, Sarah and Wilhelm have an internal workflow for storefront health observations, mobile/accessibility reviews, UX Recommendation Reports and implementation validation. No autonomous workers or deployment tools are enabled.

## Health and performance sampling

Optionally configure UX_MONITOR_COMPANY_ID and UX_MONITOR_HOST on the server. The authenticated company CEO confirms that exact hostname before running a homepage check. The adapter makes one unauthenticated HTTPS GET / on port 443, without cookies or credentials, and does not follow redirects. IPv4 DNS results must all pass the public-address filter; the connection is pinned to a verified address with TLS hostname validation. IPv6-only hosts are unsupported. Requests are bounded to 20 seconds and 1 MiB; company checks have a one-minute cooldown. Failed/stopped checks do not become successful observations.

Results contain HTTP status, elapsed request time, bytes and limited title/language/viewport/image-alt markup signals. Non-2xx and redirect responses remain visible status observations, not claims of a healthy page. HTML is processed transiently and is not persisted. Regex signals can be wrong and are not DOM, screen-reader, WCAG or Core Web Vitals audits. HTTP timing includes server/network effects and is not a browser render metric. No periodic schedule is installed; live storefront acceptance remains pending.

## UX evidence and recommendations

Record a human or simulation observation with a page URL, actual device/browser/viewport, observation timestamp, review deadline, method, findings and limitations. URLs in manual observations are recorded only. Checks cover keyboard navigation, focus visibility, form labels, image alternatives, contrast, mobile overflow/navigation, touch targets and checkout journey. NOT_TESTED remains explicit. Human claims are not independently verified.

Recommendation reports contain problem, evidence, customer impact, proposed change, expected impact, measurement plan, priority, confidence, implementation plan and rollback plan. Reports reference fresh scoped observations and cannot mix simulation and real evidence. Content is immutable; use a parent report to create a revision.

Exact-content CEO approval expires after ten minutes. Assignment to Sarah consumes it once and starts an internal IN_PROGRESS work item. It does not edit a theme, execute a model or deploy code. Record the change reference, test evidence, rollback verification and outcome with fresh observations to finish as VALIDATED or REWORK. Validation is human-reported, not proof of deployment or causal improvement. REWORK requires a new revised plan and approval. Cancellation remains available while stopped.

Migration 010 adds observations, reports, evidence links, validation records and monitor run state. All human mutations are scoped, validated and transactionally audited. Production changes still require an independently implemented deployment gateway.
