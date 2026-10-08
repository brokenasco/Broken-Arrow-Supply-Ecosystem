import { assertComplianceClear } from "./compliance-gates.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Snapshot } from "./shopify/read.ts";
import { audit, id, now, transaction } from "./db.ts";
import { DomainError } from "./policy.ts";
import type { Principal } from "./service.ts";

export const kpis = [
  {
    id: "orders",
    name: "Eligible orders",
    unit: "orders",
    definition:
      "Non-test, non-cancelled orders grouped by creation date in the store timezone.",
  },
  {
    id: "value",
    name: "Current order value",
    unit: "currency minor units",
    definition:
      "Sum of current order totals for eligible orders. Includes shipping, tax and unpaid orders; not recognized revenue or profit.",
  },
  {
    id: "aov",
    name: "Average order value",
    unit: "currency minor units",
    definition:
      "Current order value divided by eligible orders; unavailable with zero orders.",
  },
];
export function localDay(at: string, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function shiftDay(day: string, n: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}

// Called inside the successful sync transaction. Edge dates are deliberately excluded:
// their local days may be only partly covered by the provider's rolling window.
export function captureDays(
  db: DatabaseSync,
  company: string,
  store: string,
  run: string,
  s: Snapshot,
) {
  const first = shiftDay(localDay(s.from, s.shop.timezone), 1),
    end = localDay(s.to, s.shop.timezone);
  const totals = new Map<string, { orders: number; value: number }>();
  for (const o of s.orders) {
    if (o.test || o.cancelledAt) continue;
    const day = localDay(o.createdAt, s.shop.timezone);
    const t = totals.get(day) ?? { orders: 0, value: 0 };
    t.orders++;
    t.value += o.total;
    if (!Number.isSafeInteger(t.value))
      throw new DomainError("Analytics total exceeds safe integer range");
    totals.set(day, t);
  }
  for (let day = first; day < end; day = shiftDay(day, 1)) {
    const t = totals.get(day) ?? { orders: 0, value: 0 };
    db.prepare(
      `INSERT INTO analytics_days VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,store_id,currency,timezone,day) DO UPDATE SET orders=excluded.orders,value_minor=excluded.value_minor,source_run=excluded.source_run,as_of=excluded.as_of`,
    ).run(
      company,
      store,
      s.shop.currency,
      s.shop.timezone,
      day,
      t.orders,
      t.value,
      run,
      s.to,
    );
  }
}
type Day = {
  day: string;
  orders: number;
  value_minor: number;
  as_of: string;
  source_run: string;
};
export function period(days: Day[], start: string, end: string) {
  const expected = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
  const rows = days.filter((d) => d.day >= start && d.day < end);
  const complete = expected > 0 && rows.length === expected;
  const orders = rows.reduce((n, d) => n + d.orders, 0),
    value = rows.reduce((n, d) => n + d.value_minor, 0);
  if (!Number.isSafeInteger(value))
    throw new DomainError("Analytics total exceeds safe integer range");
  return {
    start,
    end,
    covered: rows.length,
    expected,
    complete,
    orders: complete ? orders : null,
    value: complete ? value : null,
    aov: complete && orders ? Math.round(value / orders) : null,
  };
}
export function comparison(
  current: ReturnType<typeof period>,
  previous: ReturnType<typeof period>,
) {
  return {
    current,
    previous,
    ordersChangePercent:
      current.orders !== null && previous.orders !== null && previous.orders > 0
        ? Math.round(
            ((current.orders - previous.orders) / previous.orders) * 1000,
          ) / 10
        : null,
  };
}
export function analyticsState(
  db: DatabaseSync,
  company: string,
  at = new Date(),
) {
  const c = db
    .prepare("SELECT * FROM shopify_connections WHERE company_id=?")
    .get(company);
  const reports = db
    .prepare(
      "SELECT * FROM analytics_reports WHERE company_id=? ORDER BY created_at DESC LIMIT 20",
    )
    .all(company)
    .map((r) => ({ ...r, body: JSON.parse(String(r.body)) }));
  const experiments = db
    .prepare(
      "SELECT * FROM experiments WHERE company_id=? ORDER BY created_at DESC LIMIT 100",
    )
    .all(company);
  const base = { kpis, reports, experiments };
  if (!c?.window_end || !c.timezone || c.status === "DISCONNECTED")
    return { ...base, data: null };
  const days = db
    .prepare(
      "SELECT day,orders,value_minor,as_of,source_run FROM analytics_days WHERE company_id=? AND store_id=? AND currency=? AND timezone=? ORDER BY day",
    )
    .all(
      company,
      String(c.store_id),
      String(c.currency),
      String(c.timezone),
    ) as Day[];
  const today = localDay(at.toISOString(), String(c.timezone));
  const week = comparison(
    period(days, shiftDay(today, -7), today),
    period(days, shiftDay(today, -14), shiftDay(today, -7)),
  );
  const monthStart = today.slice(0, 7) + "-01",
    lastMonth = shiftDay(monthStart, -1).slice(0, 7) + "-01",
    priorMonth = shiftDay(lastMonth, -1).slice(0, 7) + "-01";
  const month = comparison(
    period(days, lastMonth, monthStart),
    period(days, priorMonth, lastMonth),
  );
  const stale =
    c.status !== "READY" ||
    at.getTime() - Date.parse(String(c.window_end)) > 3600000;
  const yesterday = period(days, shiftDay(today, -1), today),
    baseline = period(days, shiftDay(today, -8), shiftDay(today, -1));
  const anomalyEligible =
    !stale &&
    yesterday.complete &&
    baseline.complete &&
    (baseline.orders ?? 0) >= 35;
  const ratio = anomalyEligible
    ? (yesterday.orders ?? 0) / ((baseline.orders ?? 0) / 7)
    : null;
  const findings: string[] = [];
  if (ratio !== null && (ratio <= 0.5 || ratio >= 1.5))
    findings.push(
      `Order-count review: ${yesterday.orders} yesterday versus ${((baseline.orders ?? 0) / 7).toFixed(1)} per day in the preceding seven days. Threshold ±50%; descriptive signal, not statistical significance or a causal explanation.`,
    );
  const recommendations = stale
    ? ["Refresh Shopify before acting on these historical figures."]
    : !week.current.complete || !week.previous.complete
      ? [
          "Accumulate complete daily coverage before interpreting weekly performance.",
        ]
      : findings.length
        ? [
            "Investigate traffic, promotions, stock and tracking changes; none of these causes is established by order counts.",
          ]
        : [
            "Register a measurable hypothesis and controlled experiment before changing strategy. No anomaly is evidence of neither success nor failure.",
          ];
  return {
    ...base,
    data: {
      currency: String(c.currency),
      timezone: String(c.timezone),
      asOf: String(c.window_end),
      stale,
      days: days.slice(-90),
      week,
      month,
      findings,
      anomalyEligible,
      recommendations,
      notes:
        "Definition v1. Historical creation-date cohorts reflect their last observed state; older totals may no longer be revised after leaving the 30-day cache. Dates use store timezone. No traffic, conversion, CAC, ROAS, margin or causal lift is available. Comparisons require every day; zero baseline has no percentage change.",
    },
  };
}
function field(v: unknown, name: string, max = 2000) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new DomainError(`${name} is required (maximum ${max} characters)`);
  return v.trim();
}
function date(v: unknown) {
  const d = field(v, "Date", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    !Number.isFinite(Date.parse(d)) ||
    new Date(d).toISOString().slice(0, 10) !== d
  )
    throw new DomainError("Valid ISO date required");
  return d;
}
export class AnalyticsService {
  db: DatabaseSync;
  p: Principal;
  constructor(db: DatabaseSync, p: Principal) {
    this.db = db;
    this.p = p;
    if (
      p.role !== "CEO" ||
      !db
        .prepare(
          "SELECT id FROM users WHERE id=? AND company_id=? AND role='CEO'",
        )
        .get(p.id, p.company_id)
    )
      throw new DomainError("CEO authority required", 403);
  }
  mutate<T>(action: string, fn: () => T) {
    return transaction(this.db, () => {
      const c = this.p.company_id;
      assertComplianceClear(this.db, c);
      if (
        this.db.prepare("SELECT stopped FROM companies WHERE id=?").get(c)
          ?.stopped ||
        this.db
          .prepare(
            "SELECT paused FROM departments WHERE company_id=? AND id='analytics'",
          )
          .get(c)?.paused ||
        this.db
          .prepare(
            "SELECT id FROM agents WHERE company_id=? AND id IN ('sofia','benjamin','maria') AND paused=1",
          )
          .get(c)
      )
        throw new DomainError("Analytics workflow is paused", 409);
      const result = fn();
      audit(this.db, c, this.p.id, action, "analytics");
      return result;
    });
  }
  report() {
    return this.mutate("analytics.report_created", () => {
      const state = analyticsState(this.db, this.p.company_id);
      if (!state.data)
        throw new DomainError("Sync Shopify before generating a report", 409);
      const reportId = id();
      this.db.prepare("INSERT INTO analytics_reports VALUES(?,?,?,?)").run(
        reportId,
        this.p.company_id,
        JSON.stringify({
          method: "Deterministic analysis; no model execution",
          owners: {
            definitions: "sofia",
            analysis: "benjamin",
            recommendations: "maria",
          },
          ...state.data,
        }),
        now(),
      );
      return { id: reportId };
    });
  }
  create(input: Record<string, unknown>) {
    return this.mutate("experiment.created", () => {
      const title = field(input.title, "Title", 160),
        hypothesis = field(input.hypothesis, "Hypothesis"),
        variant = field(input.variant, "Control and variant"),
        metric = field(input.metric, "Metric", 30),
        target = field(input.target, "Success criterion", 500),
        start = date(input.startsOn),
        end = date(input.endsOn);
      if (!kpis.some((k) => k.id === metric) || end <= start)
        throw new DomainError(
          "Choose a supported KPI and an end date after the start",
        );
      const experiment = id(),
        stamp = now();
      const data = analyticsState(this.db, this.p.company_id).data;
      this.db
        .prepare(
          "INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?,?,?,'PLANNED',NULL,NULL,?,?)",
        )
        .run(
          experiment,
          this.p.company_id,
          title,
          hypothesis,
          variant,
          metric,
          target,
          start,
          end,
          JSON.stringify(
            data
              ? {
                  definitionVersion: 1,
                  currency: data.currency,
                  timezone: data.timezone,
                  asOf: data.asOf,
                  stale: data.stale,
                  period: data.week.current,
                }
              : { unavailable: true },
          ),
          stamp,
          stamp,
        );
      return { id: experiment };
    });
  }
  update(input: Record<string, unknown>) {
    return this.mutate("experiment.updated", () => {
      const experiment = field(input.id, "Experiment", 80),
        status = field(input.status, "Status", 20),
        row = this.db
          .prepare("SELECT * FROM experiments WHERE id=? AND company_id=?")
          .get(experiment, this.p.company_id);
      if (!row) throw new DomainError("Experiment not found", 404);
      if (!(
        (row.status === "PLANNED" &&
          ["RUNNING", "CANCELLED"].includes(status)) ||
        (row.status === "RUNNING" &&
          ["COMPLETED", "CANCELLED"].includes(status))
      ))
        throw new DomainError("Invalid experiment transition", 409);
      const evidence =
          status === "COMPLETED"
            ? field(input.evidence, "Observed results and evidence", 4000)
            : null,
        conclusion =
          status === "COMPLETED"
            ? field(input.conclusion, "Conclusion and limitations", 2000)
            : null;
      this.db
        .prepare(
          "UPDATE experiments SET status=?,evidence=?,conclusion=?,updated_at=? WHERE id=? AND company_id=?",
        )
        .run(
          status,
          evidence,
          conclusion,
          now(),
          experiment,
          this.p.company_id,
        );
      return { ok: true };
    });
  }
}
