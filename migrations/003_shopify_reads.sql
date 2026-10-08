CREATE UNIQUE INDEX stores_company_id ON stores(company_id,id);
CREATE TABLE shopify_connections (
 company_id TEXT PRIMARY KEY REFERENCES companies(id), store_id TEXT NOT NULL,
 domain TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('AUTHORIZED','SYNCING','READY','ERROR','DISCONNECTED')),
 customer_access INTEGER NOT NULL DEFAULT 0 CHECK(customer_access IN(0,1)),
 scopes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scopes)), currency TEXT, timezone TEXT,
 authorized_by TEXT NOT NULL REFERENCES users(id), authorized_at TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1, active_run TEXT, lease_until INTEGER,
 last_success_at TEXT, window_start TEXT, window_end TEXT, error_code TEXT,
 FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id)
);
CREATE TABLE shopify_sync_runs (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), store_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('RUNNING','SUCCESS','FAILED','CANCELLED')),
 started_at TEXT NOT NULL, finished_at TEXT, error_code TEXT, counts TEXT CHECK(counts IS NULL OR json_valid(counts)),
 FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id)
);
CREATE TABLE shopify_products (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id)
);
CREATE TABLE shopify_variants (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, product_id TEXT NOT NULL,
 title TEXT NOT NULL, sku TEXT, inventory_item_id TEXT NOT NULL,
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id,product_id) REFERENCES shopify_products(company_id,store_id,id)
);
CREATE TABLE shopify_inventory (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, item_id TEXT NOT NULL, location_id TEXT NOT NULL,
 location_name TEXT NOT NULL, tracked INTEGER NOT NULL, available INTEGER NOT NULL,
 PRIMARY KEY(company_id,store_id,item_id,location_id), FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id)
);
CREATE TABLE shopify_orders (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 cancelled_at TEXT, test INTEGER NOT NULL, financial_status TEXT, fulfillment_status TEXT NOT NULL,
 currency TEXT NOT NULL, current_total_minor INTEGER NOT NULL, refunded_minor INTEGER NOT NULL,
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id)
);
CREATE TABLE shopify_order_lines (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, order_id TEXT NOT NULL,
 product_id TEXT, variant_id TEXT, title TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0),
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id,order_id) REFERENCES shopify_orders(company_id,store_id,id) ON DELETE CASCADE
);
CREATE TABLE shopify_refunds (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, order_id TEXT NOT NULL,
 created_at TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL,
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id,order_id) REFERENCES shopify_orders(company_id,store_id,id) ON DELETE CASCADE
);
CREATE TABLE shopify_fulfillments (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, order_id TEXT NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id,order_id) REFERENCES shopify_orders(company_id,store_id,id) ON DELETE CASCADE
);
CREATE TABLE shopify_customers (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL,
 order_count INTEGER NOT NULL CHECK(order_count>=0),
 PRIMARY KEY(company_id,store_id,id), FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id)
);
CREATE INDEX shopify_orders_period ON shopify_orders(company_id,store_id,created_at);
CREATE INDEX shopify_lines_product ON shopify_order_lines(company_id,store_id,product_id);
CREATE INDEX shopify_runs_company ON shopify_sync_runs(company_id,started_at);
