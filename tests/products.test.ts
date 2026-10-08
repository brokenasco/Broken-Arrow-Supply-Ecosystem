import test from "node:test";
import { imageAccountingFixture } from "./image-accounting-fixture.ts";
import { QuarantineService } from "../src/quarantine.ts";
import { randomUUID } from "node:crypto";
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
    writer,
    proposal,
    input,
    approve,
    calls: () => calls,
    lose: () => {
      lose = true;
    },
  };
}
test("product simulation has exact pricing, immutable payload, safe proof and single-use approval", async () => {
  const f = await productFixture();
  try {
    const row = productState(f.db, f.p.company_id).proposals[0];
    assert.equal(row.payload.input.variants[0].price, "20.00");
    assert.equal(row.payload.input.status, "DRAFT");
    assert.match(row.payload.input.descriptionHtml, /&lt;script&gt;/);
    assert.match(f.products.mockup(f.proposal.id), /SIMULATION/);
    assert.deepEqual(f.products.proposal(f.input), f.proposal);
    assert.throws(
      () => f.products.proposal({ ...f.input, title: "Changed" }),
      /Request key/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE product_proposals SET title=? WHERE id=?")
          .run("Changed", f.proposal.id),
      /immutable/,
    );
    await assert.rejects(f.products.dispatch(f.proposal), /approval/);
    f.approve();
    assert.equal((await f.products.dispatch(f.proposal)).status, "SIMULATED");
    await assert.rejects(f.products.dispatch(f.proposal), /approval/);
    assert.equal(f.calls(), 0);
  } finally {
    f.db.close();
  }
});
test("simulation assets cannot enter Shopify and foreign principals cannot read proofs", async () => {
  const f = await productFixture();
  try {
    assert.throws(
      () =>
        f.products.proposal({
          ...f.input,
          requestKey: "other",
          mode: "SHOPIFY",
        }),
      /real asset/,
    );
    const other = provision(
      f.db,
      "other@example.test",
      "other-test-password-123",
      "Other",
    );
    const p = new ProductService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    assert.throws(() => p.mockup(f.proposal.id), /not found/);
    f.approve();
    f.db
      .prepare("UPDATE product_proposals SET expires_at=0 WHERE id=?")
      .run(f.proposal.id);
    await assert.rejects(f.products.dispatch(f.proposal), /approval/);
  } finally {
    f.db.close();
  }
});
test("Shopify draft dispatch occurs once and lost response reconciles without retry", async () => {
  const f = await productFixture(true);
  try {
    f.approve();
    f.lose();
    await assert.rejects(f.products.dispatch(f.proposal), /reconciliation/);
    assert.equal(f.calls(), 1);
    assert.equal(
      productState(f.db, f.p.company_id).proposals[0].status,
      "RECONCILIATION",
    );
    await assert.rejects(f.products.dispatch(f.proposal), /approval/);
    assert.equal((await f.products.reconcile(f.proposal)).verified, true);
    assert.equal(f.calls(), 1);
  } finally {
    f.db.close();
  }
});
test("quarantine during Shopify preflight blocks subsequent requests; accepted write remains recorded", async () => {
  const f = await productFixture(true);
  try {
    let finish!: () => void;
    const wait = new Promise<void>((r) => (finish = r));
    const original = f.writer.identity;
    let lookups = 0;
    f.writer.identity = async (signal) => {
      await wait;
      return original(signal);
    };
    f.writer.lookup = async () => {
      lookups++;
      return null;
    };
    f.approve();
    const run = f.products.dispatch(f.proposal),
      q = new QuarantineService(f.db, f.p),
      holdId = randomUUID();
    q.hold({
      agent: "tyler",
      requestId: holdId,
      reason: "Mock preflight hold",
      confirm: true,
    });
    finish();
    await assert.rejects(run, /preflight/);
    assert.equal(f.calls(), 0);
    assert.equal(lookups, 0);
    q.release({ holdId, reason: "Preflight stopped", confirm: true });
  } finally {
    f.db.close();
  }
  const f2 = await productFixture(true);
  try {
    const create = f2.writer.create,
      q = new QuarantineService(f2.db, f2.p),
      holdId = randomUUID();
    f2.writer.create = async (input, signal) => {
      q.hold({
        agent: "tyler",
        requestId: holdId,
        reason: "Mock already dispatched hold",
        confirm: true,
      });
      return create(input, signal);
    };
    f2.approve();
    assert.equal(
      (await f2.products.dispatch(f2.proposal)).status,
      "DRAFT_CREATED",
    );
    assert.equal(f2.calls(), 1);
    q.release({
      holdId,
      reason: "Receipt confirmed, no replay",
      confirm: true,
    });
    await assert.rejects(f2.products.dispatch(f2.proposal), /approval/);
    assert.equal(f2.calls(), 1);
  } finally {
    f2.db.close();
  }
});
test("disconnect invalidates pending write approval and excess scopes are rejected", async () => {
  const f = await productFixture(true);
  try {
    f.approve();
    f.products.disconnect();
    await assert.rejects(
      f.products.dispatch(f.proposal),
      /authorization changed/,
    );
    assert.equal(f.calls(), 0);
    assert.throws(() =>
      validateIdentity(
        {
          domain: "fixture.myshopify.com",
          currency: "USD",
          scopes: ["write_products", "write_orders"],
        },
        "fixture.myshopify.com",
      ),
    );
    assert.equal(decimal(123, "JPY"), "123");
    assert.equal(decimal(1234, "KWD"), "1.234");
  } finally {
    f.db.close();
  }
});

test("product approvals roll back with audit failure and stop blocks dispatch", async () => {
  const f = await productFixture();
  try {
    f.db.exec(
      "CREATE TRIGGER fail_product_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    assert.throws(() => f.approve(), /audit unavailable/);
    assert.equal(
      productState(f.db, f.p.company_id).proposals[0].status,
      "PROPOSED",
    );
    f.db.exec("DROP TRIGGER fail_product_audit");
    f.approve();
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    await assert.rejects(f.products.dispatch(f.proposal), /paused/);
    assert.equal(f.calls(), 0);
  } finally {
    f.db.close();
  }
});
test("product HTTP routes protect proofs and mutations and serve the factory UI", async () => {
  const f = await productFixture();
  const origin = "http://127.0.0.1";
  const server = createApp(f.db, origin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    assert.equal(
      (await fetch(base + "/api/products/mockup/" + f.proposal.id)).status,
      401,
    );
    assert.equal((await fetch(base + "/products.js")).status, 200);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "workflows@example.test",
        password: "long-workflows-test-password",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const proof = await fetch(base + "/api/products/mockup/" + f.proposal.id, {
      headers: { Cookie: cookie },
    });
    assert.equal(proof.status, 200);
    assert.match(proof.headers.get("content-type")!, /image\/svg\+xml/);
    assert.equal(proof.headers.get("cache-control"), "no-store");
    assert.match(await proof.text(), /SIMULATION/);
    assert.equal(
      (
        await fetch(base + "/api/products/cancel", {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(f.proposal),
        })
      ).status,
      403,
    );
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
