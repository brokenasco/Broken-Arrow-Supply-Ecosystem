import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { KnowledgeService } from "../src/knowledge.ts";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
const db = openDatabase(":memory:");
const p = provision(
  db,
  "skd-benchmark@example.test",
  "synthetic-benchmark-password",
  "SIMULATION benchmark",
);
const service = new KnowledgeService(db, {
  id: p.user,
  company_id: p.company,
  role: "CEO",
});
const queries = ["topic4999", "topic2345", "topic100", "bike"];
const expected: string[] = [];
db.exec("BEGIN");
for (let i = 0; i < 5000; i++) {
  const record = service.create({
    title: `Reference ${i}`,
    content:
      i === 0
        ? "Bicycle customer research supports commuter safety."
        : `Operational reference topic${i} historical measurement.`,
    summary: `Reference ${i}`,
    source: "Synthetic benchmark fixture",
    sourceType: "INTERNAL",
    agentId: "mason",
    scope: "AGENT_PRIVATE",
    knowledgeType: "RESEARCH",
    topic: "benchmark",
    reviewAt: "2030-01-01T00:00:00.000Z",
    confidence: 0.4,
  });
  expected[i] = record.id;
}
db.exec("COMMIT");
const expectedIds = [
  expected[4999],
  expected[2345],
  expected[100],
  expected[0],
];
const baseline = (q: string) =>
  db
    .prepare("SELECT * FROM memory_items WHERE company_id=?")
    .all(p.company)
    .filter((r) => (r.title + " " + r.body).toLowerCase().includes(q))
    .slice(0, 10);
const search = (q: string) =>
  service.search({
    query: q,
    agentId: "mason",
    maxResults: 10,
    maxTokens: 8000,
  }).results;
function measure(fn: (q: string) => Record<string, any>[]) {
  const timings: number[] = [],
    sizes: number[] = [];
  for (let i = 0; i < 60; i++) {
    const start = performance.now();
    const rows = fn(queries[i % 4]);
    if (i >= 10) {
      timings.push(performance.now() - start);
      sizes.push(Buffer.byteLength(JSON.stringify(rows)));
    }
  }
  timings.sort((a, b) => a - b);
  return {
    p50Ms: timings[24],
    p95Ms: timings[47],
    p99Ms: timings[49],
    meanContextBytes: sizes.reduce((a, b) => a + b, 0) / sizes.length,
    recallAt10:
      queries.filter((q, i) => fn(q).some((r) => r.id === expectedIds[i]))
        .length / queries.length,
  };
}
const report = {
  records: 5000,
  iterations: 50,
  baseline: measure(baseline),
  after: measure(search),
  embeddingCalls: 0,
  cache: "NONE",
  queries,
  expectedTitles: [
    "Reference 4999",
    "Reference 2345",
    "Reference 100",
    "Reference 0",
  ],
  method:
    "Same in-memory SQLite corpus, fixed four-query set, ten warmups. Full-row fetch plus substring filter versus scoped FTS/concept search including transactional telemetry and audit. No network, concurrent-load or production-scale claim. Limited dictionary synonym evaluation, not general semantic accuracy.",
  queryPlan: db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT m.id FROM skd_fts CROSS JOIN memory_items m ON m.rowid=skd_fts.rowid CROSS JOIN skd_metadata k ON k.company_id=m.company_id AND k.memory_id=m.id WHERE skd_fts MATCH ? AND m.company_id=? LIMIT 80",
    )
    .all('"topic4999"', p.company),
};
writeFileSync(
  "docs/SKD_BENCHMARK.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
db.close();
