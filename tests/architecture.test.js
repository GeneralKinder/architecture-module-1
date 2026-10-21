import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/database.js";
import { PaymentService } from "../src/payments/PaymentService.js";

// Lightweight architecture fitness functions: dependency rules between module folders.
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function moduleFiles(moduleName) {
  const directory = path.join(sourceRoot, moduleName);
  return readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join(directory, file));
}

function importsOf(file) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) =>
    path.relative(sourceRoot, path.resolve(path.dirname(file), match[1]))
  );
}

test("Payments does not depend on Orders internals", () => {
  for (const file of moduleFiles("payments")) {
    const source = readFileSync(file, "utf8");
    assert.ok(!importsOf(file).some((target) => target.startsWith("orders")), file);
    assert.ok(!/orderRepository|OrderRepository/.test(source), file);
  }
});

test("payment provider implementation is used only through the Payments boundary", () => {
  const allowed = new Set(["payments", "app.js"]);
  for (const entry of readdirSync(sourceRoot, { recursive: true })) {
    if (!entry.endsWith(".js")) continue;
    const owner = entry.split(path.sep)[0];
    if (allowed.has(owner)) continue;
    const usesProvider = importsOf(path.join(sourceRoot, entry))
      .some((target) => target === path.join("payments", "FakePaymentProvider.js"));
    assert.ok(!usesProvider, entry);
  }
});

test("notification template changes do not require Orders, Payments or Inventory", () => {
  const forbidden = ["orders", "payments", "inventory", "checkout"];
  for (const file of moduleFiles("notifications")) {
    assert.ok(!importsOf(file).some((target) => forbidden.includes(target.split(path.sep)[0])), file);
  }
});

test("Payments charges through its contract without Orders data", async () => {
  const database = createDatabase();
  const provider = {
    async charge(input) {
      return { ...input, provider: "TestPay", providerPaymentId: "provider_1", latencyMs: 1 };
    }
  };
  const payments = new PaymentService(database, provider);

  const payment = await payments.chargeOrder(
    { orderId: "order_external", amountCents: 8900, currency: "USD" },
    "tok_test_4242"
  );

  assert.equal(database.orders.size, 0);
  assert.equal(payment.status, "CAPTURED");
  assert.equal(payment.amountCents, 8900);
});
