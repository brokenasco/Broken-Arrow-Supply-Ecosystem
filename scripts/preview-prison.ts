// In-memory simulation only; does not read operational credentials or databases.
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { createApp } from "../src/server.ts";
const db = openDatabase(":memory:");
provision(
  db,
  "preview@example.test",
  "synthetic-preview-password",
  "SIMULATION · Prison preview",
);
const port = Number(process.env.PREVIEW_PORT ?? 3118);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid preview port");
createApp(db, `http://127.0.0.1:${port}`).listen(port, "127.0.0.1", () =>
  console.log(`SIMULATION http://127.0.0.1:${port}`),
);
