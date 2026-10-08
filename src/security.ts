import type { DatabaseSync } from "node:sqlite";
import { CredentialService, credentials, sessions } from "./credentials.ts";
import { securitySettings, securityEvent } from "./security-foundation.ts";
import { ComplianceService } from "./compliance.ts";
import { id, now, transaction } from "./db.ts";
import { DomainError } from "./policy.ts";
import { choice, field } from "./workflow.ts";
export function securityOverview(db: DatabaseSync, company: string) {
  const inventory = credentials(db, company),
    settings = securitySettings(db, company);
  const rows = (table: string) =>
    db
      .prepare(
        `SELECT * FROM ${table} WHERE company_id=? ORDER BY created_at DESC LIMIT 100`,
      )
      .all(company);
  const incidents = rows("security_incidents"),
    alerts = rows("security_alerts");
  const risk = inventory.length
    ? Math.max(...inventory.map((c) => c.risk_score))
    : null;
  return {
    settings,
    credentials: inventory,
    sessions: sessions(db, company),
    events: rows("security_events"),
    incidents,
    alerts,
    breachChecks: rows("breach_checks"),
    vulnerabilities: rows("vulnerability_findings"),
    reports: rows("security_reports").map((r) => ({
      ...r,
      body: JSON.parse(String(r.body)),
    })),
    riskScore: risk,
    status: settings.lockdown
      ? "CRITICAL"
      : incidents.some(
            (i) =>
              i.status !== "CLOSED" &&
              ["HIGH", "CRITICAL"].includes(String(i.severity)),
          )
        ? "HIGH"
        : alerts.some((a) => a.status === "OPEN")
          ? "ELEVATED"
          : "NORMAL",
    coverage: {
      statusMeaning:
        "Recorded local evidence only; NORMAL is not proof of safety",
      vault: "NOT ACTIVATED",
      model: "NOT CONNECTED — deterministic controls remain active",
      mfa: "External-account metadata is human reported; local login has no MFA/passkey enforcement",
      breach:
        "Manual configured HIBP checks only; no continuous provider polling",
      websites: "NOT CONNECTED",
      email: "NOT CONNECTED",
      push: "NOT CONNECTED",
      geoDevices: "NOT COLLECTED",
      secretReuse: "UNKNOWN",
    },
    counts: {
      inventory: inventory.length,
      due: inventory.filter(
        (c) => c.days_remaining <= 0 && c.status !== "DISABLED",
      ).length,
      mfa: inventory.filter((c) =>
        ["APP_MFA", "SMS_MFA", "PASSKEY", "HARDWARE_KEY"].includes(
          c.auth_method,
        ),
      ).length,
      passkeys: inventory.filter((c) => c.auth_method === "PASSKEY").length,
    },
  };
}
export class SecurityService extends CredentialService {
  incident(input: Record<string, unknown>) {
    return this.change("SECURITY_INCIDENT_CREATED", "incident", () => {
      const evidence = this.db
        .prepare("SELECT id FROM security_events WHERE company_id=? AND id=?")
        .get(
          this.p.company_id,
          field(input.evidenceId, "Existing security evidence", 80),
        );
      if (!evidence)
        throw new DomainError("Company security evidence required", 404);
      const credentialId = input.credentialId
        ? String(this.record(input.credentialId).id)
        : null;
      const record = id();
      this.db
        .prepare(
          "INSERT INTO security_incidents VALUES(?,?,?,'DETECTED',?,?,?,?,'',?,?)",
        )
        .run(
          record,
          this.p.company_id,
          choice(
            input.severity,
            ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            "Severity",
          ),
          choice(
            input.category,
            [
              "AUTHENTICATION",
              "CREDENTIAL_EXPOSURE",
              "PERMISSION",
              "DATA_ACCESS",
              "VULNERABILITY",
            ],
            "Category",
          ),
          credentialId,
          evidence.id,
          choice(
            input.confidence,
            ["LOW", "MEDIUM", "HIGH", "CONFIRMED"],
            "Confidence",
          ),
          now(),
          now(),
        );
      this.alert(
        `incident:${record}`,
        "SECURITY_INCIDENT",
        String(input.severity),
        `Security incident ${record} requires review. Evidence and confidence are recorded.`,
      );
      return { id: record };
    });
  }
  transition(input: Record<string, unknown>) {
    return this.change("SECURITY_INCIDENT_UPDATED", String(input.id), () => {
      this.consumeReauth(input.reauthToken);
      const row = this.db
        .prepare("SELECT * FROM security_incidents WHERE company_id=? AND id=?")
        .get(this.p.company_id, field(input.id, "Incident", 80));
      if (!row) throw new DomainError("Incident not found", 404);
      const stages = [
        "DETECTED",
        "TRIAGED",
        "CONTAINED",
        "REMEDIATED",
        "RECOVERED",
        "CLOSED",
      ];
      const next = stages[stages.indexOf(String(row.status)) + 1];
      if (!next || input.status !== next)
        throw new DomainError(
          "Follow the incident lifecycle one stage at a time",
        );
      const resolution = choice(
        input.resolution,
        [
          "EVIDENCE_REVIEWED",
          "ACCESS_CONTAINED",
          "CREDENTIAL_ROTATED",
          "PATCH_VERIFIED",
          "RECOVERY_VERIFIED",
          "FALSE_POSITIVE_DOCUMENTED",
          "POST_INCIDENT_REVIEWED",
        ],
        "Resolution evidence category",
      );
      if (input.evidenceConfirmed !== true)
        throw new DomainError(
          "Human verification of the action is required; this does not perform external remediation",
        );
      this.db
        .prepare(
          "UPDATE security_incidents SET status=?,resolution=?,updated_at=? WHERE company_id=? AND id=?",
        )
        .run(next, resolution, now(), this.p.company_id, row.id);
      return { status: next, externalRemediation: false };
    });
  }
  lockdown(input: Record<string, unknown>) {
    return this.change("SECURITY_LOCKDOWN_CHANGED", "company", () => {
      this.consumeReauth(input.reauthToken);
      if (input.enabled !== true && input.enabled !== false)
        throw new DomainError("Lockdown choice required");
      if (input.enabled) {
        const incident = this.db
          .prepare(
            "SELECT id FROM security_incidents WHERE company_id=? AND id=? AND severity IN('HIGH','CRITICAL') AND confidence IN('HIGH','CONFIRMED') AND status NOT IN('RECOVERED','CLOSED')",
          )
          .get(
            this.p.company_id,
            field(input.incidentId, "Credible incident", 80),
          );
        if (!incident)
          throw new DomainError("An open credible severe incident is required");
      } else if (
        input.confirmRelease !== true ||
        this.db
          .prepare(
            "SELECT id FROM security_incidents WHERE company_id=? AND severity IN('HIGH','CRITICAL') AND status NOT IN('RECOVERED','CLOSED') LIMIT 1",
          )
          .get(this.p.company_id)
      )
        throw new DomainError(
          "Resolve severe incidents and explicitly confirm release",
        );
      this.db
        .prepare(
          "INSERT INTO security_settings VALUES(?,90,?,1,?) ON CONFLICT(company_id) DO UPDATE SET lockdown=excluded.lockdown,version=security_settings.version+1,updated_at=excluded.updated_at",
        )
        .run(this.p.company_id, Number(input.enabled), now());
      if (input.enabled) {
        new ComplianceService(this.db, this.p).invalidateApprovals();
        this.db
          .prepare("DELETE FROM security_permissions WHERE company_id=?")
          .run(this.p.company_id);
        this.db
          .prepare(
            "UPDATE security_approvals SET consumed_at=? WHERE company_id=? AND consumed_at IS NULL",
          )
          .run(now(), this.p.company_id);
        this.db
          .prepare(
            "DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE company_id=?)",
          )
          .run(this.p.company_id);
        this.db
          .prepare(
            "DELETE FROM security_reauth WHERE user_id IN(SELECT id FROM users WHERE company_id=?)",
          )
          .run(this.p.company_id);
      }
      return {
        lockdown: input.enabled,
        localSessionsRevoked: input.enabled,
        remoteTokensRevoked: false,
      };
    });
  }
  acknowledge(input: Record<string, unknown>) {
    return this.change("SECURITY_ALERT_ACKNOWLEDGED", String(input.id), () => {
      const result = this.db
        .prepare(
          "UPDATE security_alerts SET status='ACKNOWLEDGED' WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, field(input.id, "Alert", 80));
      if (!result.changes) throw new DomainError("Alert not found", 404);
      return { ok: true };
    });
  }
  report(input: Record<string, unknown>) {
    return this.change("SECURITY_REPORT_CREATED", "report", () => {
      const kind = choice(input.kind, ["WEEKLY", "90_DAY"], "Report kind"),
        overview = securityOverview(this.db, this.p.company_id);
      const body = {
        asOf: now(),
        kind,
        status: overview.status,
        riskScore: overview.riskScore,
        counts: overview.counts,
        coverage: overview.coverage,
        incidentIds: overview.incidents.map((i) => i.id),
        recommendations: [
          "Resolve open severe incidents first.",
          "Review overdue credentials and important accounts without phishing-resistant MFA.",
          "Review expiring agent grants, dormant accounts and recovery configuration.",
          "External integrations and human-reported authentication status require verification.",
        ],
        periodDays: kind === "WEEKLY" ? 7 : 90,
        method:
          "Current inventory plus bounded recent history; no claimed trend or autonomous analysis",
      };
      const record = id();
      this.db
        .prepare("INSERT INTO security_reports VALUES(?,?,?,?,?)")
        .run(record, this.p.company_id, kind, JSON.stringify(body), now());
      return { id: record };
    });
  }
  schedule(input: Record<string, unknown>) {
    return this.change("SECURITY_REVIEW_SCHEDULE_CHANGED", "schedule", () => {
      this.consumeReauth(input.reauthToken);
      if (typeof input.enabled !== "boolean")
        throw new DomainError("Explicit schedule choice required");
      this.db
        .prepare(
          "INSERT INTO security_review_schedule VALUES(?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET authorized_by=excluded.authorized_by,enabled=excluded.enabled",
        )
        .run(
          this.p.company_id,
          this.p.id,
          Number(input.enabled),
          Date.now(),
          Date.now(),
          Date.now(),
        );
      return {
        enabled: input.enabled,
        scope:
          "Local metadata review and reports only; no external provider polling",
      };
    });
  }
  async breachCheck(input: Record<string, unknown>, adapter?: BreachProvider) {
    const start = this.change(
      "BREACH_CHECK_REQUESTED",
      String(input.id),
      () => {
        this.consumeReauth(input.reauthToken);
        const row = this.record(input.id);
        if (input.authorizedIdentifier !== true)
          throw new DomainError(
            "Authorize sharing this account identifier with Have I Been Pwned",
          );
        if (row.status === "DISABLED")
          throw new DomainError("Credential disabled");
        const last = this.db
          .prepare(
            "SELECT created_at FROM breach_checks WHERE company_id=? AND credential_id=? ORDER BY created_at DESC LIMIT 1",
          )
          .get(this.p.company_id, row.id);
        if (last && Date.now() - Date.parse(String(last.created_at)) < 60000)
          throw new DomainError("Breach-check cooldown active", 429);
        const record = id();
        this.db
          .prepare(
            "INSERT INTO breach_checks VALUES(?,?,?,'RUNNING','HIBP',0,?)",
          )
          .run(record, this.p.company_id, row.id, now());
        return { record, row };
      },
    );
    let count: number | null = null;
    try {
      count = adapter
        ? await adapter.check(String(start.row.username_identifier))
        : null;
    } catch {
      count = null;
    }
    return this.change("BREACH_CHECK_COMPLETED", String(start.row.id), () => {
      const row = this.record(start.row.id);
      const result =
        count === null
          ? "UNAVAILABLE"
          : count > 0
            ? "EXPOSURE"
            : "NO_REPORTED_EXPOSURE";
      this.db
        .prepare(
          "UPDATE breach_checks SET status=?,exposures=? WHERE company_id=? AND id=?",
        )
        .run(result, count ?? 0, this.p.company_id, start.record);
      if (count !== null && count > 0) {
        this.db
          .prepare(
            "UPDATE credential_metadata SET breach_status=CASE WHEN breach_status='COMPROMISED' THEN breach_status ELSE 'POSSIBLY_COMPROMISED' END,updated_at=? WHERE company_id=? AND id=?",
          )
          .run(now(), this.p.company_id, row.id);
        const evidence = securityEvent(
          this.db,
          this.p.company_id,
          this.p.id,
          "BREACH_DETECTED",
          String(row.id),
          "EXPOSURE",
          "HIGH",
          { provider: "HIBP", exposureCount: count },
        );
        if (
          !this.db
            .prepare(
              "SELECT id FROM security_incidents WHERE company_id=? AND credential_id=? AND category='CREDENTIAL_EXPOSURE' AND status!='CLOSED'",
            )
            .get(this.p.company_id, row.id)
        )
          this.incident({
            credentialId: row.id,
            evidenceId: evidence,
            severity: "HIGH",
            category: "CREDENTIAL_EXPOSURE",
            confidence: "HIGH",
          });
        this.alert(
          `breach:${row.id}:${count}`,
          "BREACH_ALERT",
          "HIGH",
          `Credential ${row.id} has reported exposure. Rotate it, review sessions and recovery information; unauthorized login is not confirmed.`,
        );
      } else if (
        count === 0 &&
        !["POSSIBLY_COMPROMISED", "COMPROMISED"].includes(
          String(row.breach_status),
        )
      )
        this.db
          .prepare(
            "UPDATE credential_metadata SET breach_status='NO_REPORTED_EXPOSURE',updated_at=? WHERE company_id=? AND id=?",
          )
          .run(now(), this.p.company_id, row.id);
      return { status: result, exposures: count, accountSafe: false };
    });
  }
}
export interface BreachProvider {
  check(identifier: string): Promise<number>;
}
export class HibpProvider implements BreachProvider {
  private apiKey: string;
  constructor(key: string) {
    this.apiKey = key;
  }
  async check(identifier: string) {
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ||
      identifier.length > 254
    )
      throw new Error("Authorized email required");
    const response = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(identifier)}?truncateResponse=true`,
      {
        headers: {
          "hibp-api-key": this.apiKey,
          "user-agent": "CompanyOS-Viktor-Security",
        },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.status === 404) return 0;
    if (!response.ok || !response.body) throw new Error("Provider unavailable");
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 262144) throw new Error("Provider response too large");
      chunks.push(Buffer.from(chunk));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (
      !Array.isArray(value) ||
      value.length > 1000 ||
      value.some((v) => typeof v?.Name !== "string")
    )
      throw new Error("Invalid provider data");
    return value.length;
  }
}
export function tickSecurity(db: DatabaseSync) {
  const schedules = db
    .prepare(
      "SELECT * FROM security_review_schedule WHERE enabled=1 AND (next_daily_at<=? OR next_weekly_at<=? OR next_quarterly_at<=?) LIMIT 10",
    )
    .all(Date.now(), Date.now(), Date.now());
  for (const row of schedules) {
    try {
      transaction(db, () => {
        const user = db
          .prepare(
            "SELECT id,company_id,role FROM users WHERE id=? AND company_id=? AND role='CEO'",
          )
          .get(row.authorized_by, row.company_id);
        if (!user) return;
        const service = new SecurityService(db, {
          id: String(user.id),
          company_id: String(user.company_id),
          role: "CEO",
        });
        const time = Date.now();
        if (Number(row.next_daily_at) <= time) {
          service.review();
          db.prepare(
            "UPDATE security_review_schedule SET next_daily_at=? WHERE company_id=?",
          ).run(time + 86400000, row.company_id);
        }
        if (Number(row.next_weekly_at) <= time) {
          service.report({ kind: "WEEKLY" });
          db.prepare(
            "UPDATE security_review_schedule SET next_weekly_at=? WHERE company_id=?",
          ).run(time + 7 * 86400000, row.company_id);
        }
        if (Number(row.next_quarterly_at) <= time) {
          service.report({ kind: "90_DAY" });
          db.prepare(
            "UPDATE security_review_schedule SET next_quarterly_at=? WHERE company_id=?",
          ).run(time + 90 * 86400000, row.company_id);
        }
      });
    } catch {
      /* No raw provider or database error content in telemetry. Next tick retries uncommitted local work. */
    }
  }
}
