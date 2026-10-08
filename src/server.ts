import { PasskeyService } from "./passkeys.ts";
import { AgentConfigurationService } from "./agent-configuration.ts";
import { TaskCoordinationService } from "./task-coordination.ts";
import {
  SecurityService,
  securityOverview,
  HibpProvider,
  tickSecurity,
} from "./security.ts";
import { ComplianceService } from "./compliance.ts";
import { OrganizationService } from "./organization.ts";
import {
  AutomationService,
  tickAutomation,
  startAutomationWorker,
} from "./automation.ts";
import { LearningService } from "./learning.ts";
import { KnowledgeService } from "./knowledge.ts";
import { ResourceService } from "./resources.ts";
import { MemoService } from "./memos.ts";
import { MemoGovernanceService } from "./memo-governance.ts";
import {
  ExecutiveReportService,
  tickExecutiveReports,
} from "./executive-reports.ts";
import { exportMemo } from "./memo-export.ts";
import { OfficeService } from "./office.ts";
import { QuarantineService } from "./quarantine.ts";
import { ExecutionControl } from "./execution-control.ts";
import {
  OperationsService,
  receiveOperationsWebhook,
  type OperationsConfig,
} from "./operations.ts";
import { TechnologyService } from "./technology.ts";
import { CustomerService } from "./customers.ts";
import { MarketingService } from "./marketing.ts";
import { ProductService, type ProductDependencies } from "./products.ts";
import { DesignService, type DesignDependencies } from "./design.ts";
import { ResearchService } from "./research.ts";
import { AnalyticsService } from "./analytics.ts";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, audit } from "./db.ts";
import { login, session, hash } from "./auth.ts";
import { CompanyService, text, type Principal } from "./service.ts";
import { DomainError } from "./policy.ts";
import { ShopifyService, type ShopifyDependencies } from "./shopify/service.ts";
export function createApp(
  db: DatabaseSync,
  origin: string,
  secure = false,
  shopifyDependencies: ShopifyDependencies = {},
  designDependencies: DesignDependencies = {},
  productDependencies: ProductDependencies = {},
  webhookConfig?: OperationsConfig | null,
) {
  const attempts = new Map<string, { count: number; until: number }>();
  const knowledgeLimits = new Map<string, { count: number; until: number }>();
  const resourceLimits = new Map<string, { count: number; until: number }>();
  const app = createServer(
    {
      requestTimeout: 30000,
      headersTimeout: 10000,
      keepAliveTimeout: 5000,
      maxHeaderSize: 16384,
    },
    async (req, res) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      };
      if (secure) headers["Strict-Transport-Security"] = "max-age=31536000";
      const send = (
        status: number,
        data: unknown,
        extra: Record<string, string> = {},
      ) => {
        res.writeHead(status, { ...headers, ...extra });
        res.end(JSON.stringify(data));
      };
      let principal: any;
      try {
        const path = new URL(req.url ?? "/", origin).pathname;
        if (
          req.method === "GET" &&
          [
            "/",
            "/app.js",
            "/workflows.js",
            "/products.js",
            "/marketing.js",
            "/customers.js",
            "/technology.js",
            "/operations.js",
            "/compliance.js",
            "/learning.js",
            "/knowledge.js",
            "/resources.js",
            "/memos.js",
            "/office.js",
            "/prison.js",
            "/prison.css",
            "/office.css",
            "/automation.js",
            "/organization.js",
            "/security.js",
            "/style.css",
          ].includes(path)
        ) {
          const file = path === "/" ? "index.html" : path.slice(1);
          res.writeHead(200, {
            ...headers,
            "Content-Type": file.endsWith(".html")
              ? "text/html; charset=utf-8"
              : file.endsWith(".css")
                ? "text/css; charset=utf-8"
                : "text/javascript; charset=utf-8",
          });
          res.end(readFileSync(new URL(`../public/${file}`, import.meta.url)));
          return;
        }
        if (path === "/health" && req.method === "GET") {
          send(200, {
            status: "ok",
            phase: "production-hardening",
            productionReady: false,
          });
          return;
        }
        if (path === "/webhooks/shopify" && req.method === "POST") {
          if (!req.headers["content-type"]?.startsWith("application/json"))
            throw new DomainError("JSON required", 415);
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 1024 * 1024)
              throw new DomainError("Webhook too large", 413);
            chunks.push(Buffer.from(chunk));
          }
          const names = [
            "x-shopify-hmac-sha256",
            "x-shopify-shop-domain",
            "x-shopify-api-version",
            "x-shopify-event-id",
            "x-shopify-topic",
            "x-shopify-triggered-at",
          ];
          const envelope: Record<string, string> = {};
          for (const name of names) {
            const value = req.headers[name];
            if (typeof value !== "string")
              throw new DomainError("Required webhook header missing");
            envelope[name] = value;
          }
          send(
            200,
            receiveOperationsWebhook(
              db,
              Buffer.concat(chunks),
              envelope,
              webhookConfig,
            ),
          );
          return;
        }
        if (!path.startsWith("/api/")) throw new DomainError("Not found", 404);
        if (!["GET", "POST"].includes(req.method ?? ""))
          throw new DomainError("Method not allowed", 405);
        if (req.method === "POST" && req.headers.origin !== origin)
          throw new DomainError("Origin rejected", 403);
        let body: Record<string, unknown> = {};
        if (req.method === "POST") {
          if (!req.headers["content-type"]?.startsWith("application/json"))
            throw new DomainError("JSON required", 415);
          let raw = "";
          for await (const chunk of req) {
            raw += chunk.toString();
            if (Buffer.byteLength(raw) > 32768)
              throw new DomainError("Request too large", 413);
          }
          try {
            body = JSON.parse(raw);
          } catch {
            throw new DomainError("Invalid JSON");
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new DomainError("JSON object required");
        }
        const cookie = (value: string) =>
          `company_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 28800 : 0}${secure ? "; Secure" : ""}`;
        if (path === "/api/login" && req.method === "POST") {
          const ip = req.socket.remoteAddress ?? "unknown",
            time = Date.now();
          for (const [key, value] of attempts)
            if (value.until < time) attempts.delete(key);
          const limit = attempts.get(ip) ?? {
            count: 0,
            until: time + 15 * 60 * 1000,
          };
          if (limit.count >= 10)
            throw new DomainError(
              "Too many attempts; try again in 15 minutes",
              429,
            );
          limit.count++;
          attempts.set(ip, limit);
          if (
            typeof body.password !== "string" ||
            !body.password.length ||
            body.password.length > 256
          )
            throw new DomainError("Password required (maximum 256 characters)");
          const result = login(
            db,
            text(body.email, "email", 254),
            body.password,
          );
          if (!result) throw new DomainError("Invalid email or password", 401);
          attempts.delete(ip);
          send(
            200,
            { csrf: result.csrf },
            { "Set-Cookie": cookie(result.token) },
          );
          return;
        }
        const token =
          (req.headers.cookie ?? "")
            .split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("company_session="))
            ?.slice(16) ?? "";
        principal = session(db, token);
        if (!principal) throw new DomainError("Sign in required", 401);
        if (
          req.method === "POST" &&
          req.headers["x-csrf-token"] !== principal.csrf
        )
          throw new DomainError("CSRF token rejected", 403);
        const service = new CompanyService(db, principal as Principal);
        if (path.startsWith("/api/memos/")) {
          const memos = new MemoService(db, principal);
          const reporting = new ExecutiveReportService(db, principal);
          if (req.method === "GET" && path === "/api/memos/reporting") {
            send(200, reporting.overview());
            return;
          }
          if (req.method === "GET" && path === "/api/memos/list") {
            send(
              200,
              memos.list(
                Object.fromEntries(new URL(req.url!, origin).searchParams),
              ),
            );
            return;
          }
          if (req.method !== "POST") throw new DomainError("Not found", 404);
          const key = "memo:" + principal.id,
            stamp = Date.now();
          for (const [k, v] of resourceLimits)
            if (v.until <= stamp) resourceLimits.delete(k);
          const limit = resourceLimits.get(key) || {
            count: 0,
            until: stamp + 60000,
          };
          if (limit.count >= 30)
            throw new DomainError("Memo request limit reached", 429);
          limit.count++;
          resourceLimits.set(key, limit);
          if (
            [
              "/api/memos/budget-propose",
              "/api/memos/budget-decision",
              "/api/memos/budget-proposal",
            ].includes(path)
          ) {
            const governance = new MemoGovernanceService(db, principal);
            send(
              200,
              path.endsWith("budget-propose")
                ? governance.propose(body)
                : path.endsWith("budget-decision")
                  ? governance.decide(body)
                  : governance.get(body.id),
            );
            return;
          }
          if (path === "/api/memos/export") {
            const file = await exportMemo(memos, body);
            res.writeHead(200, {
              ...headers,
              "Content-Type": file.mime,
              "Content-Disposition": `attachment; filename="${file.filename}"`,
            });
            res.end(file.bytes);
            return;
          }
          if (path === "/api/memos/close-period") {
            send(200, reporting.close(body));
            return;
          }
          if (path === "/api/memos/evidence") {
            send(200, reporting.evidence(body.id));
            return;
          }
          if (path === "/api/memos/evaluate") {
            send(200, reporting.evaluate(body));
            return;
          }
          if (path === "/api/memos/reporting-settings") {
            send(200, reporting.configure(body));
            return;
          }
          const output =
            path === "/api/memos/submit"
              ? memos.submit(body)
              : path === "/api/memos/review"
                ? memos.review(body)
                : path === "/api/memos/get"
                  ? memos.get(body.id)
                  : null;
          if (!output) throw new DomainError("Not found", 404);
          send(200, output);
          return;
        }
        if (path.startsWith("/api/office/")) {
          if (process.env.PIXEL_OFFICE_ENABLED === "false")
            throw new DomainError(
              "Pixel Office is disabled; use the classic dashboard",
              404,
            );
          const office = new OfficeService(db, principal);
          if (req.method === "GET" && path === "/api/office/state") {
            send(200, office.view());
            return;
          }
          if (req.method !== "POST") throw new DomainError("Not found", 404);
          const time = Date.now(),
            key = `office:${principal.id}`;
          for (const [k, v] of resourceLimits)
            if (v.until <= time) resourceLimits.delete(k);
          const limit = resourceLimits.get(key) ?? {
            count: 0,
            until: time + 60000,
          };
          if (limit.count >= 30)
            throw new DomainError(
              "Office action limit; try again in one minute",
              429,
            );
          limit.count++;
          resourceLimits.set(key, limit);
          let output: unknown;
          if (path === "/api/office/quarantine")
            output = new QuarantineService(db, principal).hold(body);
          else if (path === "/api/office/release")
            output = new QuarantineService(db, principal).release(body);
          else if (path === "/api/office/execution/recover") {
            if (body.confirm !== true || typeof body.operationId !== "string")
              throw new DomainError("Confirm exact operation recovery");
            output = new ExecutionControl(db, principal).recover(
              body.operationId,
            );
          } else if (path === "/api/office/execution/recover-legacy-monitor") {
            if (body.confirm !== true || typeof body.token !== "string")
              throw new DomainError("Confirm exact legacy monitor recovery");
            output = new ExecutionControl(db, principal).recoverLegacyMonitor(
              body.token,
            );
          } else if (path === "/api/office/meeting/get")
            output = office.meeting(body.id);
          else if (path === "/api/office/meeting/start")
            output = office.start(body);
          else if (path === "/api/office/meeting/close")
            output = office.close(body);
          else if (path === "/api/office/meeting/task")
            output = office.createTask(body);
          else throw new DomainError("Not found", 404);
          send(200, output);
          return;
        }
        if (path.startsWith("/api/resources/")) {
          const time = Date.now();
          for (const [key, value] of resourceLimits)
            if (value.until <= time) resourceLimits.delete(key);
          const limit = resourceLimits.get(principal.id) ?? {
            count: 0,
            until: time + 60000,
          };
          if (limit.count >= 60)
            throw new DomainError(
              "Resource request limit; retry in one minute",
              429,
            );
          limit.count++;
          resourceLimits.set(principal.id, limit);
          const resources = new ResourceService(db, principal);
          if (req.method === "GET" && path === "/api/resources/overview") {
            send(200, resources.overview());
            return;
          }
          if (req.method !== "POST") throw new DomainError("Not found", 404);
          let output: unknown;
          if (path === "/api/resources/pricing")
            output = resources.pricing(body);
          else if (path === "/api/resources/agent-settings")
            output = resources.configureAgent(body);
          else if (path === "/api/resources/override")
            output = resources.override(body);
          else if (path === "/api/resources/task-limits")
            output = resources.setTaskLimits(body);
          else throw new DomainError("Not found", 404);
          send(200, output);
          return;
        }
        if (path.startsWith("/api/knowledge/")) {
          const time = Date.now();
          for (const [key, value] of knowledgeLimits)
            if (value.until <= time) knowledgeLimits.delete(key);
          const limit = knowledgeLimits.get(principal.id) ?? {
            count: 0,
            until: time + 60000,
          };
          if (limit.count >= 60)
            throw new DomainError(
              "Knowledge request limit; try again in one minute",
              429,
            );
          limit.count++;
          knowledgeLimits.set(principal.id, limit);
          const knowledge = new KnowledgeService(db, principal);
          if (req.method === "GET" && path === "/api/knowledge/overview") {
            send(200, knowledge.admin());
            return;
          }
          if (req.method !== "POST") throw new DomainError("Not found", 404);
          let output: unknown;
          switch (path.slice("/api/knowledge/".length)) {
            case "search":
              output = knowledge.search(body);
              break;
            case "get":
              output = knowledge.get(
                text(body.id, "ID", 80),
                body.agentId ? text(body.agentId, "Agent", 80) : undefined,
              );
              break;
            case "history":
              output = knowledge.history(
                text(body.id, "ID", 80),
                body.agentId ? text(body.agentId, "Agent", 80) : undefined,
              );
              break;
            case "create":
              output = knowledge.create(body);
              break;
            case "update":
              output = knowledge.update(body);
              break;
            case "verify":
              output = knowledge.verify(body);
              break;
            case "promote":
              output = knowledge.promote(body);
              break;
            case "archive":
              output = knowledge.archive(body);
              break;
            case "relate":
              output = knowledge.relate(body);
              break;
            case "resolve":
              output = knowledge.resolve(body);
              break;
            case "feedback":
              output = knowledge.feedback(body);
              break;
            default:
              throw new DomainError("Not found", 404);
          }
          send(200, output);
          return;
        }
        if (path.startsWith("/api/security/")) {
          const security = new SecurityService(db, principal);
          if (req.method === "GET") {
            const view = securityOverview(db, principal.company_id);
            const sections: Record<string, unknown> = {
              overview: view,
              credentials: view.credentials,
              events: view.events,
              incidents: view.incidents,
              alerts: view.alerts,
              sessions: view.sessions,
              vulnerabilities: view.vulnerabilities,
            };
            const section = path.slice("/api/security/".length);
            if (!(section in sections)) throw new DomainError("Not found", 404);
            send(200, sections[section]);
            return;
          }
          const windowAction =
            path === "/api/security/reauthenticate" ? "reauth" : "security";
          const rate = db
            .prepare(
              "SELECT * FROM security_rate_limits WHERE user_id=? AND action=?",
            )
            .get(principal.id, windowAction);
          if (
            rate &&
            Number(rate.until) > Date.now() &&
            Number(rate.count) >= (windowAction === "reauth" ? 5 : 30)
          )
            throw new DomainError("Security action rate limit; try later", 429);
          db.prepare(
            "INSERT INTO security_rate_limits VALUES(?,?,1,?) ON CONFLICT(user_id,action) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END",
          ).run(
            principal.id,
            windowAction,
            Date.now() + 60000,
            Date.now(),
            Date.now(),
          );
          let output: unknown;
          if (path === "/api/security/passkeys/register-options") {
            send(
              200,
              await new PasskeyService(db, principal).options(
                "REGISTER",
                origin,
                body.reauthToken,
              ),
            );
            return;
          }
          if (path === "/api/security/passkeys/authenticate-options") {
            send(
              200,
              await new PasskeyService(db, principal).options(
                "AUTHENTICATE",
                origin,
              ),
            );
            return;
          }
          if (path === "/api/security/passkeys/verify") {
            send(
              200,
              await new PasskeyService(db, principal).verify(body, origin),
            );
            return;
          }
          if (path === "/api/security/reauthenticate")
            output = security.reauthenticate(body.password);
          else if (path === "/api/security/credentials")
            output = security.create(body);
          else if (path === "/api/security/settings")
            output = security.configure(body);
          else if (path === "/api/security/review") output = security.review();
          else if (path === "/api/security/report")
            output = security.report(body);
          else if (path === "/api/security/schedule")
            output = security.schedule(body);
          else if (path === "/api/security/incidents")
            output = security.incident(body);
          else if (path === "/api/security/lockdown")
            output = security.lockdown(body);
          else if (path === "/api/security/agent-access/evaluate")
            output = security.evaluate(body);
          else if (path === "/api/security/agent-access/approve")
            output = security.approveGrant(body);
          else if (path === "/api/security/agent-access/apply")
            output = security.applyGrant(body);
          else if (path === "/api/security/breach-check")
            output = await security.breachCheck(
              body,
              process.env.HIBP_COMPANY_ID === principal.company_id &&
                process.env.HIBP_API_KEY
                ? new HibpProvider(process.env.HIBP_API_KEY)
                : undefined,
            );
          else {
            const match = path.match(
              /^\/api\/security\/(credentials|sessions|incidents|alerts)\/([a-f0-9-]{36})\/(rotate|auth-method|revoke|remediate|acknowledge)$/,
            );
            if (!match) throw new DomainError("Not found", 404);
            const input = { ...body, id: match[2] };
            if (match[1] === "credentials" && match[3] === "rotate")
              output = security.updated(input);
            else if (match[1] === "credentials" && match[3] === "auth-method")
              output = security.authMethod(input);
            else if (match[1] === "sessions" && match[3] === "revoke")
              output = security.revokeSession(input);
            else if (match[1] === "incidents" && match[3] === "remediate")
              output = security.transition(input);
            else if (match[1] === "alerts" && match[3] === "acknowledge")
              output = security.acknowledge(input);
            else throw new DomainError("Not found", 404);
          }
          send(200, output);
          return;
        }
        if (path === "/api/session" && req.method === "GET") {
          send(200, { csrf: principal.csrf, email: principal.email });
          return;
        }
        if (path === "/api/state" && req.method === "GET") {
          send(200, service.state());
          return;
        }
        if (req.method === "GET" && path.startsWith("/api/design/assets/")) {
          const bytes = new DesignService(
            db,
            principal,
            designDependencies,
          ).asset(path.slice("/api/design/assets/".length));
          res.writeHead(200, {
            ...headers,
            "Content-Type": "image/png",
            "Content-Disposition": 'inline; filename="design.png"',
          });
          res.end(bytes);
          return;
        }
        if (req.method === "GET" && path.startsWith("/api/products/mockup/")) {
          const svg = new ProductService(
            db,
            principal,
            productDependencies,
          ).mockup(path.slice("/api/products/mockup/".length));
          res.writeHead(200, {
            ...headers,
            "Content-Type": "image/svg+xml",
            "Content-Disposition": 'inline; filename="placement-proof.svg"',
          });
          res.end(svg);
          return;
        }
        if (req.method !== "POST") throw new DomainError("Not found", 404);
        let result: unknown;
        if (path === "/api/logout") {
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            hash(token),
          );
          audit(
            db,
            principal.company_id,
            principal.id,
            "session.revoked",
            principal.id,
          );
          send(200, { ok: true }, { "Set-Cookie": cookie("") });
          return;
        } else if (path === "/api/control")
          result = service.control(
            text(body.kind, "kind", 20),
            text(body.target ?? "company", "target", 80),
            body.paused as boolean,
          );
        else if (path === "/api/projects") result = service.project(body);
        else if (path === "/api/tasks") result = service.task(body);
        else if (path === "/api/tasks/cancel")
          result = service.cancel(text(body.id, "id", 80));
        else if (path === "/api/approvals")
          result = service.requestApproval(body);
        else if (path === "/api/approvals/decide")
          result = service.decide(
            text(body.id, "id", 80),
            text(body.decision, "decision", 20),
          );
        else if (path === "/api/memory") result = service.memory(body);
        else if (path === "/api/chat") result = service.chat(body);
        else if (path.startsWith("/api/organization/")) {
          const organization = new OrganizationService(db, principal);
          if (path === "/api/organization/delegate")
            result = new TaskCoordinationService(db, principal).delegate(body);
          else if (path === "/api/organization/handoffs")
            result = new TaskCoordinationService(db, principal).list();
          else if (path === "/api/organization/configuration") {
            const configuration = new AgentConfigurationService(db, principal);
            result = {
              current: configuration.get(body.agentId),
              history: configuration.history(body.agentId),
              constitution: configuration.constitution(),
            };
          } else if (path === "/api/organization/report")
            result = organization.report(body);
          else if (path === "/api/organization/review")
            result = organization.review(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/automation/")) {
          const automation = new AutomationService(db, principal);
          if (path === "/api/automation/create")
            result = automation.create(body);
          else if (path === "/api/automation/approve")
            result = automation.approve(body);
          else if (path === "/api/automation/enable")
            result = automation.enable(body);
          else if (path === "/api/automation/pause")
            result = automation.pause(body);
          else if (path === "/api/automation/tick")
            result = tickAutomation(db, principal.company_id);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/learning/")) {
          const learning = new LearningService(db, principal);
          if (path === "/api/learning/propose") result = learning.propose(body);
          else if (path === "/api/learning/approve")
            result = learning.approve(body);
          else if (path === "/api/learning/promote")
            result = learning.promote(body);
          else if (path === "/api/learning/followup")
            result = learning.followup(body);
          else if (path === "/api/learning/cancel")
            result = learning.cancel(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/compliance/")) {
          const compliance = new ComplianceService(db, principal);
          if (path === "/api/compliance/hold") result = compliance.hold(body);
          else if (path === "/api/compliance/configure")
            result = compliance.configure(body);
          else if (path === "/api/compliance/review")
            result = compliance.review(body);
          else if (path === "/api/compliance/release-request")
            result = compliance.releaseRequest(body);
          else if (path === "/api/compliance/release")
            result = compliance.release(body);
          else if (path === "/api/compliance/audit-review")
            result = compliance.auditReview(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/operations/")) {
          const operations = new OperationsService(db, principal);
          if (webhookConfig !== undefined)
            operations.config = () => webhookConfig;
          if (path === "/api/operations/authorize")
            result = operations.authorize(body);
          else if (path === "/api/operations/disconnect")
            result = operations.disconnect();
          else if (path === "/api/operations/simulate")
            result = operations.simulate(body);
          else if (path === "/api/operations/process")
            result = operations.process();
          else if (path === "/api/operations/incident")
            result = operations.incident(body);
          else if (path === "/api/operations/transition")
            result = operations.transition(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/technology/")) {
          const technology = new TechnologyService(db, principal);
          if (path === "/api/technology/observation")
            result = technology.observation(body);
          else if (path === "/api/technology/monitor")
            result = await technology.monitor(body);
          else if (path === "/api/technology/report")
            result = technology.report(body);
          else if (path === "/api/technology/approve")
            result = technology.approve(body);
          else if (path === "/api/technology/assign")
            result = technology.assign(body);
          else if (path === "/api/technology/validate")
            result = technology.validate(body);
          else if (path === "/api/technology/cancel")
            result = technology.cancel(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/customers/")) {
          const customers = new CustomerService(db, principal);
          if (path === "/api/customers/capture")
            result = customers.capture(body);
          else if (path === "/api/customers/review-evidence")
            result = customers.reviewEvidence(body);
          else if (path === "/api/customers/withdraw")
            result = customers.withdraw(body);
          else if (path === "/api/customers/document")
            result = customers.document(body);
          else if (path === "/api/customers/support")
            result = customers.support(body);
          else if (path === "/api/customers/draft")
            result = customers.draft(body);
          else if (path === "/api/customers/review-draft")
            result = customers.reviewDraft(body);
          else if (path === "/api/customers/close")
            result = customers.close(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/marketing/")) {
          const marketing = new MarketingService(db, principal);
          if (path === "/api/marketing/create") result = marketing.create(body);
          else if (path === "/api/marketing/approve")
            result = marketing.approve(body);
          else if (path === "/api/marketing/ready")
            result = marketing.ready(body);
          else if (path === "/api/marketing/cancel")
            result = marketing.cancel(body);
          else if (path === "/api/marketing/measure")
            result = marketing.measure(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/products/")) {
          const products = new ProductService(
            db,
            principal,
            productDependencies,
          );
          if (path === "/api/products/authorize")
            result = await products.authorize(body);
          else if (path === "/api/products/disconnect")
            result = products.disconnect();
          else if (path === "/api/products/template")
            result = products.template(body);
          else if (path === "/api/products/proposal")
            result = products.proposal(body);
          else if (path === "/api/products/approve")
            result = products.approve(body);
          else if (path === "/api/products/dispatch")
            result = await products.dispatch(body);
          else if (path === "/api/products/cancel")
            result = products.cancel(body);
          else if (path === "/api/products/recover")
            result = products.recover(body);
          else if (path === "/api/products/reconcile")
            result = await products.reconcile(body);
          else throw new DomainError("Not found", 404);
        } else if (path.startsWith("/api/design/")) {
          const design = new DesignService(db, principal, designDependencies);
          if (path === "/api/design/settings") result = design.configure(body);
          else if (path === "/api/design/brief") result = design.brief(body);
          else if (path === "/api/design/queue") result = design.enqueue(body);
          else if (path === "/api/design/approve")
            result = design.approve(body);
          else if (path === "/api/design/run") result = await design.run(body);
          else if (path === "/api/design/cancel") result = design.cancel(body);
          else if (path === "/api/design/recover")
            result = design.recover(body);
          else if (path === "/api/design/reconcile")
            result = design.reconcile(body);
          else if (path === "/api/design/review") result = design.review(body);
          else throw new DomainError("Not found", 404);
        } else if (path === "/api/research/source")
          result = new ResearchService(db, principal).source(body);
        else if (path === "/api/research/verify")
          result = new ResearchService(db, principal).verify(body);
        else if (path === "/api/research/trend")
          result = new ResearchService(db, principal).trend(body);
        else if (path === "/api/research/opportunity")
          result = new ResearchService(db, principal).opportunity(body);
        else if (path === "/api/research/handoff")
          result = new ResearchService(db, principal).handoff(body);
        else if (path === "/api/analytics/report")
          result = new AnalyticsService(db, principal as Principal).report();
        else if (path === "/api/experiments")
          result = new AnalyticsService(db, principal as Principal).create(
            body,
          );
        else if (path === "/api/experiments/update")
          result = new AnalyticsService(db, principal as Principal).update(
            body,
          );
        else if (path === "/api/shopify/authorize")
          result = new ShopifyService(
            db,
            principal as Principal,
            shopifyDependencies,
          ).authorize(body);
        else if (path === "/api/shopify/sync")
          result = await new ShopifyService(
            db,
            principal as Principal,
            shopifyDependencies,
          ).sync();
        else if (path === "/api/shopify/disconnect")
          result = new ShopifyService(
            db,
            principal as Principal,
            shopifyDependencies,
          ).disconnect();
        else throw new DomainError("Not found", 404);
        send(200, result);
      } catch (error) {
        const known = error instanceof DomainError;
        if (principal) {
          try {
            audit(
              db,
              principal.company_id,
              principal.id,
              "request.rejected",
              new URL(req.url ?? "/", origin).pathname,
              "FAILED",
              { code: known ? error.status : 500 },
            );
          } catch {
            console.error("Audit write failed");
          }
        }
        if (!known)
          console.error(
            "Internal request failure",
            error instanceof Error ? error.name : "UnknownError",
          );
        send(known ? error.status : 500, {
          error: known ? error.message : "Internal error; no success confirmed",
        });
      }
    },
  );
  app.maxRequestsPerSocket = 100;
  app.setTimeout(30000, (socket) => socket.destroy());
  return app;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST ?? "127.0.0.1",
    port = Number(process.env.PORT ?? 3100),
    origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error(
      "Foundation server must bind to loopback; hosted deployment requires hardening",
    );
  // Vercel functions have a read-only deployment filesystem. Keep the local
  // SQLite default for development, but use the writable ephemeral directory
  // when hosted until the durable Supabase/Postgres adapter is enabled.
  const databasePath =
    process.env.DATABASE_PATH ??
    (process.env.VERCEL ? "/tmp/company.sqlite" : "data/company.sqlite");
  const db = openDatabase(databasePath);
  const app = createApp(db, origin, process.env.SECURE_COOKIES === "true");
  const stopAutomation =
    process.env.AUTOMATION_ENABLED === "true"
      ? startAutomationWorker(db)
      : () => {};
  const securityTimer = setInterval(() => tickSecurity(db), 60000);
  securityTimer.unref();
  const reportingTimer = setInterval(() => {
    try {
      tickExecutiveReports(db);
    } catch {
      console.error(
        "Executive reporting worker failed; no success or financial authorization assumed",
      );
    }
  }, 60000);
  reportingTimer.unref();
  app.listen(port, host, () =>
    console.log(`Company OS: ${origin}. Run npm run setup if no CEO exists.`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      app.close(() => {
        clearInterval(securityTimer);
        clearInterval(reportingTimer);
        stopAutomation();
        db.close();
        process.exit(0);
      }),
    );
}
