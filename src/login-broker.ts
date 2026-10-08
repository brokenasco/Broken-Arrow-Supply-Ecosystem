import { CredentialService, credentialHealth } from "./credentials.ts";
import { securityEvent } from "./security-foundation.ts";
import {
  UnavailableVault,
  type SecretVault,
  type CredentialScope,
} from "./vault.ts";
import { DomainError } from "./policy.ts";
export interface AuthenticationAdapter {
  readonly serviceDomain: string;
  authenticate(secret: Buffer): Promise<void>;
}
// Internal-only broker. HTTP/model inputs cannot inject either adapter or vault binding.
export class LoginBroker extends CredentialService {
  async authenticateWithVault(
    input: Record<string, unknown>,
    vault: SecretVault = new UnavailableVault(),
    adapter?: AuthenticationAdapter,
  ) {
    const scope = this.change(
      "CREDENTIAL_ACCESS_REQUESTED",
      String(input.id),
      () => {
        this.consumeReauth(input.reauthToken);
        const row = this.record(input.id);
        const decision = this.evaluate({
          agentId: input.agentId,
          resourceId: row.id,
          action: "authenticate",
          environment: row.environment,
        });
        if (
          decision.decision !== "ALLOW" ||
          row.status === "DISABLED" ||
          ["POSSIBLY_COMPROMISED", "COMPROMISED"].includes(
            String(row.breach_status),
          )
        )
          throw new DomainError("Credential access denied", 403);
        if (!adapter || adapter.serviceDomain !== row.service_domain)
          throw new DomainError(
            "Pinned authentication adapter unavailable",
            503,
          );
        return {
          companyId: this.p.company_id,
          credentialId: String(row.id),
          environment: String(row.environment),
          reference: String(row.vault_secret_reference),
          serviceDomain: String(row.service_domain),
        } satisfies CredentialScope;
      },
    );
    try {
      await vault.withSecret(scope, async (secret) => {
        this.authenticate();
        const latest = this.record(scope.credentialId);
        if (
          this.evaluate({
            agentId: input.agentId,
            resourceId: latest.id,
            action: "authenticate",
            environment: latest.environment,
          }).decision !== "ALLOW" ||
          ["POSSIBLY_COMPROMISED", "COMPROMISED"].includes(
            String(latest.breach_status),
          ) ||
          latest.status === "DISABLED"
        )
          throw new DomainError("Authorization changed", 403);
        await adapter!.authenticate(secret); // Adapter must retain session material outside model context.
      });
    } catch {
      this.change(
        "CREDENTIAL_AUTHENTICATION_UNCONFIRMED",
        scope.credentialId,
        () => ({}),
      );
      throw new DomainError(
        "Authentication unavailable or outcome uncertain; no automatic retry",
        503,
      );
    }
    return this.change("CREDENTIAL_AUTHENTICATED", scope.credentialId, () => ({
      authenticated: true,
      secretReturned: false,
    }));
  }
}
