import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
const db = openDatabase(":memory:");
const p = provision(
  db,
  "benchmark@example.test",
  "benchmark-synthetic-password",
  "SIMULATION SKD benchmark",
);
const stmt = db.prepare(
  "INSERT INTO memory_items(id,company_id,title,body,classification,category,evidence,confidence,status,created_by,created_at,updated_at,review_at) VALUES(?,?,?,?,'OBSERVATION','benchmark','Synthetic benchmark fixture',0.5,'NEEDS VERIFICATION',?,?,?,?)",
);
const date = new Date().toISOString();
db.exec("BEGIN");
for (let i = 0; i < 5000; i++)
  stmt.run(
    `fixture-${i}`,
    p.company,
    `Reference ${i}`,
    i === 0
      ? "Bicycle customer research supports commuter safety."
      : `Operational reference topic${i} historical measurement.`,
    p.user,
    date,
    date,
    "2030-01-01T00:00:00.000Z",
  );
db.exec("COMMIT");
const queries = ["topic4999", "topic2345", "topic100", "bike"];
const expected = ["fixture-4999", "fixture-2345", "fixture-100", "fixture-0"];
function baseline(q: string) {
  return db
    .prepare("SELECT * FROM memory_items WHERE company_id=?")
    .all(p.company)
    .filter((r) => (r.title + " " + r.body).toLowerCase().includes(q))
    .slice(0, 10);
}
const timings: number[] = [];
for (let i = 0; i < 60; i++) {
  const start = performance.now();
  baseline(queries[i % 4]);
  if (i >= 10) timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const report = {
  records: 5000,
  iterations: 50,
  baseline: {
    p50Ms: timings[24],
    p95Ms: timings[47],
    p99Ms: timings[49],
    recallAt10:
      queries.filter((q, i) => baseline(q).some((r) => r.id === expected[i]))
        .length / queries.length,
  },
  embeddingCalls: 0,
  cache: "NONE",
  method:
    "SQLite in-memory; full-row fetch then browser-equivalent substring filtering; fixed 4-query relevance set including one synonym; not a production load benchmark",
};
writeFileSync("docs/SKD_BASELINE.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
db.close();
