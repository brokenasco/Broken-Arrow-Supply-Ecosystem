// Synthetic export QA only. Never opens an operational database or calls a model.
import { mkdirSync, writeFileSync } from "node:fs";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { ExecutiveReportService } from "../src/executive-reports.ts";
import { MemoService } from "../src/memos.ts";
import { exportMemo } from "../src/memo-export.ts";
const db = openDatabase(":memory:");
try {
  const u = provision(
    db,
    "export-qa@example.test",
    "synthetic-export-password",
    "SIMULATION EXPORT QA",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  const reports = new ExecutiveReportService(db, p);
  reports.clock = () => new Date("2026-10-07T00:00:00Z");
  const records = reports.close({ period: "2026-Q3" }).memos;
  const memo =
    records.find(
      (m) => reports.evidence(m.id).evidence.department === "product",
    ) ?? records[0];
  mkdirSync("data/export-qa", { recursive: true });
  for (const format of ["docx", "pdf"]) {
    const out = await exportMemo(new MemoService(db, p), {
      id: memo.id,
      format,
    });
    writeFileSync(`data/export-qa/SIMULATION-memo.${format}`, out.bytes);
  }
  console.log("Synthetic exports written to data/export-qa");
} finally {
  db.close();
}
