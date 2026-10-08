import { request } from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
export type ProbeResult = {
  status: number;
  durationMs: number;
  bytes: number;
  html: boolean;
  signals: {
    title: boolean;
    language: boolean;
    viewport: boolean;
    imagesWithoutAlt: number;
  };
  label: string;
};
export function host(value: string) {
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) ||
    isIP(value) ||
    value.endsWith(".local") ||
    value.endsWith(".localhost")
  )
    throw new Error("INVALID_PUBLIC_HOST");
  return value;
}
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
export function publicAddress(address: string) {
  return isIP(address) === 4 && !blocked.check(address, "ipv4");
}
export function signals(html: string) {
  return {
    title: /<title\b[^>]*>\s*[^<\s]/i.test(html),
    language: /<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html),
    viewport: /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html),
    imagesWithoutAlt: (html.match(/<img\b[^>]*>/gi) ?? []).filter(
      (tag) => !/\balt\s*=/i.test(tag),
    ).length,
  };
}
export async function probe(
  hostname: string,
  signal: AbortSignal,
): Promise<ProbeResult> {
  host(hostname);
  const addresses = await Promise.race([
    resolve4(hostname),
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("TIMEOUT")), {
        once: true,
      });
      if (signal.aborted) reject(new Error("TIMEOUT"));
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicAddress(a)))
    throw new Error("NON_PUBLIC_DNS");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = request(
      {
        hostname,
        port: 443,
        path: "/",
        method: "GET",
        agent: false,
        servername: hostname,
        signal,
        headers: {
          "User-Agent": "CompanyOS-HealthCheck/1.0",
          Accept: "text/html",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address, family: 4 }]);
          else callback(null, address, 4);
        },
      },
      (res) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            req.destroy(new Error("RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (bytes > 1024 * 1024) return;
          const isHtml =
            String(res.headers["content-type"] ?? "").includes("text/html") &&
            !res.headers["content-encoding"];
          resolve({
            status: res.statusCode ?? 0,
            durationMs: Math.round(performance.now() - started),
            bytes,
            html: isHtml,
            signals: signals(
              isHtml ? Buffer.concat(chunks).toString("utf8") : "",
            ),
            label:
              "Server HTTP sample only; redirects not followed. Markup heuristics are not browser, accessibility or Core Web Vitals results.",
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
