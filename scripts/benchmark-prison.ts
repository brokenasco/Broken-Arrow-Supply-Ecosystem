import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { performance } from "node:perf_hooks";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { OfficeService } from "../src/office.ts";
const db = openDatabase(":memory:");
try {
  const u = provision(
    db,
    "benchmark@example.test",
    "synthetic-benchmark-password",
    "SIMULATION benchmark",
  );
  const d = new OfficeService(db, {
    id: u.user,
    company_id: u.company,
    role: "CEO",
  }).view();
  const source = readFileSync(
    new URL("../public/prison.js", import.meta.url),
    "utf8",
  );
  const render = runInNewContext(source + ";prisonScene", {
    esc: (v: unknown) =>
      String(v)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
  });
  for (let i = 0; i < 20; i++) render(d);
  const times: number[] = [];
  let output = "";
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    output = render(d);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scope:
        "Synthetic server-side HTML string generation; not browser paint or improvement claim",
      samples: times.length,
      agents: d.agents.length,
      p50Ms: times[99],
      p95Ms: times[189],
      p99Ms: times[197],
      htmlBytes: Buffer.byteLength(output),
      sourceBytes: Buffer.byteLength(source),
      modelCalls: 0,
    }),
  );
} finally {
  db.close();
}
