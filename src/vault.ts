import { DomainError } from "./policy.ts";
export type CredentialScope = {
  companyId: string;
  credentialId: string;
  environment: string;
  reference: string;
  serviceDomain: string;
};
export interface SecretVault {
  withSecret<T>(
    scope: CredentialScope,
    consume: (secret: Buffer) => Promise<T>,
  ): Promise<T>;
}
export class UnavailableVault implements SecretVault {
  async withSecret<T>(
    _scope: CredentialScope,
    _consume: (secret: Buffer) => Promise<T>,
  ): Promise<T> {
    throw new DomainError("Vault integration unavailable", 503);
  }
}
export type VaultBinding = CredentialScope & { path: string; field: string };
// Bindings and transport come from trusted server configuration, never model or HTTP payloads.
export class HashicorpVault implements SecretVault {
  private origin: string;
  private token: () => string;
  private bindings: VaultBinding[];
  constructor(origin: string, token: () => string, bindings: VaultBinding[]) {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Pinned HTTPS Vault origin required");
    this.origin = url.origin;
    this.token = token;
    this.bindings = bindings;
  }
  async withSecret<T>(
    scope: CredentialScope,
    consume: (secret: Buffer) => Promise<T>,
  ): Promise<T> {
    const binding = this.bindings.find((b) =>
      Object.entries(scope).every(([k, v]) => b[k as keyof VaultBinding] === v),
    );
    if (
      !binding ||
      !/^[a-zA-Z0-9_-]+\/data\/[a-zA-Z0-9_/-]+$/.test(binding.path) ||
      binding.path.includes("..")
    )
      throw new DomainError("Vault scope denied", 403);
    let secret: Buffer | undefined;
    try {
      const response = await fetch(`${this.origin}/v1/${binding.path}`, {
        headers: { "X-Vault-Token": this.token() },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.body) throw new Error("Unavailable");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 65536) throw new Error("Oversize");
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const value = JSON.parse(bytes.toString()).data?.data?.[binding.field];
      bytes.fill(0);
      chunks.forEach((c) => c.fill(0));
      if (typeof value !== "string" || !value.length || value.length > 8192)
        throw new Error("Invalid secret");
      secret = Buffer.from(value);
      return await consume(secret);
    } catch {
      throw new DomainError(
        "Credential operation unavailable; no success confirmed",
        503,
      );
    } finally {
      secret?.fill(0);
    }
  }
}
