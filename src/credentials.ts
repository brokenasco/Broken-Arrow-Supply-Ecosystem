import { randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  SecurityFoundation,
  securitySettings,
  securityEvent,
} from "./security-foundation.ts";
import { id, now } from "./db.ts";
import { DomainError } from "./policy.ts";
import { choice, field, integer, iso } from "./workflow.ts";
export function generatePassword(
  policy: {
    length?: number;
    symbols?: string;
    upper?: boolean;
    lower?: boolean;
    digits?: boolean;
  } = {},
) {
  const length = policy.length ?? 24;
  if (!Number.isInteger(length) || length < 15 || length > 128)
    throw new DomainError("Password length must be 15–128");
  const classes = [
    policy.upper === false ? "" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    policy.lower === false ? "" : "abcdefghijklmnopqrstuvwxyz",
    policy.digits === false ? "" : "0123456789",
    policy.symbols ?? "!@#$%^&*()-_=+[]{}:,.?",
  ];
  if (
    classes[3].length > 40 ||
    /[^\x21-\x7e]/.test(classes[3]) ||
    /[A-Za-z0-9]/.test(classes[3])
  )
    throw new DomainError("Unsupported symbol policy");
  const alphabet = [...new Set(classes.join(""))].join("");
  if (alphabet.length < 20)
    throw new DomainError("Service password policy too weak");
  for (let attempt = 0; attempt < 1000; attempt++) {
    const bytes = Buffer.alloc(length);
    for (let i = 0; i < length; i++)
      bytes[i] = alphabet.charCodeAt(randomInt(alphabet.length));
    if (
      classes
        .filter(Boolean)
        .every((c) =>
          [...bytes].some((b) => c.includes(String.fromCharCode(b))),
        )
    )
      return bytes;
    bytes.fill(0);
  }
  throw new DomainError("Unable to satisfy password policy");
}
export function credentialHealth(
  row: Record<string, any>,
  globalDays = 90,
  time = Date.now(),
): Record<string, any> {
  const due =
    Date.parse(row.password_last_changed_at) +
    (row.rotation_days ?? globalDays) * 86400000;
  const remaining = Math.ceil((due - time) / 86400000),
    reasons: { reason: string; points: number }[] = [];
  if (["POSSIBLY_COMPROMISED", "COMPROMISED"].includes(row.breach_status))
    reasons.push({ reason: "Reported exposure or compromise", points: 40 });
  if (
    !["APP_MFA", "SMS_MFA", "PASSKEY", "HARDWARE_KEY"].includes(row.auth_method)
  )
    reasons.push({ reason: "MFA/passkey not confirmed", points: 15 });
  if (row.auth_method === "SMS_MFA")
    reasons.push({
      reason: "SMS MFA is weaker than phishing-resistant authentication",
      points: 5,
    });
  if (row.privileged)
    reasons.push({ reason: "Privileged account", points: 15 });
  if (remaining < 0) reasons.push({ reason: "Rotation overdue", points: 5 });
  const risk = Math.min(
    100,
    reasons.reduce((sum, r) => sum + r.points, 0),
  );
  return {
    ...row,
    password_rotation_due_at: new Date(due).toISOString(),
    password_age_days: Math.max(
      0,
      Math.floor((time - Date.parse(row.password_last_changed_at)) / 86400000),
    ),
    days_remaining: remaining,
    risk_score: risk,
    risk_reasons: reasons,
    credential_status:
      row.status === "DISABLED"
        ? "DISABLED"
        : ["POSSIBLY_COMPROMISED", "COMPROMISED"].includes(row.breach_status)
          ? row.breach_status
          : remaining < 0
            ? "OVERDUE"
            : remaining === 0
              ? "ROTATION_DUE"
              : remaining <= 30
                ? "ROTATION_DUE_SOON"
                : "HEALTHY",
    auth_evidence: "HUMAN_REPORTED; not authentication enforcement",
    reuse_status: "UNKNOWN — vault-side reuse analysis not connected",
  };
}
export function credentials(db: DatabaseSync, company: string) {
  const days = Number(securitySettings(db, company).rotation_days);
  return db
    .prepare(
      "SELECT * FROM credential_metadata WHERE company_id=? ORDER BY service_name",
    )
    .all(company)
    .map((r) => credentialHealth(r, days));
}
export function sessions(db: DatabaseSync, company: string) {
  return db
    .prepare(
      "SELECT s.id,s.created_at,u.email,u.id user_id,x.expires_at FROM security_sessions s JOIN sessions x ON x.token_hash=s.session_hash JOIN users u ON u.id=x.user_id WHERE u.company_id=? AND x.expires_at>?",
    )
    .all(company, Date.now());
}
export class CredentialService extends SecurityFoundation {
  record(record: unknown) {
    const row = this.db
      .prepare("SELECT * FROM credential_metadata WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(record, "Credential", 80));
    if (!row) throw new DomainError("Credential not found", 404);
    return row;
  }
  create(input: Record<string, unknown>) {
    const allowed = [
      "serviceName",
      "serviceDomain",
      "usernameIdentifier",
      "vaultReference",
      "environment",
      "kind",
      "privileged",
      "authMethod",
      "lastChanged",
      "rotationDays",
      "reauthToken",
    ];
    if (Object.keys(input).some((k) => !allowed.includes(k)))
      throw new DomainError(
        "Only approved metadata fields accepted; never submit secrets",
      );
    return this.change("CREDENTIAL_METADATA_CREATED", "inventory", () => {
      this.consumeReauth(input.reauthToken);
      const domain = field(
        input.serviceDomain,
        "Service domain",
        253,
      ).toLowerCase();
      if (
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
      )
        throw new DomainError(
          "DNS service name required; no URL or credentials",
        );
      const reference = field(
        input.vaultReference,
        "Opaque vault reference",
        80,
      );
      if (!/^cred_[a-zA-Z0-9_-]{8,64}$/.test(reference))
        throw new DomainError(
          "Use an opaque cred_ reference; never a secret or vault path",
        );
      const changed = iso(input.lastChanged, "Last changed");
      if (Date.parse(changed) > Date.now())
        throw new DomainError("Last changed cannot be in the future");
      if (typeof input.privileged !== "boolean")
        throw new DomainError("Privileged flag required");
      const record = id();
      this.db
        .prepare(
          "INSERT INTO credential_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?, ?,0,?,?)",
        )
        .run(
          record,
          this.p.company_id,
          field(input.serviceName, "Service", 80),
          domain,
          field(input.usernameIdentifier, "Account identifier", 254),
          reference,
          choice(
            input.environment,
            ["DEVELOPMENT", "TESTING", "STAGING", "PRODUCTION"],
            "Environment",
          ),
          choice(
            input.kind,
            [
              "PASSWORD",
              "API_KEY",
              "OAUTH",
              "DATABASE",
              "WEBHOOK",
              "SERVICE_ACCOUNT",
            ],
            "Kind",
          ),
          Number(input.privileged),
          choice(
            input.authMethod,
            [
              "UNKNOWN",
              "PASSWORD_ONLY",
              "SMS_MFA",
              "APP_MFA",
              "PASSKEY",
              "HARDWARE_KEY",
            ],
            "Authentication method",
          ),
          changed,
          input.rotationDays == null
            ? null
            : integer(input.rotationDays, "Rotation days", 1, 365),
          "ACTIVE",
          "UNKNOWN",
          now(),
          now(),
        );
      return { id: record };
    });
  }
  updated(input: Record<string, unknown>) {
    return this.change("PASSWORD_ROTATED", String(input.id), () => {
      this.consumeReauth(input.reauthToken);
      const row = this.record(input.id);
      if (input.confirmExternalChange !== true)
        throw new DomainError(
          "Confirm the credential was changed in its vault/service",
        );
      const date = now();
      this.db
        .prepare(
          "UPDATE credential_metadata SET password_last_changed_at=?,last_rotation_reminder_at=NULL,updated_at=? WHERE company_id=? AND id=?",
        )
        .run(date, date, this.p.company_id, row.id);
      this.db
        .prepare("INSERT INTO credential_rotation_history VALUES(?,?,?,?,?,?)")
        .run(id(), this.p.company_id, row.id, this.p.id, date, date);
      return {
        recorded: true,
        externalRotation: false,
        compromiseCleared: false,
      };
    });
  }
  authMethod(input: Record<string, unknown>) {
    return this.change("MFA_STATUS_REPORTED", String(input.id), () => {
      this.consumeReauth(input.reauthToken);
      const row = this.record(input.id);
      const method = choice(
        input.authMethod,
        [
          "UNKNOWN",
          "PASSWORD_ONLY",
          "SMS_MFA",
          "APP_MFA",
          "PASSKEY",
          "HARDWARE_KEY",
        ],
        "Authentication method",
      );
      this.db
        .prepare(
          "UPDATE credential_metadata SET auth_method=?,updated_at=? WHERE company_id=? AND id=?",
        )
        .run(method, now(), this.p.company_id, row.id);
      return { reported: true, enforced: false };
    });
  }
  revokeSession(input: Record<string, unknown>) {
    return this.change("SESSION_REVOKED", String(input.id), () => {
      this.consumeReauth(input.reauthToken);
      const row = this.db
        .prepare(
          "SELECT s.session_hash,x.user_id FROM security_sessions s JOIN sessions x ON x.token_hash=s.session_hash JOIN users u ON u.id=x.user_id WHERE s.id=? AND u.company_id=?",
        )
        .get(field(input.id, "Session", 80), this.p.company_id);
      if (!row) throw new DomainError("Session not found", 404);
      this.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(row.session_hash);
      this.db
        .prepare("DELETE FROM security_reauth WHERE user_id=?")
        .run(row.user_id);
      return { revoked: true };
    });
  }
  alert(dedupe: string, category: string, severity: string, message: string) {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO security_alerts VALUES(?,?,?,?,?,?,'OPEN',?)",
      )
      .run(id(), this.p.company_id, dedupe, category, severity, message, now());
    if (result.changes)
      this.db
        .prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?)")
        .run(id(), this.p.company_id, severity, message, 0, now());
    return Number(result.changes);
  }
  review() {
    return this.change("SECURITY_DAILY_REVIEW", "inventory", () => {
      let alerts = 0;
      for (const row of credentials(this.db, this.p.company_id)) {
        if (row.status === "DISABLED") continue;
        const phase =
          row.days_remaining < 0
            ? "OVERDUE"
            : row.days_remaining === 0
              ? "DUE"
              : row.days_remaining <= 7
                ? "7_DAYS"
                : row.days_remaining <= 30
                  ? "30_DAYS"
                  : null;
        if (phase) {
          const added = this.alert(
            `rotation:${row.id}:${row.password_rotation_due_at}:${phase}`,
            "PASSWORD_ROTATION",
            row.days_remaining < 0 ? "MEDIUM" : "LOW",
            `Credential ${row.id}: rotation ${phase.replaceAll("_", " ").toLowerCase()}.`,
          );
          alerts += added;
          if (added)
            this.db
              .prepare(
                "UPDATE credential_metadata SET last_rotation_reminder_at=? WHERE company_id=? AND id=?",
              )
              .run(now(), this.p.company_id, row.id);
        }
        if (
          row.privileged &&
          ["UNKNOWN", "PASSWORD_ONLY", "SMS_MFA"].includes(row.auth_method)
        )
          alerts += this.alert(
            `mfa:${row.id}:${row.auth_method}`,
            "MFA_CHANGE",
            "MEDIUM",
            `Important credential ${row.id}: review phishing-resistant authentication.`,
          );
      }
      return {
        alerts,
        breachMonitoring:
          "UNAVAILABLE unless separately configured and authorized",
        secretReuse: "UNAVAILABLE",
        certificateMonitoring: "NOT CONNECTED",
      };
    });
  }
}
