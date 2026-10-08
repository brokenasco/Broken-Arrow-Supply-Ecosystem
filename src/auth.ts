import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { id, now, seedCompany, transaction, audit } from "./db.ts";
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function provision(
  db: DatabaseSync,
  email: string,
  password: string,
  name: string,
) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("Valid email required");
  if (password.length < 14 || password.length > 256)
    throw new Error("Password must contain 14–256 characters");
  if (!name.trim() || name.length > 120)
    throw new Error("Company name required (maximum 120 characters)");
  return transaction(db, () => {
    const company = seedCompany(db, name.trim());
    const user = id();
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
      user,
      company,
      email.toLowerCase(),
      passwordHash(password),
      "CEO",
      now(),
    );
    audit(db, company, user, "ceo.provisioned", user);
    return { company, user };
  });
}
const dummyHash = passwordHash(randomBytes(24).toString("hex"));
export function login(db: DatabaseSync, email: string, password: string) {
  const user = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(email.toLowerCase());
  const valid = verifyPassword(
    password,
    String(user?.password_hash ?? dummyHash),
  );
  if (!user || !valid) {
    db.prepare("INSERT INTO authentication_events VALUES(?,?,?,?,?)").run(
      id(),
      user?.company_id ?? null,
      user?.id ?? null,
      "LOGIN_FAILURE",
      now(),
    );
    return null;
  }
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  transaction(db, () => {
    db.prepare("INSERT INTO authentication_events VALUES(?,?,?,?,?)").run(
      id(),
      user.company_id,
      user.id,
      "LOGIN_SUCCESS",
      now(),
    );
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      hash(token),
      user.id,
      csrf,
      Date.now() + 8 * 60 * 60 * 1000,
    );
    db.prepare("INSERT INTO security_sessions VALUES(?,?,?)").run(
      id(),
      hash(token),
      now(),
    );
    audit(
      db,
      String(user.company_id),
      String(user.id),
      "session.created",
      String(user.id),
    );
  });
  return { token, csrf };
}
export function session(db: DatabaseSync, token: string) {
  return db
    .prepare(
      "SELECT u.id,u.company_id,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .get(hash(token), Date.now());
}
