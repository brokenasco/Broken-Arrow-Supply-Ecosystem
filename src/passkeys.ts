import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { SecurityFoundation } from "./security-foundation.ts";
import { id, now } from "./db.ts";
import { hash } from "./auth.ts";
import { randomBytes } from "node:crypto";
import { DomainError } from "./policy.ts";
export class PasskeyService extends SecurityFoundation {
  async options(
    kind: "REGISTER" | "AUTHENTICATE",
    origin: string,
    reauthToken?: unknown,
  ) {
    this.authenticate();
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost")
      throw new DomainError("Passkeys require HTTPS or localhost", 409);
    const existing = this.db
      .prepare("SELECT id FROM security_passkeys WHERE user_id=?")
      .all(this.p.id)
      .map((r) => ({ id: String(r.id) }));
    if (kind === "AUTHENTICATE" && !existing.length)
      throw new DomainError("No passkey enrolled", 409);
    const options =
      kind === "REGISTER"
        ? await generateRegistrationOptions({
            rpName: "Company OS",
            rpID: url.hostname,
            userID: Buffer.from(this.p.id),
            userName: this.p.id,
            attestationType: "none",
            excludeCredentials: existing,
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "required",
            },
            supportedAlgorithmIDs: [-7, -257],
          })
        : await generateAuthenticationOptions({
            rpID: url.hostname,
            allowCredentials: existing,
            userVerification: "required",
          });
    return this.change("PASSKEY_CHALLENGE_CREATED", this.p.id, () => {
      if (kind === "REGISTER") this.consumeReauth(reauthToken);
      this.db
        .prepare(
          "DELETE FROM security_challenges WHERE user_id=? OR expires_at<?",
        )
        .run(this.p.id, Date.now());
      const challengeId = id();
      this.db
        .prepare("INSERT INTO security_challenges VALUES(?,?,?,?,?,?)")
        .run(
          challengeId,
          this.p.id,
          kind,
          options.challenge,
          origin,
          Date.now() + 120000,
        );
      return { challengeId, options };
    });
  }
  async verify(input: Record<string, unknown>, origin: string) {
    const challenge = this.change(
      "PASSKEY_CHALLENGE_CONSUMED",
      this.p.id,
      () => {
        if (typeof input.challengeId !== "string")
          throw new DomainError("Invalid challenge");
        const row = this.db
          .prepare(
            "SELECT * FROM security_challenges WHERE id=? AND user_id=? AND origin=? AND expires_at>?",
          )
          .get(input.challengeId, this.p.id, origin, Date.now());
        if (!row)
          throw new DomainError(
            "Challenge missing, expired or already used",
            403,
          );
        this.db
          .prepare("DELETE FROM security_challenges WHERE id=?")
          .run(row.id);
        return row;
      },
    );
    try {
      if (challenge.kind === "REGISTER") {
        const result = await verifyRegistrationResponse({
          response: input.response as RegistrationResponseJSON,
          expectedChallenge: String(challenge.challenge),
          expectedOrigin: origin,
          expectedRPID: new URL(origin).hostname,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
        if (!result.verified) throw new Error("Not verified");
        return this.change("PASSKEY_REGISTERED", this.p.id, () => {
          const key = result.registrationInfo.credential;
          this.db
            .prepare("INSERT INTO security_passkeys VALUES(?,?,?,?,?)")
            .run(
              key.id,
              this.p.id,
              Buffer.from(key.publicKey),
              key.counter,
              now(),
            );
          return { registered: true };
        });
      }
      const response = input.response as AuthenticationResponseJSON;
      const key = this.db
        .prepare("SELECT * FROM security_passkeys WHERE id=? AND user_id=?")
        .get(response?.id ?? "", this.p.id);
      if (!key) throw new Error("Unknown credential");
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: String(challenge.challenge),
        expectedOrigin: origin,
        expectedRPID: new URL(origin).hostname,
        requireUserVerification: true,
        credential: {
          id: String(key.id),
          publicKey: new Uint8Array(key.public_key as Uint8Array),
          counter: Number(key.counter),
        },
      });
      if (!result.verified) throw new Error("Not verified");
      return this.change("PASSKEY_REAUTHENTICATED", this.p.id, () => {
        const updated = this.db
          .prepare(
            "UPDATE security_passkeys SET counter=? WHERE id=? AND user_id=? AND counter=?",
          )
          .run(
            result.authenticationInfo.newCounter,
            key.id,
            this.p.id,
            key.counter,
          );
        if (!updated.changes)
          throw new DomainError("Passkey state changed", 409);
        const token = randomBytes(32).toString("hex");
        this.db
          .prepare("INSERT INTO security_reauth VALUES(?,?,?)")
          .run(hash(token), this.p.id, Date.now() + 300000);
        return { token, expiresInSeconds: 300 };
      });
    } catch {
      this.change("PASSKEY_VERIFICATION_FAILED", this.p.id, () => ({}));
      throw new DomainError("Passkey verification failed", 403);
    }
  }
}
