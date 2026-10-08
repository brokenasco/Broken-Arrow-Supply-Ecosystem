// Closed query catalog: the public API cannot supply arbitrary GraphQL or mutations.
const page = "pageInfo { hasNextPage endCursor }";
const money = "shopMoney { amount currencyCode }";
const line = "id title quantity product { id } variant { id }";
const level =
  'location { id name } quantities(names:["available"]) { name quantity }';
export const queries = {
  identity: `query CompanyIdentity { shop { id name myshopifyDomain currencyCode ianaTimezone } currentAppInstallation { accessScopes { handle } } }`,
  products: `query CompanyProducts($cursor:String) { products(first:100,after:$cursor) { nodes { id title status createdAt updatedAt } ${page} } }`,
  variants: `query CompanyVariants($cursor:String) { productVariants(first:100,after:$cursor) { nodes { id title sku product { id } inventoryItem { id } } ${page} } }`,
  inventory: `query CompanyInventory($cursor:String) { inventoryItems(first:10,after:$cursor) { nodes { id tracked inventoryLevels(first:20) { nodes { ${level} } ${page} } } ${page} } }`,
  levels: `query CompanyLevels($id:ID!,$cursor:String) { inventoryItem(id:$id) { inventoryLevels(first:100,after:$cursor) { nodes { ${level} } ${page} } } }`,
  orders: `query CompanyOrders($cursor:String,$query:String!) { orders(first:10,after:$cursor,query:$query,sortKey:CREATED_AT) { nodes { id createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { ${money} } totalRefundedSet { ${money} } lineItems(first:10) { nodes { ${line} } ${page} } refunds { id createdAt totalRefundedSet { ${money} } } fulfillments { id status createdAt } } ${page} } }`,
  lines: `query CompanyLines($id:ID!,$cursor:String) { order(id:$id) { lineItems(first:100,after:$cursor) { nodes { ${line} } ${page} } } }`,
  customers: `query CompanyCustomers($cursor:String) { customers(first:100,after:$cursor) { nodes { id createdAt numberOfOrders } ${page} } }`,
} as const;
export type QueryName = keyof typeof queries;
