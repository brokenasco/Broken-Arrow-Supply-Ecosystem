import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const ignored = new Set([
  ".git",
  ".codex",
  ".agents",
  "node_modules",
  "data",
  ".npm-cache",
]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk-proj-|shpat_|ghp_)[A-Za-z0-9_-]{24,}/,
];
let files = 0,
  findings = 0;
function scan(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (entry.name.startsWith(".env") && entry.name !== ".env.example")
      continue;
    if (
      !/\.(?:ts|js|json|md|txt|yml|yaml|html|sql)$/.test(entry.name) &&
      entry.name !== ".env.example"
    )
      continue;
    files++;
    if (patterns.some((p) => p.test(readFileSync(path, "utf8")))) {
      findings++;
      console.error(
        `Potential secret: ${relative(".", path)} (value suppressed)`,
      );
    }
  }
}
scan(".");
console.log(
  JSON.stringify({
    files,
    findings,
    scope:
      "Source text only; pattern scan is not proof of absence. Runtime secrets, data, Git history and ignored directories excluded.",
  }),
);
if (findings) process.exitCode = 1;
