import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  encryptedBackup,
  restoreForInspection,
  inspectDatabase,
} from "../src/recovery.ts";

test("encrypted backup includes committed WAL data, restores audit, rejects overwrite and tampering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-test-"));
  const source = join(dir, "source.sqlite"),
    archive = join(dir, "backup.cosbak"),
    restored = join(dir, "restored.sqlite");
  const db = openDatabase(source),
    key = randomBytes(32).toString("hex");
  try {
    provision(
      db,
      "recovery@example.test",
      "synthetic-recovery-password",
      "SIMULATION recovery",
    );
    const expected = inspectDatabase(source);
    assert.equal(expected.auditRecords, 2);
    assert.deepEqual(await encryptedBackup(source, archive, key), expected);
    assert.equal(
      readFileSync(archive).includes(Buffer.from("SIMULATION recovery")),
      false,
    );
    assert.deepEqual(restoreForInspection(archive, restored, key), expected);
    assert.throws(() => restoreForInspection(archive, restored, key));
    await assert.rejects(encryptedBackup(source, archive, key));
    assert.throws(() =>
      restoreForInspection(
        archive,
        join(dir, "wrong.sqlite"),
        randomBytes(32).toString("hex"),
      ),
    );
    const corrupted = readFileSync(archive);
    corrupted[corrupted.length - 1] ^= 1;
    writeFileSync(join(dir, "corrupt.cosbak"), corrupted);
    assert.throws(() =>
      restoreForInspection(
        join(dir, "corrupt.cosbak"),
        join(dir, "bad.sqlite"),
        key,
      ),
    );
    assert.deepEqual(inspectDatabase(source), expected);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("backup rejects invalid keys and integrity inspection rejects missing audit protections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-test-")),
    source = join(dir, "source.sqlite");
  const db = openDatabase(source);
  try {
    await assert.rejects(
      encryptedBackup(source, join(dir, "invalid.cosbak"), "weak"),
    );
    db.exec("DROP TRIGGER audit_no_delete");
    assert.throws(() => inspectDatabase(source), /Audit protection missing/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
