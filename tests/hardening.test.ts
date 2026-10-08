import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { createApp } from "../src/server.ts";

test("bounded concurrent HTTP smoke load preserves headers and denies unauthenticated state", async () => {
  const db = openDatabase(":memory:"),
    app = createApp(db, "http://127.0.0.1");
  assert.equal(app.requestTimeout, 30000);
  assert.equal(app.headersTimeout, 10000);
  assert.equal(app.maxRequestsPerSocket, 100);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (let batch = 0; batch < 5; batch++) {
      await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          const response = await fetch(
            base + (i % 2 ? "/health" : "/api/state"),
          );
          assert.equal(response.status, i % 2 ? 200 : 401);
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.equal(
            response.headers.get("x-content-type-options"),
            "nosniff",
          );
          const body = await response.json();
          if (i % 2) assert.equal(body.productionReady, false);
        }),
      );
    }
    const oversized = await fetch(base + "/health", {
      headers: { "x-large": "a".repeat(20000) },
    });
    assert.equal(oversized.status, 431);
    await oversized.text();
  } finally {
    app.close();
    await once(app, "close");
    db.close();
  }
});
