import test from "node:test";
import { imageAccountingFixture } from "./image-accounting-fixture.ts";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  ResearchService,
  researchState,
  opportunityFields,
} from "../src/research.ts";
import {
  DesignService,
  designState,
  briefFields,
  qaChecks,
} from "../src/design.ts";
import {
  SimulationImageProvider,
  OpenAIImageProvider,
  png,
  type ImageProvider,
} from "../src/images.ts";
import { createApp } from "../src/server.ts";
import { ResourceService } from "../src/resources.ts";
import { QuarantineService } from "../src/quarantine.ts";
import { randomUUID } from "node:crypto";
test("quarantine during paid mock generation retains reservation and prevents output or retry", async () => {
  const f = fixture();
  try {
    const b = brief(f),
      sim = new SimulationImageProvider();
    let finish!: () => void;
    const wait = new Promise<void>((r) => (finish = r));
    let calls = 0;
    f.d = new DesignService(f.db, f.p, {
      provider: () => ({
        name: "OPENAI",
        model: "mock-image-fixture",
        generate: async (i, s) => {
          calls++;
          await wait;
          return {
            ...(await sim.generate(i, s)),
            reference: "mock-receipt",
            usage: {
              input_tokens: 10,
              output_tokens: 3,
              total_tokens: 13,
              secret: "must-not-persist",
            },
          };
        },
      }),
    });
    imageAccountingFixture(f.db, f.p);
    f.d.configure({
      provider: "OPENAI",
      dailyLimit: 3,
      budgetCents: 100,
      reservationCents: 10,
      maxIterations: 3,
      categories: ["poster"],
      acknowledgeBilling: true,
    });
    const j = queued(f, b.brief);
    f.d.approve(j);
    const run = f.d.run({ id: j.id });
    const q = new QuarantineService(f.db, f.p),
      holdId = randomUUID();
    q.hold({
      agent: "jack",
      requestId: holdId,
      reason: "Mock in-flight hold",
      confirm: true,
    });
    finish();
    await assert.rejects(run, /uncertain/);
    const binding = f.db
      .prepare(
        "SELECT * FROM design_resource_bindings WHERE company_id=? AND job_id=?",
      )
      .get(f.p.company_id, j.id)!;
    assert.equal(
      new ResourceService(f.db, f.p).reservation(binding.reservation_id).state,
      "UNCERTAIN",
    );
    assert.equal(designState(f.db, f.p.company_id).assets.length, 0);
    const receipt = f.db.prepare("SELECT * FROM execution_receipts").get()!;
    assert.deepEqual(JSON.parse(String(receipt.usage)), {
      input_tokens: 10,
      output_tokens: 3,
      total_tokens: 13,
    });
    assert.equal(String(receipt.reference_hash).length, 64);
    assert.equal(JSON.stringify(receipt).includes("must-not-persist"), false);
    assert.throws(
      () => f.db.prepare("DELETE FROM execution_receipts").run(),
      /retained/,
    );
    assert.throws(
      () => f.db.prepare("UPDATE execution_receipts SET usage='{}'").run(),
      /immutable/,
    );
    assert.throws(
      () => q.release({ holdId, reason: "Too early", confirm: true }),
      /pending/,
    );
    f.d.reconcile({
      id: j.id,
      actualCents: 8,
      evidence: "Mock billing reconciliation",
    });
    assert.equal(
      f.db
        .prepare("SELECT total_tokens FROM ai_usage_ledger WHERE company_id=?")
        .get(f.p.company_id)?.total_tokens,
      13,
    );
    q.release({ holdId, reason: "Billing recorded; no replay", confirm: true });
    await assert.rejects(f.d.run({ id: j.id }), /approval/);
    assert.equal(calls, 1);
  } finally {
    f.db.close();
  }
});

const timestamp = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
test("paid image dispatch requires central pricing and reserved funds, then retains unknown billing until reconciliation", async () => {
  const f = fixture();
  let calls = 0;
  try {
    const b = brief(f),
      sim = new SimulationImageProvider(),
      resources = new ResourceService(f.db, f.p);
    f.d = new DesignService(f.db, f.p, {
      provider: () => ({
        name: "OPENAI",
        model: "mock-image-fixture",
        generate: async (i, s) => {
          calls++;
          const result = await sim.generate(i, s);
          return {
            ...result,
            usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
          };
        },
      }),
    });
    f.d.configure({
      provider: "OPENAI",
      dailyLimit: 3,
      budgetCents: 100,
      reservationCents: 10,
      maxIterations: 3,
      categories: ["poster"],
      acknowledgeBilling: true,
    });
    const j = queued(f, b.brief);
    f.d.approve(j);
    const price = {
      provider: "OPENAI",
      modelId: "mock-image-fixture",
      displayName: "Synthetic mock",
      inputUsdPerMillion: "1",
      cachedUsdPerMillion: "0",
      outputUsdPerMillion: "1",
      source: "Synthetic fixture only",
      effectiveAt: "2020-01-01T00:00:00Z",
      active: false,
      confirm: true,
    };
    resources.pricing(price);
    await assert.rejects(() => f.d.run({ id: j.id }), /pricing|price|model/i);
    assert.equal(calls, 0);
    resources.pricing({ ...price, active: true });
    resources.override({
      departmentId: "product",
      month: resources.month(),
      limitUsd: "0",
      reason: "Synthetic exhausted budget",
      confirm: true,
    });
    await assert.rejects(
      () => f.d.run({ id: j.id }),
      /HUMAN_BUDGET_DECISION_REQUIRED/,
    );
    assert.equal(calls, 0);
    resources.override({
      departmentId: "product",
      month: resources.month(),
      limitUsd: "5",
      reason: "Restore synthetic budget",
      confirm: true,
    });
    await f.d.run({ id: j.id });
    assert.equal(calls, 1);
    const binding = f.db
      .prepare("SELECT * FROM design_resource_bindings WHERE job_id=?")
      .get(j.id)!;
    assert.equal(
      resources.reservation(binding.reservation_id).state,
      "UNCERTAIN",
    );
    f.d.reconcile({
      id: j.id,
      actualCents: 8,
      evidence: "Synthetic billing statement",
    });
    const charge = f.db
      .prepare("SELECT * FROM ai_usage_ledger WHERE request_id=?")
      .get(binding.reservation_id)!;
    assert.equal(charge.cost_micros, 80000);
    assert.equal(charge.total_tokens, 13);
    assert.equal(charge.cached_input_tokens, null);
  } finally {
    f.db.close();
  }
});
const sourceInput = () => ({
  title: "Synthetic market observation",
  kind: "MARKET",
  url: "https://example.test/evidence",
  publisher: "Test publisher",
  excerpt: "Synthetic test evidence, not a live market claim.",
  publishedAt: timestamp(-3),
  retrievedAt: timestamp(-2),
  expiresAt: timestamp(20),
});
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "workflows@example.test",
    "long-workflows-test-password",
    "Synthetic workflows",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  imageAccountingFixture(db, p);
  return { db, p, r: new ResearchService(db, p), d: new DesignService(db, p) };
}
function ready(f: ReturnType<typeof fixture>) {
  const s = f.r.source(sourceInput());
  f.r.verify({
    id: s.id,
    status: "VERIFIED",
    note: "Human fixture verification, no actual market research",
  });
  const o = f.r.opportunity({
    title: "Synthetic opportunity",
    sourceIds: [s.id],
    confidence: 0.3,
    ...Object.fromEntries(
      opportunityFields.map((k) => [k, "Unknown; synthetic evidence only"]),
    ),
  });
  for (const stage of ["MARISHA", "ALEX", "BORIS", "READY"])
    f.r.handoff({
      id: o.id,
      stage,
      note: "Human-recorded fixture review for " + stage,
    });
  return { source: s.id, opportunity: o.id };
}
function brief(f: ReturnType<typeof fixture>) {
  const result = ready(f);
  const b = f.d.brief({
    opportunityId: result.opportunity,
    title: "Synthetic original design",
    confidence: 0.3,
    ...Object.fromEntries(
      briefFields.map((k) => [
        k,
        k === "productCategory"
          ? "poster"
          : "Original synthetic test specification",
      ]),
    ),
  });
  f.d.configure({
    provider: "SIMULATION",
    dailyLimit: 3,
    budgetCents: 0,
    reservationCents: 0,
    maxIterations: 3,
    categories: ["poster"],
  });
  return { ...result, brief: b.id };
}
function queued(
  f: ReturnType<typeof fixture>,
  briefId: string,
  key = "test-key",
) {
  const j = f.d.enqueue({
    briefId,
    instruction: "Original geometric composition",
    requestKey: key,
  });
  const row = designState(f.db, f.p.company_id).jobs.find(
    (r) => r.id === j.id,
  )!;
  return { id: j.id, payloadHash: row.payload_hash, confirm: true };
}

test("research preserves evidence, rejects unsafe URLs/dates, and separates verification from freshness", () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.r.source({ ...sourceInput(), url: "javascript:alert(1)" }),
      /HTTP/,
    );
    assert.throws(
      () => f.r.source({ ...sourceInput(), retrievedAt: timestamp(1) }),
      /Dates/,
    );
    const s = f.r.source(sourceInput());
    assert.equal(
      researchState(f.db, f.p.company_id).sources[0].status,
      "UNVERIFIED",
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE research_sources SET excerpt=? WHERE id=?")
          .run("rewritten", s.id),
      /immutable/,
    );
    const stale = f.r.source({ ...sourceInput(), expiresAt: timestamp(-1) });
    f.r.verify({
      id: stale.id,
      status: "VERIFIED",
      note: "Old document checked but coverage expired",
    });
    assert.equal(
      researchState(f.db, f.p.company_id).sources.find((x) => x.id === stale.id)
        ?.fresh,
      false,
    );
  } finally {
    f.db.close();
  }
});
test("opportunity pipeline requires scoped fresh evidence, ordered handoffs, and immutable content", () => {
  const f = fixture();
  try {
    const s = f.r.source(sourceInput());
    const o = f.r.opportunity({
      title: "Test",
      sourceIds: [s.id],
      confidence: 0.5,
      ...Object.fromEntries(opportunityFields.map((k) => [k, "Unknown"])),
    });
    assert.throws(
      () => f.r.handoff({ id: o.id, stage: "ALEX", note: "Skip review" }),
      /handoff/,
    );
    assert.throws(
      () => f.r.handoff({ id: o.id, stage: "MARISHA", note: "Review" }),
      /verified/,
    );
    f.r.verify({
      id: s.id,
      status: "VERIFIED",
      note: "Checked original evidence",
    });
    f.r.handoff({ id: o.id, stage: "MARISHA", note: "Source reviewed" });
    f.r.verify({ id: s.id, status: "DISPUTED", note: "Conflicting evidence" });
    assert.throws(
      () => f.r.handoff({ id: o.id, stage: "ALEX", note: "Review" }),
      /verified/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE opportunities SET body=? WHERE id=?")
          .run("{}", o.id),
      /immutable/,
    );
    const u = provision(
      f.db,
      "other-workflow@example.test",
      "other-workflows-long-password",
      "Other",
    );
    const other = new ResearchService(f.db, {
      id: u.user,
      company_id: u.company,
      role: "CEO",
    });
    assert.throws(
      () =>
        other.verify({ id: s.id, status: "VERIFIED", note: "Cross tenant" }),
      /not found/,
    );
    assert.throws(
      () => other.opportunity({ title: "Cross", sourceIds: [s.id] }),
      /not found/,
    );
    assert.equal(researchState(f.db, u.company).opportunities.length, 0);
  } finally {
    f.db.close();
  }
});
test("trend analysis labels descriptive observations and invalidates disputed evidence", () => {
  const f = fixture();
  try {
    const s = f.r.source(sourceInput());
    f.r.verify({ id: s.id, status: "VERIFIED", note: "Checked" });
    const base = {
      sourceId: s.id,
      series: "Same survey method",
      unit: "responses",
    };
    f.r.trend({ ...base, observedOn: timestamp(-5).slice(0, 10), value: 10 });
    f.r.trend({ ...base, observedOn: timestamp(-4).slice(0, 10), value: 15 });
    assert.equal(
      researchState(f.db, f.p.company_id).trends[0].changePercent,
      50,
    );
    assert.throws(
      () =>
        f.r.trend({
          ...base,
          observedOn: timestamp(-4).slice(0, 10),
          value: 16,
        }),
      /already/,
    );
    f.r.verify({ id: s.id, status: "DISPUTED", note: "Method changed" });
    assert.equal(
      researchState(f.db, f.p.company_id).trends[0].changePercent,
      null,
    );
  } finally {
    f.db.close();
  }
});
test("research mutation rolls back when audit fails; persisted CEO and pause gates hold", () => {
  const f = fixture();
  try {
    assert.throws(
      () => new ResearchService(f.db, { ...f.p, id: "agent" }),
      /CEO/,
    );
    f.db
      .prepare("UPDATE agents SET paused=1 WHERE company_id=? AND id='mason'")
      .run(f.p.company_id);
    assert.throws(() => f.r.source(sourceInput()), /paused/);
    f.db
      .prepare("UPDATE agents SET paused=0 WHERE company_id=? AND id='mason'")
      .run(f.p.company_id);
    f.db.exec(
      "CREATE TRIGGER fail_research_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit blocked'); END;",
    );
    assert.throws(() => f.r.source(sourceInput()), /audit blocked/);
    assert.equal(researchState(f.db, f.p.company_id).sources.length, 0);
  } finally {
    f.db.close();
  }
});
test("design queue binds single-use human approval and produces a private versioned simulation asset", async () => {
  const f = fixture();
  try {
    const b = brief(f),
      j = queued(f, b.brief);
    await assert.rejects(() => f.d.run({ id: j.id }), /approval/);
    assert.throws(() => f.d.approve({ ...j, payloadHash: "wrong" }), /changed/);
    f.d.approve(j);
    const asset = await f.d.run({ id: j.id });
    assert.ok(f.d.asset(asset.id).length);
    assert.equal(designState(f.db, f.p.company_id).assets[0].simulation, 1);
    assert.equal(designState(f.db, f.p.company_id).assets[0].status, "PENDING");
    await assert.rejects(() => f.d.run({ id: j.id }), /approval/);
    assert.throws(
      () =>
        f.d.review({
          id: asset.id,
          verdict: "PASS",
          note: "Looks good",
          checks: Object.fromEntries(qaChecks.map((k) => [k, true])),
        }),
      /PASS/,
    );
    f.d.review({
      id: asset.id,
      verdict: "REVISE",
      note: "SIMULATION: adjust shapes in next test variant",
      checks: Object.fromEntries(qaChecks.map((k) => [k, false])),
    });
    const second = f.d.enqueue({
      briefId: b.brief,
      parentAssetId: asset.id,
      instruction: "Adjust the layout",
      requestKey: "revision",
    });
    assert.equal(
      designState(f.db, f.p.company_id).jobs.find((x) => x.id === second.id)
        ?.version,
      2,
    );
    assert.throws(
      () =>
        f.d.review({
          id: asset.id,
          verdict: "REJECT",
          note: "Change review",
          checks: {},
        }),
      /already/,
    );
    const other = provision(
      f.db,
      "asset-other@example.test",
      "other-asset-long-password",
      "Other",
    );
    assert.throws(
      () =>
        new DesignService(f.db, {
          id: other.user,
          company_id: other.company,
          role: "CEO",
        }).asset(asset.id),
      /not found/,
    );
  } finally {
    f.db.close();
  }
});
test("queue deduplicates content, rejects replay edits, expiry and exceeded iteration/daily limits", async () => {
  const f = fixture();
  try {
    const b = brief(f),
      j = queued(f, b.brief);
    assert.equal(queued(f, b.brief).id, j.id);
    assert.throws(
      () =>
        f.d.enqueue({
          briefId: b.brief,
          instruction: "Changed",
          requestKey: "test-key",
        }),
      /different/,
    );
    f.d.approve(j);
    f.db
      .prepare("UPDATE generation_jobs SET expires_at=0 WHERE id=?")
      .run(j.id);
    await assert.rejects(() => f.d.run({ id: j.id }), /approval/);
    f.d.approve(j);
    await f.d.run({ id: j.id });
    f.d.configure({
      provider: "SIMULATION",
      dailyLimit: 1,
      budgetCents: 0,
      reservationCents: 0,
      maxIterations: 2,
      categories: ["poster"],
    });
    const second = queued(f, b.brief, "second");
    f.d.approve(second);
    await assert.rejects(() => f.d.run({ id: second.id }), /Daily/);
    assert.throws(() => queued(f, b.brief, "third"), /iteration/);
    f.d.cancel({ id: second.id });
    assert.equal(
      designState(f.db, f.p.company_id).jobs.find((x) => x.id === second.id)
        ?.status,
      "CANCELLED",
    );
  } finally {
    f.db.close();
  }
});
test("live provider budgets reserve atomically and uncertain outcomes never automatically retry", async () => {
  const f = fixture();
  let calls = 0;
  try {
    const b = brief(f);
    const provider: ImageProvider = {
      name: "OPENAI",
      model: "fixture",
      async generate() {
        calls++;
        throw new Error("secret provider detail");
      },
    };
    f.d = new DesignService(f.db, f.p, { provider: () => provider });
    f.d.configure({
      provider: "OPENAI",
      dailyLimit: 3,
      budgetCents: 25,
      reservationCents: 25,
      maxIterations: 3,
      categories: ["poster"],
      acknowledgeBilling: true,
    });
    const j = queued(f, b.brief);
    assert.equal(designState(f.db, f.p.company_id).committedCents, 25);
    assert.throws(() => queued(f, b.brief, "over"), /budget/);
    f.d.approve(j);
    await assert.rejects(() => f.d.run({ id: j.id }), /uncertain/);
    assert.equal(calls, 1);
    assert.equal(
      designState(f.db, f.p.company_id).jobs[0].status,
      "RECONCILIATION",
    );
    await assert.rejects(() => f.d.run({ id: j.id }), /approval/);
    assert.throws(() => queued(f, b.brief, "blocked"), /Reconcile/);
    f.d.reconcile({
      id: j.id,
      actualCents: 30,
      evidence: "Synthetic billing verification",
    });
    assert.equal(designState(f.db, f.p.company_id).committedCents, 30);
    assert.throws(
      () => f.d.reconcile({ id: j.id, actualCents: 0, evidence: "Repeated" }),
      /Already/,
    );
  } finally {
    f.db.close();
  }
});
test("in-flight stop quarantines generation outcome and retains single-use approval", async () => {
  const f = fixture();
  try {
    const b = brief(f);
    const sim = new SimulationImageProvider();
    let resolve!: () => void;
    let started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    const wait = new Promise<void>((r) => (resolve = r));
    f.d = new DesignService(f.db, f.p, {
      provider: () => ({
        name: "SIMULATION",
        model: sim.model,
        async generate(i, s) {
          started();
          await wait;
          return sim.generate(i, s);
        },
      }),
    });
    const j = queued(f, b.brief);
    f.d.approve(j);
    const promise = f.d.run({ id: j.id });
    await began;
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    resolve();
    await assert.rejects(() => promise, /uncertain/);
    assert.equal(designState(f.db, f.p.company_id).assets.length, 0);
    assert.equal(
      designState(f.db, f.p.company_id).jobs[0].status,
      "RECONCILIATION",
    );
  } finally {
    f.db.close();
  }
});
test("PNG validation rejects corrupted, active and overlarge assets", async () => {
  const sim = new SimulationImageProvider();
  const image = await sim.generate(
    { prompt: "test", jobId: "test" },
    new AbortController().signal,
  );
  assert.equal(png(image.bytes).width, 128);
  const bad = Buffer.from(image.bytes);
  bad[40] ^= 1;
  assert.throws(() => png(bad), /checksum/);
  assert.throws(() => png(Buffer.from('<svg onload="evil()"/>')), /PNG/);
  assert.throws(() => png(Buffer.alloc(9 * 1024 * 1024)), /PNG/);
});

test("QA passes only a fully checked real-provider fixture and rejects exact duplicates", async () => {
  const f = fixture();
  try {
    const b = brief(f),
      sim = new SimulationImageProvider();
    f.d = new DesignService(f.db, f.p, {
      provider: () => ({
        name: "OPENAI",
        model: "mock-image-fixture",
        generate: (i, s) => sim.generate(i, s),
      }),
    });
    f.d.configure({
      provider: "OPENAI",
      dailyLimit: 3,
      budgetCents: 100,
      reservationCents: 10,
      maxIterations: 3,
      categories: ["poster"],
      acknowledgeBilling: true,
    });
    const j = queued(f, b.brief);
    f.d.approve(j);
    const a = await f.d.run({ id: j.id });
    const checks = Object.fromEntries(qaChecks.map((k) => [k, true]));
    assert.throws(
      () =>
        f.d.review({
          id: a.id,
          verdict: "PASS",
          checks: { ...checks, printSuitability: false },
          note: "Not suitable",
        }),
      /PASS/,
    );
    f.d.review({
      id: a.id,
      verdict: "PASS",
      checks,
      note: "Mock provider contract test; no real visual or legal clearance.",
    });
    assert.equal(designState(f.db, f.p.company_id).assets[0].status, "PASS");
    f.d.reconcile({
      id: j.id,
      actualCents: 10,
      evidence: "Synthetic billing verification before a second paid request",
    });
    const j2 = queued(f, b.brief, "duplicate");
    f.d.approve(j2);
    const a2 = await f.d.run({ id: j2.id });
    assert.throws(
      () =>
        f.d.review({
          id: a2.id,
          verdict: "PASS",
          checks,
          note: "Duplicate image",
        }),
      /nonduplicate/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE design_assets SET content_hash=? WHERE id=?")
          .run("changed", a.id),
      /immutable/,
    );
  } finally {
    f.db.close();
  }
});

test("an unresolved outcome blocks previously queued work and interrupted jobs recover without retry", async () => {
  const f = fixture();
  try {
    const b = brief(f),
      one = queued(f, b.brief, "one"),
      two = queued(f, b.brief, "two");
    f.d.approve(one);
    f.d.approve(two);
    f.db
      .prepare(
        "UPDATE generation_jobs SET status='RUNNING',started_at=?,consumed_at=? WHERE id=?",
      )
      .run(timestamp(-1), timestamp(-1), one.id);
    f.d.recover({ id: one.id });
    await assert.rejects(() => f.d.run({ id: two.id }), /Reconcile/);
    f.d.reconcile({
      id: one.id,
      actualCents: 0,
      evidence: "Synthetic recovery: no external provider was called",
    });
    await f.d.run({ id: two.id });
    assert.equal(
      designState(f.db, f.p.company_id).jobs.find((j) => j.id === one.id)
        ?.status,
      "RECONCILIATION",
    );
  } finally {
    f.db.close();
  }
});

test("failed asset audit rolls back bytes, marks reconciliation, and keeps consumed approval", async () => {
  const f = fixture();
  try {
    const b = brief(f),
      j = queued(f, b.brief);
    f.d.approve(j);
    f.db.exec(
      "CREATE TRIGGER fail_asset_audit BEFORE INSERT ON audit_logs WHEN NEW.action='design.asset_created' BEGIN SELECT RAISE(ABORT,'audit blocked'); END;",
    );
    await assert.rejects(() => f.d.run({ id: j.id }), /uncertain/);
    assert.equal(designState(f.db, f.p.company_id).assets.length, 0);
    assert.equal(
      designState(f.db, f.p.company_id).jobs[0].status,
      "RECONCILIATION",
    );
    await assert.rejects(() => f.d.run({ id: j.id }), /approval/);
  } finally {
    f.db.close();
  }
});
test("OpenAI adapter pins endpoint and parameters, never retries or accepts asset URLs", async () => {
  let calls = 0;
  const sim = await new SimulationImageProvider().generate(
    { prompt: "x", jobId: "x" },
    new AbortController().signal,
  );
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(init?.redirect, "error");
    assert.equal(JSON.parse(String(init?.body)).n, 1);
    return new Response(
      JSON.stringify({
        data: [{ b64_json: sim.bytes.toString("base64") }],
        usage: { input_tokens: 12, output_tokens: 20 },
      }),
    );
  };
  const provider = new OpenAIImageProvider("synthetic-secret", transport);
  assert.ok(
    (
      await provider.generate(
        { prompt: "Original test", jobId: "fixture" },
        new AbortController().signal,
      )
    ).bytes.length,
  );
  assert.equal(calls, 1);
  const bad = new OpenAIImageProvider(
    "secret",
    async () =>
      new Response(
        JSON.stringify({ data: [{ url: "https://evil.test/image" }] }),
      ),
  );
  await assert.rejects(
    () =>
      bad.generate({ prompt: "x", jobId: "x" }, new AbortController().signal),
    /INVALID/,
  );
});
test("research and design HTTP routes enforce sessions, CSRF and tenant-protected PNG access", async () => {
  const f = fixture(),
    origin = "http://127.0.0.1:3199",
    server = createApp(f.db, origin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port;
  try {
    assert.equal(
      (await fetch(base + "/api/design/assets/unknown")).status,
      401,
    );
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "workflows@example.test",
        password: "long-workflows-test-password",
      }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0],
      session = (await (
        await fetch(base + "/api/session", { headers: { Cookie: cookie } })
      ).json()) as { csrf: string };
    const headers = {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    };
    assert.equal(
      (
        await fetch(base + "/api/research/source", {
          method: "POST",
          headers,
          body: JSON.stringify(sourceInput()),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/research/source", {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": session.csrf },
          body: JSON.stringify(sourceInput()),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/design/assets/unknown", {
          headers: { Cookie: cookie },
        })
      ).status,
      404,
    );
    const b = brief(f),
      j = queued(f, b.brief);
    f.d.approve(j);
    const asset = await f.d.run({ id: j.id });
    const response = await fetch(base + "/api/design/assets/" + asset.id, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(png(Buffer.from(await response.arrayBuffer())).width);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
