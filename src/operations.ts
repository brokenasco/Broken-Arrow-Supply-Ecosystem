import type { DatabaseSync } from "node:sqlite";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { HumanWorkflow, field, choice } from "./workflow.ts";
import { id, now, transaction, audit } from "./db.ts";
import { DomainError } from "./policy.ts";
import { domain, API_VERSION } from "./shopify/client.ts";
export const operationTopics = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "fulfillments/create",
  "fulfillments/update",
  "inventory_levels/update",
  "refunds/create",
  "products/create",
  "products/update",
  "products/delete",
] as const;
export type OperationsConfig = {
  companyId: string;
  domain: string;
  secret: string;
};
export const operationsConfig = (): OperationsConfig | null =>
  process.env.SHOPIFY_WEBHOOK_COMPANY_ID &&
  process.env.SHOPIFY_WEBHOOK_DOMAIN &&
  process.env.SHOPIFY_WEBHOOK_SECRET
    ? {
        companyId: process.env.SHOPIFY_WEBHOOK_COMPANY_ID,
        domain: domain(process.env.SHOPIFY_WEBHOOK_DOMAIN),
        secret: process.env.SHOPIFY_WEBHOOK_SECRET,
      }
    : null;
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function resource(value: unknown) {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new DomainError("Resource ID must be lossless");
  const s = String(value ?? "");
  if (!/^[1-9]\d{0,24}$/.test(s))
    throw new DomainError("Valid resource identifier required");
  return s;
}
export function normalizeEvent(
  topic: string,
  raw: Buffer,
  triggeredAt: string,
) {
  if (!operationTopics.includes(topic as any))
    throw new DomainError("Unsupported webhook topic");
  let p: any;
  try {
    p = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new DomainError("Invalid webhook JSON");
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new DomainError("Webhook object required");
  const time = p.updated_at ?? p.created_at ?? triggeredAt;
  if (
    typeof time !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(time) ||
    !Number.isFinite(Date.parse(time)) ||
    Date.parse(time) > Date.now() + 300000
  )
    throw new DomainError("Valid event timestamp required");
  const observedAt = new Date(time).toISOString();
  if (topic === "inventory_levels/update") {
    const item = resource(p.inventory_item_id),
      location = resource(p.location_id);
    if (
      p.available !== null &&
      (!Number.isSafeInteger(p.available) || Math.abs(p.available) > 1000000000)
    )
      throw new DomainError("Inventory available must be integer or null");
    return {
      entity: "inventory:" + item + ":" + location,
      resourceId: item,
      location,
      available: p.available,
      observedAt,
    };
  }
  const resourceId = resource(p.id),
    family = topic.split("/")[0];
  let status = "UNKNOWN";
  if (family === "fulfillments")
    status = choice(
      p.status,
      ["pending", "open", "success", "cancelled", "error", "failure"],
      "Fulfillment status",
    );
  if (family === "orders")
    status =
      topic === "orders/cancelled"
        ? "cancelled"
        : p.cancelled_at
          ? "cancelled"
          : "updated";
  if (family === "products")
    status =
      topic === "products/delete"
        ? "deleted"
        : choice(p.status, ["active", "archived", "draft"], "Product status");
  return { entity: family + ":" + resourceId, resourceId, status, observedAt };
}
export function operationsState(db: DatabaseSync, company: string) {
  return {
    topics: operationTopics,
    connection:
      db
        .prepare("SELECT * FROM operations_connections WHERE company_id=?")
        .get(company) ?? null,
    events: db
      .prepare(
        "SELECT * FROM operations_events WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => ({
        ...r,
        id: String(r.id),
        event_id: String(r.event_id),
        status: String(r.status),
        body: JSON.parse(String(r.body)),
      })),
    alerts: db
      .prepare(
        "SELECT a.*,e.simulation,e.topic,e.domain FROM operations_alerts a JOIN operations_events e ON e.company_id=a.company_id AND e.id=a.event_id WHERE a.company_id=? ORDER BY a.created_at DESC",
      )
      .all(company),
    incidents: db
      .prepare(
        "SELECT * FROM operations_incidents WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
  };
}
function insertEvent(
  db: DatabaseSync,
  company: string,
  shop: string,
  eventId: string,
  topic: string,
  bodyHash: string,
  body: object,
  simulation: boolean,
  actor: string,
) {
  const previous = db
    .prepare(
      "SELECT id,body_hash FROM operations_events WHERE company_id=? AND domain=? AND event_id=? AND topic=? AND simulation=?",
    )
    .get(company, shop, eventId, topic, simulation ? 1 : 0);
  if (previous) {
    if (previous.body_hash !== bodyHash)
      throw new DomainError("Event identifier conflicts with prior body", 409);
    return { id: String(previous.id), duplicate: true };
  }
  const record = id();
  db.prepare(
    "INSERT INTO operations_events VALUES(?,?,?,?,?,?,?,?,'RECEIVED',?)",
  ).run(
    record,
    company,
    shop,
    eventId,
    topic,
    bodyHash,
    JSON.stringify(body),
    simulation ? 1 : 0,
    now(),
  );
  audit(db, company, actor, "operations.event_received", record, "SUCCESS", {
    topic,
    simulation,
  });
  return { id: record, duplicate: false };
}
export function receiveOperationsWebhook(
  db: DatabaseSync,
  raw: Buffer,
  headers: Record<string, string>,
  config: OperationsConfig | null = operationsConfig(),
) {
  if (!config) throw new DomainError("Webhook receiver not configured", 503);
  if (raw.length > 1024 * 1024) throw new DomainError("Webhook too large", 413);
  const signature = headers["x-shopify-hmac-sha256"] ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature))
    throw new DomainError("Invalid signature", 401);
  const actual = Buffer.from(signature, "base64"),
    expected = createHmac("sha256", config.secret).update(raw).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new DomainError("Invalid signature", 401);
  if (headers["x-shopify-shop-domain"] !== config.domain)
    throw new DomainError("Shop rejected", 403);
  if (headers["x-shopify-api-version"] !== API_VERSION)
    throw new DomainError("Webhook API version rejected", 409);
  const eventId = field(headers["x-shopify-event-id"], "Event ID", 100);
  if (!/^[a-zA-Z0-9-]+$/.test(eventId))
    throw new DomainError("Invalid event ID");
  const topic = field(headers["x-shopify-topic"], "Topic", 80);
  const body = normalizeEvent(topic, raw, headers["x-shopify-triggered-at"]);
  return transaction(db, () => {
    const connection = db
      .prepare(
        "SELECT c.* FROM operations_connections c JOIN users u ON u.id=c.authorized_by AND u.company_id=c.company_id AND u.role='CEO' WHERE c.company_id=? AND c.domain=? AND c.enabled=1",
      )
      .get(config.companyId, config.domain);
    if (!connection)
      throw new DomainError(
        "Human-authorized webhook connection required",
        403,
      );
    return insertEvent(
      db,
      config.companyId,
      config.domain,
      eventId,
      topic,
      hash(raw),
      body,
      false,
      "webhook:authorized-by:" + String(connection.authorized_by),
    );
  });
}
export class OperationsService extends HumanWorkflow {
  config: () => OperationsConfig | null = operationsConfig;
  authorize(input: Record<string, unknown>) {
    return this.mutate(
      "operations.webhooks_authorized",
      "operations",
      ["rachel", "sergey"],
      () => {
        const c = this.config();
        if (!c || c.companyId !== this.p.company_id)
          throw new DomainError(
            "INTEGRATION REQUIRED: company-pinned webhook configuration",
            409,
          );
        if (input.confirm !== true || input.domain !== c.domain)
          throw new DomainError("Confirm exact configured shop");
        this.db
          .prepare(
            "INSERT INTO operations_connections VALUES(?,?,1,?,?) ON CONFLICT(company_id) DO UPDATE SET domain=excluded.domain,enabled=1,authorized_by=excluded.authorized_by,created_at=excluded.created_at",
          )
          .run(this.p.company_id, c.domain, this.p.id, now());
        return { ok: true };
      },
    );
  }
  disconnect() {
    return transaction(this.db, () => {
      this.authenticate();
      this.db
        .prepare(
          "UPDATE operations_connections SET enabled=0 WHERE company_id=?",
        )
        .run(this.p.company_id);
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "operations.webhooks_disabled",
        "operations",
      );
      return { ok: true };
    });
  }
  simulate(input: Record<string, unknown>) {
    return this.mutate(
      "operations.simulation_created",
      "simulation",
      ["rachel", "sergey"],
      () => {
        const kind = choice(
          input.kind,
          [
            "LOW_INVENTORY",
            "FULFILLMENT_FAILURE",
            "CANCELLATION",
            "REFUND",
            "PRODUCT_CHANGE",
            "ORDER",
          ],
          "Scenario",
        );
        const mapping = {
          LOW_INVENTORY: {
            topic: "inventory_levels/update",
            body: { inventory_item_id: 1, location_id: 1, available: 2 },
          },
          FULFILLMENT_FAILURE: {
            topic: "fulfillments/update",
            body: { id: 2, status: "failure" },
          },
          CANCELLATION: { topic: "orders/cancelled", body: { id: 3 } },
          REFUND: { topic: "refunds/create", body: { id: 4 } },
          PRODUCT_CHANGE: {
            topic: "products/update",
            body: { id: 5, status: "draft" },
          },
          ORDER: { topic: "orders/create", body: { id: 6 } },
        }[kind];
        const raw = Buffer.from(
          JSON.stringify({ ...mapping.body, updated_at: now() }),
        );
        return insertEvent(
          this.db,
          this.p.company_id,
          "simulation.invalid",
          id(),
          mapping.topic,
          hash(raw),
          normalizeEvent(mapping.topic, raw, now()),
          true,
          this.p.id,
        );
      },
    );
  }
  process() {
    return this.mutate(
      "operations.inbox_processed",
      "operations",
      ["rachel", "sergey"],
      () => {
        const events = this.db
          .prepare(
            "SELECT * FROM operations_events WHERE company_id=? AND status='RECEIVED' ORDER BY created_at,id LIMIT 50",
          )
          .all(this.p.company_id);
        let count = 0;
        for (const event of events) {
          const b = JSON.parse(String(event.body));
          const previous = this.db
            .prepare(
              "SELECT observed_at FROM operations_latest WHERE company_id=? AND domain=? AND simulation=? AND entity=?",
            )
            .get(
              this.p.company_id,
              String(event.domain),
              Number(event.simulation),
              b.entity,
            );
          if (previous && String(previous.observed_at) > b.observedAt) {
            this.db
              .prepare(
                "UPDATE operations_events SET status='IGNORED_OLDER' WHERE company_id=? AND id=?",
              )
              .run(this.p.company_id, String(event.id));
            continue;
          }
          this.db
            .prepare(
              "INSERT INTO operations_latest VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,domain,simulation,entity) DO UPDATE SET observed_at=excluded.observed_at,event_id=excluded.event_id",
            )
            .run(
              this.p.company_id,
              String(event.domain),
              Number(event.simulation),
              b.entity,
              b.observedAt,
              String(event.id),
            );
          let kind = "EVENT_REVIEW",
            severity = "INFO",
            message = `${event.topic} received for ${b.resourceId}. Event observation only; refresh Shopify before action.`;
          if (
            event.topic === "inventory_levels/update" &&
            b.available !== null &&
            b.available <= 5
          ) {
            kind = "LOW_INVENTORY";
            severity = b.available <= 0 ? "HIGH" : "MEDIUM";
            message = `Observed inventory ${b.available} for item ${b.resourceId}, location ${b.location}; threshold ≤5. Verify current stock before action.`;
          } else if (
            String(event.topic).startsWith("fulfillments/") &&
            ["failure", "error"].includes(b.status)
          ) {
            kind = "FULFILLMENT_FAILURE";
            severity = "HIGH";
          } else if (
            event.topic === "orders/cancelled" ||
            b.status === "cancelled"
          ) {
            kind = "CANCELLATION";
            severity = "MEDIUM";
          } else if (event.topic === "refunds/create") {
            kind = "REFUND_REVIEW";
            severity = "MEDIUM";
          }
          this.db
            .prepare("INSERT INTO operations_alerts VALUES(?,?,?,?,?,?,?)")
            .run(
              id(),
              this.p.company_id,
              String(event.id),
              kind,
              severity,
              message,
              now(),
            );
          this.db
            .prepare(
              "UPDATE operations_events SET status='PROCESSED' WHERE company_id=? AND id=?",
            )
            .run(this.p.company_id, String(event.id));
          count++;
        }
        return { processed: count, examined: events.length };
      },
    );
  }
  incident(input: Record<string, unknown>) {
    return this.mutate(
      "operations.incident_opened",
      String(input.alertId),
      ["rachel", "sergey"],
      () => {
        const alert = field(input.alertId, "Alert", 80);
        if (
          !this.db
            .prepare(
              "SELECT id FROM operations_alerts WHERE company_id=? AND id=?",
            )
            .get(this.p.company_id, alert)
        )
          throw new DomainError("Alert not found", 404);
        if (
          this.db
            .prepare(
              "SELECT id FROM operations_incidents WHERE company_id=? AND alert_id=?",
            )
            .get(this.p.company_id, alert)
        )
          throw new DomainError("Alert already has an incident", 409);
        const record = id();
        this.db
          .prepare(
            "INSERT INTO operations_incidents VALUES(?,?,?,'OPEN','sergey',?,?,?)",
          )
          .run(
            record,
            this.p.company_id,
            alert,
            field(input.note, "Triage note", 2000),
            now(),
            now(),
          );
        return { id: record };
      },
    );
  }
  transition(input: Record<string, unknown>) {
    return this.mutate(
      "operations.incident_updated",
      String(input.id),
      ["rachel", "sergey"],
      () => {
        const record = field(input.id, "Incident", 80),
          r = this.db
            .prepare(
              "SELECT * FROM operations_incidents WHERE company_id=? AND id=?",
            )
            .get(this.p.company_id, record);
        if (!r) throw new DomainError("Incident not found", 404);
        if (r.status === "RESOLVED")
          throw new DomainError("Incident is terminal", 409);
        const status = choice(
            input.status,
            ["ESCALATED", "RESOLVED"],
            "Status",
          ),
          owner =
            status === "ESCALATED"
              ? choice(input.owner, ["rachel", "ceo"], "Escalation owner")
              : String(r.owner),
          note = field(input.note, "Escalation or resolution evidence", 2000);
        this.db
          .prepare(
            "UPDATE operations_incidents SET status=?,owner=?,note=?,updated_at=? WHERE company_id=? AND id=?",
          )
          .run(status, owner, note, now(), this.p.company_id, record);
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "operations.incident_evidence",
          record,
          "SUCCESS",
          { status, owner, note },
        );
        return { ok: true };
      },
    );
  }
}
