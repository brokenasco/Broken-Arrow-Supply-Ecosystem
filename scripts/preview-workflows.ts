// Explicit synthetic local preview. Never opens or resets the real company database.
import { existsSync } from "node:fs";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { ResearchService, opportunityFields } from "../src/research.ts";
import { DesignService, briefFields } from "../src/design.ts";
const path = "data/workflow-preview.sqlite";
if (existsSync(path))
  throw new Error("Preview already exists; preserved without modification.");
const db = openDatabase(path);
try {
  const u = provision(
    db,
    "workflow-preview@example.test",
    "workflow-preview-only-2026",
    "SIMULATION · Research & Design Preview",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" },
    r = new ResearchService(db, p),
    d = new DesignService(db, p);
  const at = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString();
  const source = r.source({
    title: "SIMULATION · geometric poster concept study",
    kind: "DESIGN",
    publisher: "Synthetic preview fixture",
    url: "https://example.invalid/synthetic-study",
    excerpt:
      "Synthetic illustration of a source record. No survey, competitor scan or market validation was performed.",
    publishedAt: at(-3),
    retrievedAt: at(-2),
    expiresAt: at(30),
  });
  r.verify({
    id: source.id,
    status: "VERIFIED",
    note: "Verified only as a synthetic software-test fixture. Not real market evidence.",
  });
  const o = r.opportunity({
    title: "SIMULATION · original geometric poster",
    sourceIds: [source.id],
    confidence: 0.1,
    ...Object.fromEntries(
      opportunityFields.map((k) => [
        k,
        "Unknown. Synthetic demonstration; no commercial conclusion.",
      ]),
    ),
  });
  for (const stage of ["MARISHA", "ALEX", "BORIS", "READY"])
    r.handoff({
      id: o.id,
      stage,
      note: "Synthetic test handoff recorded by the preview CEO.",
    });
  const b = d.brief({
    opportunityId: o.id,
    title: "SIMULATION · geometric composition",
    confidence: 0.1,
    ...Object.fromEntries(
      briefFields.map((k) => [
        k,
        k === "productCategory"
          ? "poster"
          : "Original geometry for a software test. No copied artwork or commercial claims.",
      ]),
    ),
  });
  d.configure({
    provider: "SIMULATION",
    dailyLimit: 10,
    budgetCents: 0,
    reservationCents: 0,
    maxIterations: 3,
    categories: ["poster"],
  });
  d.enqueue({
    briefId: b.id,
    instruction:
      "SIMULATION: create a local test pattern to verify queue, storage and QA.",
    requestKey: "preview-first-design",
  });
  console.log(
    "Synthetic preview prepared: " +
      path +
      ". Use workflow-preview@example.test / workflow-preview-only-2026 on port 3102.",
  );
} finally {
  db.close();
}
