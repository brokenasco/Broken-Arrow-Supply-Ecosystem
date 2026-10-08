// Explicitly isolated synthetic UI fixture; never opens a saved company database.
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { createApp } from "../src/server.ts";
import { ExecutiveReportService } from "../src/executive-reports.ts";
const db = openDatabase(":memory:");
const u = provision(
  db,
  "preview@example.test",
  "synthetic-preview-password",
  "SIMULATION Executive Reports",
);
const service = new ExecutiveReportService(db, {
  id: u.user,
  company_id: u.company,
  role: "CEO",
});
service.clock = () => new Date("2026-10-07T00:00:00Z");
service.close({ period: "2026-09" });
service.close({ period: "2026-Q3" });
const server = createApp(db, "http://127.0.0.1:3117");
server.listen(3117, "127.0.0.1", () =>
  console.log("SIMULATION preview at http://127.0.0.1:3117"),
);
process.on("SIGINT", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
