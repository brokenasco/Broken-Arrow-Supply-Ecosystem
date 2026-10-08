import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  AnalyticsService,
  analyticsState,
  localDay,
  period,
  comparison,
  shiftDay,
} from "../src/analytics.ts";

test("local date accounting follows DST and month/leap boundaries", () => {
  assert.equal(
    localDay("2026-03-08T04:59:00Z", "America/New_York"),
    "2026-03-07",
  );
  assert.equal(
    localDay("2026-03-09T04:01:00Z", "America/New_York"),
    "2026-03-09",
  );
  assert.equal(shiftDay("2024-03-01", -1), "2024-02-29");
});
test("coverage gaps are unavailable, observed zero is zero, zero baseline has no percentage", () => {
  const days = Array.from({ length: 14 }, (_, i) => ({
    day: shiftDay("2026-09-01", i),
    orders: i < 7 ? 0 : 2,
    value_minor: i < 7 ? 0 : 200,
    as_of: "2026-09-15",
    source_run: "fixture",
  }));
  const a = period(days, "2026-09-08", "2026-09-15"),
    b = period(days, "2026-09-01", "2026-09-08");
  assert.equal(a.orders, 14);
  assert.equal(a.aov, 100);
  assert.equal(b.orders, 0);
  assert.equal(b.aov, null);
  assert.equal(comparison(a, b).ordersChangePercent, null);
  assert.equal(period(days.slice(1), "2026-09-01", "2026-09-08").orders, null);
});
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "analytics@example.test",
    "long-analytics-test-password",
    "Analytics tests",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  return { db, p, s: new AnalyticsService(db, p) };
}
const input = {
  title: "Checkout wording",
  hypothesis: "Clear copy may improve order count",
  variant:
    "Randomly assign control and revised wording; track traffic separately",
  metric: "orders",
  target: "Pre-register sample and stop rules before running",
  startsOn: "2026-10-01",
  endsOn: "2026-10-15",
};
test("experiments require valid dates and transitions; completion needs evidence and locks outcome", () => {
  const { db, p, s } = fixture();
  try {
    assert.throws(
      () => s.create({ ...input, startsOn: "2026-02-30" }),
      /date/i,
    );
    assert.throws(() => s.create({ ...input, metric: "profit" }), /KPI/);
    const e = s.create(input);
    assert.throws(
      () => s.update({ id: e.id, status: "COMPLETED" }),
      /transition/,
    );
    s.update({ id: e.id, status: "RUNNING" });
    assert.throws(
      () => s.update({ id: e.id, status: "COMPLETED" }),
      /evidence/,
    );
    s.update({
      id: e.id,
      status: "COMPLETED",
      evidence: "Manual observation, sample too small. No causal estimate.",
      conclusion: "Inconclusive; repeat with sufficient traffic.",
    });
    assert.throws(
      () => s.update({ id: e.id, status: "RUNNING" }),
      /transition/,
    );
    assert.equal(
      analyticsState(db, p.company_id).experiments[0]?.status,
      "COMPLETED",
    );
  } finally {
    db.close();
  }
});
test("experiment ownership, company stop and atomic audit are enforced", () => {
  const { db, p, s } = fixture();
  try {
    const e = s.create(input);
    const u = provision(
      db,
      "other@example.test",
      "other-long-test-password",
      "Other",
    );
    const other = new AnalyticsService(db, {
      id: u.user,
      company_id: u.company,
      role: "CEO",
    });
    assert.throws(
      () => other.update({ id: e.id, status: "RUNNING" }),
      /not found/,
    );
    db.prepare("UPDATE companies SET stopped=1 WHERE id=?").run(p.company_id);
    assert.throws(() => s.create(input), /paused/);
    db.prepare("UPDATE companies SET stopped=0 WHERE id=?").run(p.company_id);
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END;",
    );
    assert.throws(
      () => s.update({ id: e.id, status: "RUNNING" }),
      /audit failure/,
    );
    assert.equal(
      analyticsState(db, p.company_id).experiments[0]?.status,
      "PLANNED",
    );
  } finally {
    db.close();
  }
});
