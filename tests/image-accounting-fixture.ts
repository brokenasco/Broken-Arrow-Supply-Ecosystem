import type { DatabaseSync } from "node:sqlite";
import type { Principal } from "../src/service.ts";
import { ResourceService } from "../src/resources.ts";
export function imageAccountingFixture(db: DatabaseSync, p: Principal) {
  const service = new ResourceService(db, p);
  for (const modelId of ["fixture", "mock-image-fixture"])
    service.pricing({
      provider: "OPENAI",
      modelId,
      displayName: "Synthetic image fixture",
      inputUsdPerMillion: "1",
      cachedUsdPerMillion: "0",
      outputUsdPerMillion: "1",
      source:
        "Synthetic test pricing; not real market prices. Image bills are reconciled separately.",
      effectiveAt: "2020-01-01T00:00:00Z",
      active: true,
      confirm: true,
    });
}
