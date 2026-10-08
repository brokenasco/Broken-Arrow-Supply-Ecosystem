import { backup, DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";

const magic = Buffer.from("COSBACK1");
function key(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error(
      "BACKUP_KEY must be 32 random bytes encoded as 64 hex characters",
    );
  return Buffer.from(value, "hex");
}
export function inspectDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      db
        .prepare("PRAGMA integrity_check")
        .all()
        .some((r) => r.integrity_check !== "ok")
    )
      throw new Error("Database integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Foreign key check failed");
    const versions = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((r) => Number(r.version));
    if (
      ![
        15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
      ].includes(versions.length) ||
      versions.some((v, i) => v !== i + 1)
    )
      throw new Error("Unsupported schema; use matching release");
    for (const name of ["audit_no_update", "audit_no_delete"]) {
      if (
        !db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw new Error("Audit protection missing");
    }
    return {
      schemaVersion: versions.length,
      companies: Number(
        db.prepare("SELECT count(*) n FROM companies").get()!.n,
      ),
      auditRecords: Number(
        db.prepare("SELECT count(*) n FROM audit_logs").get()!.n,
      ),
      integrity: "ok",
    };
  } finally {
    db.close();
  }
}
export async function encryptedBackup(
  source: string,
  destination: string,
  secret: string,
) {
  const encryptionKey = key(secret);
  // A private local snapshot is required by SQLite's backup API. Never use shared temp storage.
  const parent = resolve("data/backup-work");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(parent, "snapshot-"));
  try {
    const snapshot = join(temp, "snapshot.sqlite");
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(db, snapshot);
    } finally {
      db.close();
    }
    const report = inspectDatabase(snapshot);
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(magic);
    const ciphertext = Buffer.concat([
      cipher.update(readFileSync(snapshot)),
      cipher.final(),
    ]);
    writeFileSync(
      destination,
      Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]),
      { flag: "wx", mode: 0o600 },
    );
    return report;
  } finally {
    encryptionKey.fill(0);
    rmSync(temp, { recursive: true, force: true });
  }
}
export function restoreForInspection(
  source: string,
  destination: string,
  secret: string,
) {
  const encryptionKey = key(secret);
  try {
    const envelope = readFileSync(source);
    if (envelope.length < 37 || !envelope.subarray(0, 8).equals(magic))
      throw new Error("Invalid backup format");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      envelope.subarray(8, 20),
    );
    decipher.setAAD(magic);
    decipher.setAuthTag(envelope.subarray(20, 36));
    const plaintext = Buffer.concat([
      decipher.update(envelope.subarray(36)),
      decipher.final(),
    ]);
    // Exclusive creation prevents replacing an active database or existing recovery evidence.
    writeFileSync(destination, plaintext, { flag: "wx", mode: 0o600 });
    plaintext.fill(0);
    return inspectDatabase(destination);
  } finally {
    encryptionKey.fill(0);
  }
}
