import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hash } from "./auth.ts";
import { now, transaction, audit } from "./db.ts";
import { DomainError } from "./policy.ts";
// Infrastructure primitive only. No public webhook endpoint or Shopify subscription exists yet.
export function receiveWebhook(
  db: DatabaseSync,
  input: {
    company: string;
    store: string;
    eventId: string;
    raw: Buffer;
    signature: string;
    secret: string;
  },
) {
  const expected = createHmac("sha256", input.secret)
    .update(input.raw)
    .digest();
  const actual = Buffer.from(input.signature, "base64");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new DomainError("Invalid webhook signature", 401);
  if (!input.eventId || input.eventId.length > 200)
    throw new DomainError("Invalid event identifier");
  if (
    !db
      .prepare("SELECT id FROM stores WHERE company_id=? AND id=?")
      .get(input.company, input.store)
  )
    throw new DomainError("Unknown store", 403);
  return transaction(db, () => {
    const result = db
      .prepare(
        "INSERT OR IGNORE INTO webhook_events(company_id,store_id,event_id,body_hash,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        input.company,
        input.store,
        input.eventId,
        hash(input.raw.toString("base64")),
        now(),
      );
    if (result.changes)
      audit(db, input.company, "webhook", "webhook.received", input.eventId);
    return { duplicate: !result.changes, status: "RECEIVED" };
  });
}
