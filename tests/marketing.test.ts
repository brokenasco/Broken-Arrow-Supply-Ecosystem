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

const timestamp = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
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

import { ProductService, productState, decimal } from "../src/products.ts";
import {
  validateIdentity,
  type DraftWriter,
  type RemoteDraft,
} from "../src/shopify/write.ts";
async function productFixture(real = false) {
  const f = fixture(),
    b = brief(f);
  if (real) {
    imageAccountingFixture(f.db, f.p);
    const sim = new SimulationImageProvider();
    f.d = new DesignService(f.db, f.p, {
      provider: () => ({
        name: "OPENAI",
        model: "fixture",
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
  }
  const j = queued(f, b.brief);
  f.d.approve(j);
  await f.d.run({ id: j.id });
  const asset = designState(f.db, f.p.company_id).assets[0];
  if (real)
    f.d.review({
      id: asset.id,
      verdict: "PASS",
      checks: Object.fromEntries(qaChecks.map((k) => [k, true])),
      note: "Synthetic adapter test QA only",
    });
  let remote: RemoteDraft | null = null,
    calls = 0,
    lose = false;
  const writer: DraftWriter = {
    identity: async () => ({
      domain: "fixture.myshopify.com",
      currency: "USD",
      scopes: ["write_products"],
    }),
    collections: async (ids) =>
      ids.map((id) => ({ id, title: "Fixture", manual: true })),
    lookup: async () => remote,
    create: async (input) => {
      calls++;
      remote = {
        id: "gid://shopify/Product/1",
        handle: input.handle,
        status: "DRAFT",
        tags: input.tags,
        variants: input.variants.map((v) => ({
          sku: v.sku,
          price: v.price,
          selectedOptions: v.optionValues.map((o) => ({
            name: o.optionName,
            value: o.name,
          })),
        })),
      };
      if (lose) throw new Error("lost response");
      return remote;
    },
  };
  const products = new ProductService(f.db, f.p, {
    config: () => ({
      companyId: f.p.company_id,
      domain: "fixture.myshopify.com",
      accessToken: "fixture-only",
    }),
    writer: () => writer,
  });
  if (real)
    await products.authorize({
      domain: "fixture.myshopify.com",
      confirm: true,
    });
  const t = products.template({
    title: "Fixture template",
    kind: "POSTER",
    category: "poster",
    currency: "USD",
    optionName: "Size",
    variants: [{ value: "Small", suffix: "S", costMinor: 1000 }],
    costEvidence: "Synthetic cost excluding fees",
    costExpiresAt: timestamp(10),
    printSpecification: "Fixture only",
  });
  const input = {
    templateId: t.id,
    assetId: asset.id,
    mode: real ? "SHOPIFY" : "SIMULATION",
    requestKey: "fixture",
    title: "Fixture product",
    vendor: "Synthetic",
    description: "<script>escaped</script>",
    variantPrices: [{ value: "Small", price: "" }],
    targetMarginPercent: 50,
  };
  const proposal = products.proposal(input);
  const approve = () =>
    products.approve({
      id: proposal.id,
      payloadHash: productState(f.db, f.p.company_id).proposals[0].payload_hash,
      confirm: true,
    });
  return {
    ...f,
    products,
    proposal,
    input,
    approve,
    calls: () => calls,
    lose: () => {
      lose = true;
    },
  };
}

import {
  MarketingService,
  marketingState,
  campaignFields,
  day,
} from "../src/marketing.ts";
function plan(f: Awaited<ReturnType<typeof productFixture>>, overrides = {}) {
  return {
    requestKey: "campaign-key",
    productId: f.proposal.id,
    title: "Synthetic campaign",
    sourceIds: [
      String(f.db.prepare("SELECT id FROM research_sources LIMIT 1").get()!.id),
    ],
    channel: "EMAIL",
    startDate: timestamp(-3).slice(0, 10),
    endDate: timestamp(3).slice(0, 10),
    budgetMinor: 0,
    copyMode: "TEMPLATE",
    variantB: "Alternative synthetic copy",
    ...Object.fromEntries(
      campaignFields.map((k) => [k, "Human-entered synthetic " + k]),
    ),
    ...overrides,
  };
}
function approveCampaign(m: MarketingService, c: { id: string }, red = false) {
  return m.approve({
    id: c.id,
    contentHash: m.row(c.id).content_hash,
    confirm: true,
    acknowledgeRed: red,
  });
}
test("campaigns bind immutable product/evidence/copy and internal single-use approval", async () => {
  const f = await productFixture();
  try {
    const m = new MarketingService(f.db, f.p),
      input = plan(f),
      c = m.create(input);
    assert.deepEqual(m.create(input), c);
    assert.throws(
      () => m.create({ ...input, title: "Changed" }),
      /Request key/,
    );
    const body = marketingState(f.db, f.p.company_id).campaigns[0].body;
    assert.equal(body.simulation, true);
    assert.match(body.copy, /Fixture product/);
    assert.match(body.copyLabel, /not model/);
    assert.throws(() => m.ready(c), /approval/);
    assert.throws(
      () => m.approve({ id: c.id, contentHash: "wrong", confirm: true }),
      /Exact/,
    );
    approveCampaign(m, c);
    assert.equal(m.ready(c).externalAction, false);
    assert.throws(() => m.ready(c), /approval/);
    assert.throws(
      () =>
        f.db.prepare("UPDATE campaigns SET body=? WHERE id=?").run("{}", c.id),
      /immutable/,
    );
  } finally {
    f.db.close();
  }
});
test("RED plans need explicit review, expire, respect stop and keep cancellation available", async () => {
  const f = await productFixture();
  try {
    const m = new MarketingService(f.db, f.p),
      c = m.create(plan(f, { channel: "PAID_AD", budgetMinor: 100 }));
    assert.throws(() => approveCampaign(m, c), /RED/);
    approveCampaign(m, c, true);
    f.db.prepare("UPDATE campaigns SET expires_at=0 WHERE id=?").run(c.id);
    assert.throws(() => m.ready(c), /approval/);
    approveCampaign(m, c, true);
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    assert.throws(() => m.ready(c), /paused/);
    m.cancel(c);
    assert.equal(m.row(c.id).status, "CANCELLED");
  } finally {
    f.db.close();
  }
});
test("campaign tenant, stale evidence, invalid dates and audit rollback boundaries hold", async () => {
  const f = await productFixture();
  try {
    const m = new MarketingService(f.db, f.p),
      c = m.create(plan(f));
    const other = provision(
      f.db,
      "campaign-other@example.test",
      "another-password-test-123",
      "Other",
    );
    const outsider = new MarketingService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    assert.throws(() => outsider.cancel(c), /not found/);
    assert.throws(() => day("2026-02-30"), /calendar/);
    f.db.exec(
      "CREATE TRIGGER no_campaign_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(() => approveCampaign(m, c), /audit failed/);
    assert.equal(m.row(c.id).status, "DRAFT");
    f.db.exec("DROP TRIGGER no_campaign_audit");
    f.r.verify({
      id: plan(f).sourceIds[0],
      status: "DISPUTED",
      note: "Disputed fixture",
    });
    assert.throws(() => approveCampaign(m, c), /verified|fresh/i);
  } finally {
    f.db.close();
  }
});
test("measurement records descriptive aggregates and unavailable denominators atomically", async () => {
  const f = await productFixture();
  try {
    const m = new MarketingService(f.db, f.p),
      c = m.create(plan(f));
    approveCampaign(m, c);
    m.ready(c);
    const result = {
      id: c.id,
      periodStart: timestamp(-2).slice(0, 10),
      periodEnd: timestamp(-1).slice(0, 10),
      a: { visitors: 0, conversions: 0 },
      b: { visitors: 100, conversions: 10 },
      spendMinor: 0,
      revenueMinor: 1000,
      evidence: "Synthetic report",
      attribution: "Unknown attribution; fixture only",
      actualResult: "Ten synthetic conversions",
      lessons: "No real conclusion",
    };
    assert.throws(
      () => m.measure({ ...result, b: { visitors: 1, conversions: 2 } }),
      /integer/,
    );
    m.measure(result);
    const r = marketingState(f.db, f.p.company_id).results[0].body;
    assert.equal(r.a.rate, null);
    assert.equal(r.b.rate, 0.1);
    assert.equal(r.roas, null);
    assert.equal(r.rateDifference, null);
    assert.match(r.label, /SIMULATION/);
    assert.throws(() => m.measure(result), /Ready/);
    assert.equal(m.row(c.id).status, "COMPLETED");
  } finally {
    f.db.close();
  }
});

test("marketing HTTP requires session and CSRF and exposes no dispatch endpoint", async () => {
  const f = await productFixture();
  const origin = "http://127.0.0.1",
    server = createApp(f.db, origin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    const post = (path: string, body: unknown, headers = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post("/api/marketing/create", plan(f))).status, 401);
    const response = await post("/api/login", {
      email: "workflows@example.test",
      password: "long-workflows-test-password",
    });
    const cookie = response.headers.get("set-cookie")!.split(";")[0],
      session = (await response.json()) as { csrf: string };
    assert.equal(
      (await post("/api/marketing/create", plan(f), { Cookie: cookie })).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
    assert.equal(
      (await post("/api/marketing/create", plan(f), headers)).status,
      200,
    );
    assert.equal(
      (await post("/api/marketing/dispatch", {}, headers)).status,
      404,
    );
    assert.equal((await fetch(base + "/marketing.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});

// Phase 12 exercises the same complete product/campaign fixture end to end.
import {
  LearningService,
  learningFields,
  learningState,
} from "../src/learning.ts";
import { CustomerService } from "../src/customers.ts";
import { ComplianceService } from "../src/compliance.ts";
import { CompanyService } from "../src/service.ts";
async function learningFixture() {
  const f = await productFixture();
  const asset = designState(f.db, f.p.company_id).assets[0];
  f.d.review({
    id: asset.id,
    verdict: "REVISE",
    checks: Object.fromEntries(qaChecks.map((k) => [k, false])),
    note: "Synthetic preview only, not print ready",
  });
  f.approve();
  await f.products.dispatch(f.proposal);
  const m = new MarketingService(f.db, f.p),
    campaign = m.create(plan(f));
  approveCampaign(m, campaign);
  m.ready(campaign);
  m.measure({
    ...campaign,
    periodStart: timestamp(-2).slice(0, 10),
    periodEnd: timestamp(-1).slice(0, 10),
    a: { visitors: 0, conversions: 0 },
    b: { visitors: 100, conversions: 10 },
    spendMinor: 0,
    revenueMinor: 1000,
    evidence: "Synthetic aggregate",
    attribution: "Not causal",
    actualResult: "Synthetic result",
    lessons: "Test only",
  });
  const customers = new CustomerService(f.db, f.p);
  const evidence = customers.capture({
    requestKey: "learning-evidence",
    title: "Synthetic observation",
    kind: "COMPLAINT",
    simulation: true,
    authorized: true,
    redacted: true,
    excerpt: "Packaging damaged",
    provenance: "Synthetic fixture",
    theme: "packaging",
    observedAt: timestamp(-1),
    expiresAt: timestamp(10),
  });
  customers.reviewEvidence({
    ...evidence,
    status: "VERIFIED",
    note: "Fixture",
  });
  const document = customers.document({
    kind: "INSIGHT",
    title: "Synthetic insight",
    sourceIds: [evidence.id],
    confidence: 0.3,
    observed: "Synthetic packaging observation",
    inferred: "Packaging may matter",
    limitations: "One fixture",
    recommendation: "Research packaging",
  });
  const learning = new LearningService(f.db, f.p);
  const input = {
    requestKey: "learning-key",
    title: "Synthetic lesson",
    campaignId: campaign.id,
    customerDocumentId: document.id,
    relevanceConfirmed: true,
    confidence: 0.3,
    reviewAt: timestamp(5),
    ...Object.fromEntries(learningFields.map((k) => [k, "Synthetic " + k])),
  };
  return { ...f, customers, evidence, document, learning, input };
}
const approveLesson = (
  f: Awaited<ReturnType<typeof learningFixture>>,
  r: { id: string },
) => {
  const exact = {
    ...r,
    contentHash: f.learning.row(r.id).content_hash,
    confirm: true,
  };
  f.learning.approve(exact);
  return exact;
};
test("closed loop preserves actual lineage and descriptive results, promotes once and links new research", async () => {
  const f = await learningFixture();
  try {
    const r = f.learning.propose(f.input);
    assert.deepEqual(f.learning.propose(f.input), r);
    assert.throws(
      () => f.learning.propose({ ...f.input, title: "Changed" }),
      /Request key/,
    );
    const snapshot = learningState(f.db, f.p.company_id).cycles[0].body;
    assert.equal(snapshot.evidence.product.id, f.proposal.id);
    assert.equal(snapshot.evidence.results.a.rate, null);
    assert.equal(snapshot.evidence.results.roas, null);
    assert.equal(snapshot.evidence.simulation, true);
    assert.match(snapshot.evidence.publishing, /UNAVAILABLE/);
    assert.throws(
      () => f.learning.promote({ ...r, confirm: true }),
      /approval/,
    );
    assert.throws(
      () => f.learning.approve({ ...r, contentHash: "wrong", confirm: true }),
      /Exact/,
    );
    const exact = approveLesson(f, r),
      out = f.learning.promote(exact);
    assert.equal(out.externalAction, false);
    assert.throws(() => f.learning.promote(exact), /single-use/);
    const state = new CompanyService(f.db, f.p).state();
    assert.equal(state.memory[0].status, "NEEDS VERIFICATION");
    assert.equal(
      f.db
        .prepare("SELECT classification FROM memory_items WHERE company_id=?")
        .get(f.p.company_id)!.classification,
      "HYPOTHESIS",
    );
    assert.match(String(state.memory[0].body), /SIMULATION/);
    assert.equal(state.research.length, 1);
    assert.throws(
      () => f.db.prepare("UPDATE learning_cycles SET body='{}'").run(),
      /immutable/,
    );
    assert.throws(
      () =>
        f.learning.followup({
          ...r,
          opportunityId: snapshot.evidence.opportunity.id,
          note: "Old",
        }),
      /after handoff/,
    );
    const next = f.r.opportunity({
      title: "Follow-up synthetic study",
      sourceIds: snapshot.evidence.sourceIds,
      confidence: 0.2,
      ...Object.fromEntries(
        opportunityFields.map((k) => [k, "Synthetic " + k]),
      ),
    });
    f.learning.followup({
      ...r,
      opportunityId: next.id,
      note: "Test the proposed packaging hypothesis",
    });
    assert.equal(learningState(f.db, f.p.company_id).followups.length, 1);
    assert.throws(
      () =>
        f.learning.followup({ ...r, opportunityId: next.id, note: "Replay" }),
      /already/,
    );
  } finally {
    f.db.close();
  }
});
test("closed loop rechecks evidence at approval and promotion; withdrawal hides downstream memory", async () => {
  const f = await learningFixture();
  try {
    const r = f.learning.propose(f.input),
      exact = approveLesson(f, r);
    f.learning.promote(exact);
    f.customers.withdraw(f.evidence);
    assert.equal(learningState(f.db, f.p.company_id).cycles[0].body, null);
    const state = new CompanyService(f.db, f.p).state();
    assert.equal(state.memory[0].status, "STALE");
    assert.match(String(state.memory[0].body), /Unavailable/);
    assert.match(String(state.research[0].body), /Unavailable/);
    assert.throws(
      () => f.learning.propose({ ...f.input, requestKey: "new" }),
      /customer document/,
    );
  } finally {
    f.db.close();
  }
  const g = await learningFixture();
  try {
    const r = g.learning.propose(g.input),
      exact = approveLesson(g, r);
    g.customers.reviewEvidence({
      ...g.evidence,
      status: "DISPUTED",
      note: "Disputed fixture",
    });
    assert.throws(() => g.learning.promote(exact), /customer document/);
    assert.equal(new CompanyService(g.db, g.p).state().memory.length, 0);
  } finally {
    g.db.close();
  }
});
test("closed loop is scoped, paused, hold-blocked and cancellation remains available", async () => {
  const f = await learningFixture();
  try {
    const other = provision(
        f.db,
        "other-learning@example.test",
        "other-learning-password",
        "Other",
      ),
      service = new LearningService(f.db, {
        id: other.user,
        company_id: other.company,
        role: "CEO",
      });
    assert.throws(() => service.propose(f.input), /Completed campaign/);
    const r = f.learning.propose(f.input),
      exact = approveLesson(f, r);
    assert.throws(() => service.approve(exact), /not found/);
    new ComplianceService(f.db, f.p).hold({
      category: "SECURITY",
      reason: "Synthetic hold",
    });
    assert.equal(f.learning.row(r.id).expires_at, 0);
    assert.throws(() => f.learning.promote(exact), /Compliance hold/);
    f.learning.cancel(r);
    assert.equal(f.learning.row(r.id).status, "CANCELLED");
    assert.throws(
      () => new LearningService(f.db, { ...f.p, id: "maria" }),
      /Authenticated/,
    );
  } finally {
    f.db.close();
  }
});
test("closed loop rejects mixed evidence, expired approval, personal data and rolls back atomic handoff", async () => {
  const f = await learningFixture();
  try {
    assert.throws(
      () => f.learning.propose({ ...f.input, observed: "person@example.test" }),
      /Privacy/,
    );
    assert.throws(
      () => f.learning.propose({ ...f.input, relevanceConfirmed: false }),
      /relevance/,
    );
    const e = f.customers.capture({
      requestKey: "real-evidence",
      title: "Human fixture",
      kind: "COMPLAINT",
      simulation: false,
      authorized: true,
      redacted: true,
      excerpt: "Packaging damaged",
      provenance: "Human fixture",
      theme: "packaging",
      observedAt: timestamp(-1),
      expiresAt: timestamp(10),
    });
    f.customers.reviewEvidence({ ...e, status: "VERIFIED", note: "Fixture" });
    const d = f.customers.document({
      kind: "INSIGHT",
      title: "Human insight fixture",
      sourceIds: [e.id],
      confidence: 0.3,
      observed: "Packaging observation",
      inferred: "Packaging may matter",
      limitations: "Fixture",
      recommendation: "Research packaging",
    });
    assert.throws(
      () => f.learning.propose({ ...f.input, customerDocumentId: d.id }),
      /mix/,
    );
    const r = f.learning.propose(f.input),
      exact = approveLesson(f, r);
    f.db
      .prepare("UPDATE learning_cycles SET expires_at=0 WHERE id=?")
      .run(r.id);
    assert.throws(() => f.learning.promote(exact), /unexpired/);
    approveLesson(f, r);
    f.db.exec(
      "CREATE TRIGGER fail_learning_audit BEFORE INSERT ON audit_logs WHEN NEW.action='learning.research_queued' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
    );
    assert.throws(() => f.learning.promote(exact), /audit failure/);
    assert.equal(f.learning.row(r.id).consumed_at, null);
    assert.equal(new CompanyService(f.db, f.p).state().memory.length, 0);
    assert.equal(new CompanyService(f.db, f.p).state().research.length, 0);
    f.db.exec("DROP TRIGGER fail_learning_audit");
    f.learning.promote(exact);
  } finally {
    f.db.close();
  }
});

test("learning HTTP enforces auth/CSRF and supports explicit proposal, approval and research handoff", async () => {
  const f = await learningFixture(),
    origin = "http://127.0.0.1",
    server = createApp(f.db, origin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const post = (path: string, body: unknown, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("/api/learning/propose", f.input)).status, 401);
    const login = await post("/api/login", {
        email: "workflows@example.test",
        password: "long-workflows-test-password",
      }),
      session = (await login.json()) as { csrf: string },
      cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await post("/api/learning/propose", f.input, { Cookie: cookie })).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf },
      proposed = await post("/api/learning/propose", f.input, headers);
    assert.equal(proposed.status, 200);
    const r = (await proposed.json()) as { id: string },
      exact = {
        ...r,
        contentHash: f.learning.row(r.id).content_hash,
        confirm: true,
      };
    assert.equal(
      (await post("/api/learning/approve", exact, headers)).status,
      200,
    );
    assert.equal(
      (await post("/api/learning/promote", exact, headers)).status,
      200,
    );
    assert.equal(
      (await post("/api/learning/promote", exact, headers)).status,
      409,
    );
    assert.equal((await fetch(base + "/learning.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});

import {
  AutomationService,
  automationState,
  tickAutomation,
} from "../src/automation.ts";
test("automation creates only queued generation and local product/campaign drafts with downstream approvals intact", async () => {
  const f = await productFixture();
  try {
    const service = new AutomationService(f.db, f.p);
    const jobs = designState(f.db, f.p.company_id).jobs,
      briefId = f.db
        .prepare(
          "SELECT brief_id FROM generation_jobs WHERE company_id=? AND id=?",
        )
        .get(f.p.company_id, jobs[0].id)!.brief_id;
    const kinds = [
      [
        "GENERATION_QUEUE",
        { briefId, instruction: "Original synthetic geometric study" },
      ],
      ["PRODUCT_PROPOSAL", f.input],
      ["CAMPAIGN_DRAFT", plan(f)],
      ["UX_REVIEW", {}],
    ] as const;
    for (const [kind, payload] of kinds) {
      const r = service.create({
        title: "Synthetic " + kind,
        kind,
        payload,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: timestamp(2),
        intervalHours: 24,
        dailyLimit: 1,
        maxRuns: 1,
        budgetCents: 0,
        acknowledgeLimits: true,
        valueMetric: "One internal output",
        successCriterion: "Human reviews output",
      });
      const exact = {
        ...r,
        contentHash: service.row(r.id).content_hash,
        confirm: true,
      };
      service.approve(exact);
      service.enable(exact);
    }
    tickAutomation(f.db, f.p.company_id);
    const runs = automationState(f.db, f.p.company_id).runs;
    assert.equal(runs.length, 4);
    assert.ok(
      runs.every((r) => r.status === "SUCCEEDED"),
      JSON.stringify(runs),
    );
    assert.equal(
      designState(f.db, f.p.company_id).jobs.filter(
        (j) => j.status === "QUEUED",
      ).length,
      1,
    );
    assert.equal(
      productState(f.db, f.p.company_id).proposals.filter(
        (p) => p.status === "PROPOSED",
      ).length,
      2,
    );
    assert.equal(
      f.db
        .prepare("SELECT status FROM campaigns WHERE company_id=?")
        .get(f.p.company_id)!.status,
      "DRAFT",
    );
    assert.equal(f.calls(), 0);
  } finally {
    f.db.close();
  }
});

import {
  organizationMetrics,
  OrganizationService,
  organizationState,
} from "../src/organization.ts";
test("organization metrics keep simulation separate, require cost coverage and preserve null campaign denominators", async () => {
  const f = await learningFixture();
  try {
    let m = organizationMetrics(f.db, f.p.company_id);
    assert.equal(m.design.find((d) => d.simulation)!.current.reviewed, 1);
    assert.equal(m.design.find((d) => !d.simulation)!.current.reviewed, 0);
    assert.equal(
      m.costs.find((c) => c.provider === "SIMULATION")!.reportedActualCents,
      null,
    );
    assert.equal(m.campaign[0].a.rate, null);
    assert.equal(m.campaign[0].roas, null);
    assert.equal(m.campaign[0].simulation, true);
    const job = designState(f.db, f.p.company_id).jobs.find(
      (j) => j.status === "SUCCEEDED",
    )!;
    f.d.reconcile({
      id: job.id,
      actualCents: 0,
      evidence: "Synthetic zero spend",
    });
    m = organizationMetrics(f.db, f.p.company_id);
    assert.equal(
      m.costs.find((c) => c.provider === "SIMULATION")!.reportedActualCents,
      0,
    );
    assert.equal(
      m.costs.find((c) => c.provider === "SIMULATION")!
        .costPerSuccessfulOutputCents,
      0,
    );
    const org = new OrganizationService(f.db, f.p);
    org.report({ windowDays: 30 });
    const saved = organizationState(f.db, f.p.company_id).reports[0].body;
    assert.equal(saved.campaign[0].campaignId, f.input.campaignId);
  } finally {
    f.db.close();
  }
});
test("QA period comparisons require adequate samples and recommend investigation without causal attribution", async () => {
  const f = await productFixture(true);
  try {
    // Historical metric fixtures clone metadata directly; they do not claim actual provider runs or QA.
    const job = f.db
        .prepare("SELECT * FROM generation_jobs WHERE company_id=?")
        .get(f.p.company_id)!,
      asset = f.db
        .prepare("SELECT * FROM design_assets WHERE company_id=?")
        .get(f.p.company_id)!,
      qa = f.db
        .prepare("SELECT * FROM design_reviews WHERE company_id=?")
        .get(f.p.company_id)!;
    const clone = (
      table: string,
      row: Record<string, any>,
      override: Record<string, any>,
    ) => {
      const v = { ...row, ...override },
        keys = Object.keys(v);
      f.db
        .prepare(
          `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        )
        .run(...Object.values(v));
    };
    for (let i = 1; i <= 9; i++) {
      const prior = i >= 5,
        created_at = timestamp(prior ? -40 : -2),
        jid = "metric-job-" + i,
        aid = "metric-asset-" + i;
      clone("generation_jobs", job, {
        id: jid,
        request_key: jid,
        version: i + 1,
        created_at,
      });
      clone("design_assets", asset, {
        id: aid,
        job_id: jid,
        version: i + 1,
        created_at,
      });
      clone("design_reviews", qa, {
        id: "metric-qa-" + i,
        asset_id: aid,
        verdict: prior
          ? i === 9
            ? "REJECT"
            : "PASS"
          : i === 1
            ? "PASS"
            : "REVISE",
        created_at,
      });
    }
    const m = organizationMetrics(f.db, f.p.company_id, 30),
      d = m.design.find((x) => !x.simulation)!;
    assert.equal(d.current.reviewed, 5);
    assert.equal(d.previous.reviewed, 5);
    assert.equal(d.current.passRate, 0.4);
    assert.equal(d.previous.passRate, 0.8);
    assert.equal(d.changePercentagePoints, -40);
    assert.ok(m.recommendations.some((r) => r.id === "design-review-false"));
    assert.match(d.comparisonNote, /No causal/);
    assert.equal(
      m.design.find((x) => x.simulation)!.changePercentagePoints,
      null,
    );
    assert.ok(m.repeatedInstructions.length > 0);
    assert.equal(m.activity.excessiveToolUsage, null);
  } finally {
    f.db.close();
  }
});
