# Environment

Phase 2 optional Shopify variables: SHOPIFY_COMPANY_ID (from the Shopify store screen), SHOPIFY_SHOP_DOMAIN (exact *.myshopify.com), and either SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET for a same-organization app, or SHOPIFY_ACCESS_TOKEN for an already-issued Admin API token. Both methods together are rejected. SHOPIFY_CUSTOMERS_ENABLED defaults false; enabling it still requires CEO authorization and the matching scope. Restart after editing the ignored .env. See SHOPIFY.md for setup and supported auth limits.

Copy .env.example to .env. Never commit real credentials.

| Variable | Default | Purpose |
|---|---|---|
| HOST | 127.0.0.1 | Loopback only |
| PORT | 3100 | HTTP port |
| APP_ORIGIN | http://127.0.0.1:3100 | Exact browser origin for POST checks; update with port |
| DATABASE_PATH | data/company.sqlite | Persistent local SQLite |
| SECURE_COOKIES | false | true only with HTTPS; false for local HTTP |

Shopify is optional: no keys are needed for the disconnected workspace. Configured Shopify credentials are consumed only server-side. Other AI/provider integrations remain unavailable. Rotating or revoking a provider credential must also pause dependent work. A .env loader is provided by Node's --env-file-if-exists option.
