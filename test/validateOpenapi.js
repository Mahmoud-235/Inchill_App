const assert = require("node:assert/strict");
const fs = require("node:fs");

const spec = JSON.parse(fs.readFileSync("docs/openapi.json", "utf8"));
const expectedPaths = new Set([
  "/health",
  "/ready",
  "/api/auth/send-otp",
  "/api/auth/verify-otp",
  "/api/bot/session/validate",
  "/api/bot/verify-id",
  "/api/bot/agent-profile",
  "/api/bot/transfer-readiness",
  "/api/bot/wallet-balance",
  "/api/bot/account-history",
  "/api/bot/transactions",
]);

assert.equal(spec.openapi, "3.0.3");
assert.deepEqual(new Set(Object.keys(spec.paths)), expectedPaths);
assert.deepEqual(spec.components?.securitySchemes?.ApiKeyAuth, { type: "apiKey", in: "header", name: "x-internal-api-key" });
for (const [path, item] of Object.entries(spec.paths)) {
  const operation = item.get || item.post;
  assert.ok(operation, `${path} needs an operation`);
  if (path === "/health" || path === "/ready") assert.deepEqual(operation.security, []);
  else assert.deepEqual(operation.security, [{ ApiKeyAuth: [] }], `${path} must use the V1 API key`);
}
assert.match(JSON.stringify(spec), /ApiKeyAuth/);
assert.doesNotMatch(JSON.stringify(spec), /(?:crystal|nobility|v2)/i);

console.log("OpenAPI contract valid");
