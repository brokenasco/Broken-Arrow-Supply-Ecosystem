import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
const db = openDatabase(process.env.DATABASE_PATH ?? "data/company.sqlite");
try {
  if (db.prepare("SELECT id FROM users LIMIT 1").get())
    throw new Error(
      "CEO already provisioned. Setup will not replace existing credentials.",
    );
  const name = await rl.question("Company name: "),
    email = await rl.question("CEO email: ");
  process.stdout.write("CEO password (14+ characters, hidden): ");
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  provision(db, email, password, name);
  console.log("Company created in DEMO mode. Run npm start and sign in.");
} catch (e) {
  muted = false;
  console.error(e instanceof Error ? e.message : "Setup failed");
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
