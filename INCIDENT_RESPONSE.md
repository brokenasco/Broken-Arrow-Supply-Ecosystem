# Incident response

1. Use Emergency stop. If the UI cannot reach the server, stop the local process to prevent new activity.
2. Preserve the database and audit records. Do not delete tasks or rewrite approvals to hide the event.
3. Determine affected company, actor, session, action and time. Review the audit log and process logs.
4. Revoke affected sessions and future provider credentials through controlled administration; rotate secrets at their source. If Shopify is configured, revoke its app credentials at Shopify as well as disconnecting locally.
5. Reconcile external state before retrying any uncertain operation in future integrations. Never infer success from a timeout.
6. Correct the issue, test the boundary, restore from a verified backup if necessary, and document outcome and lessons.
7. CEO explicitly resumes the company after review; retain agent/department pauses where appropriate.

Hosted incident notification, privacy response procedures, automated alerts and administrator recovery tools are production gates, not implemented features.
