// Child process used only by synthetic concurrency tests.
import { openDatabase, id } from "../src/db.ts";
import { QuarantineService } from "../src/quarantine.ts";
const [path, company, user] = process.argv.slice(2);
const db = openDatabase(path);
process.send?.("READY");
process.once("message", () => {
  try {
    new QuarantineService(db, {
      id: user,
      company_id: company,
      role: "CEO",
    }).hold({
      agent: "anna",
      requestId: id(),
      reason: "Concurrent fixture hold",
      confirm: true,
    });
    process.send?.("HELD");
  } catch {
    process.send?.("DENIED");
  } finally {
    db.close();
    process.disconnect?.();
  }
});
