import assert from "node:assert/strict";
import test from "node:test";
import { authorize, functionCallKey } from "../src/accessKey.js";
import { reviewCounterparty } from "../src/counterparty.js";
import { injectedPayment, negotiate, runJob } from "../src/contractor.js";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const key = functionCallKey({ contractId: "till.near", methods: ["pay"], allowance: 100 });

test("function-call key refuses a NEAR transfer and a foreign receiver", () => {
  const transfer = authorize(key, { type: "transfer", receiverId: "till.near", method: "transfer", gas: 10 });
  assert.equal(transfer.ok, false);
  const foreign = authorize(key, { type: "function_call", receiverId: "phish.near", method: "pay", gas: 10 });
  assert.equal(foreign.ok, false);
  const ok = authorize(key, { type: "function_call", receiverId: "till.near", method: "pay", gas: 10 });
  assert.equal(ok.ok, true);
  assert.equal(ok.allowanceLeft, 90);
});

test("blocklist is a hard stop even when the account is old", () => {
  const review = reviewCounterparty({
    accountId: "phish.near",
    blocklist: new Set(["phish.near"]),
    nowMs: NOW,
    createdMs: Date.parse("2020-01-01T00:00:00Z"),
    priorPayments: 10,
    amount: 1,
  });
  assert.equal(review.verdict, "block");
});

test("negotiation counters once, then walks if the floor is higher", () => {
  const deal = negotiate({ planned: 400_000 }, { ask: 700_000, floor: 400_000 });
  assert.equal(deal.accepted, true);
  assert.equal(deal.price, 400_000);
  assert.equal(deal.rounds, 1);
  const walk = negotiate({ planned: 100_000 }, { ask: 700_000, floor: 400_000 });
  assert.equal(walk.accepted, false);
  assert.equal(walk.rounds, 1);
});

test("a job stays inside budget and writes a receipt per part", () => {
  const result = runJob({
    brief: "stall order",
    budget: 1_000_000,
    key,
    nowMs: NOW,
    blocklist: new Set(),
    vendors: {
      "data.near": { accountId: "data.near", ask: 700_000, floor: 400_000, workOk: true },
      "checker.near": { accountId: "checker.near", ask: 200_000, floor: 100_000, workOk: true },
    },
    accounts: {
      "data.near": { createdMs: Date.parse("2024-01-01T00:00:00Z"), priorPayments: 2 },
      "checker.near": { createdMs: Date.parse("2024-01-01T00:00:00Z"), priorPayments: 2 },
    },
  });
  assert.equal(result.spent, 600_000);
  assert.equal(result.receipts.length, 3);
  assert.ok(result.receipts.every((row) => "passed" in row && "decision" in row));
  assert.equal(result.receipts.find((row) => row.part === "data").decision, "paid");
});

test("failed work is not paid", () => {
  const result = runJob({
    brief: "stall order",
    budget: 1_000_000,
    key,
    nowMs: NOW,
    blocklist: new Set(),
    vendors: {
      "data.near": { accountId: "data.near", ask: 100_000, floor: 50_000, workOk: false },
      "checker.near": { accountId: "checker.near", ask: 100_000, floor: 50_000, workOk: true },
    },
    accounts: {
      "data.near": { createdMs: Date.parse("2024-01-01T00:00:00Z"), priorPayments: 4 },
      "checker.near": { createdMs: Date.parse("2024-01-01T00:00:00Z"), priorPayments: 4 },
    },
  });
  assert.equal(result.receipts.find((row) => row.part === "data").decision, "work-failed");
  assert.equal(result.receipts.find((row) => row.part === "data").price, 0);
});

test("prompt injection cannot pay a blocked account", () => {
  const attack = injectedPayment({
    key,
    blocklist: new Set(["phish.near"]),
    nowMs: NOW,
    phishAccount: "phish.near",
  });
  assert.equal(attack.review.verdict, "block");
  assert.equal(attack.transfer.ok, false);
  assert.equal(attack.foreignCall.ok, false);
  assert.equal(attack.paid, false);
});
