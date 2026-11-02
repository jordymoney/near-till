import { authorize } from "./accessKey.js";
import { reviewCounterparty } from "./counterparty.js";

/**
 * One human task, one budget, one function-call key.
 * Amounts are microNEAR (1 NEAR = 1_000_000).
 */

export function planTask(brief) {
  return [
    {
      id: "scope",
      title: `Write the scope for: ${brief}`,
      kind: "self",
      planned: 0,
    },
    {
      id: "data",
      title: "Buy the source dataset",
      kind: "hire",
      planned: 400_000,
      vendorId: "data.near",
    },
    {
      id: "check",
      title: "Pay an independent checker",
      kind: "hire",
      planned: 250_000,
      vendorId: "checker.near",
    },
  ];
}

export function negotiate(part, vendor) {
  if (vendor.ask <= part.planned) {
    return { accepted: true, price: vendor.ask, rounds: 0, reason: "ask is inside the plan" };
  }
  const counter = part.planned;
  const reason = `counter once at the planned ${counter} microNEAR (ask was ${vendor.ask})`;
  if (counter >= vendor.floor) {
    return { accepted: true, price: counter, rounds: 1, reason };
  }
  return { accepted: false, price: null, rounds: 1, reason: `${reason}; vendor floor is ${vendor.floor}` };
}

export function runJob({ brief, budget, key, vendors, blocklist, nowMs, accounts, humanApprovesWarn = false }) {
  const parts = planTask(brief);
  const receipts = [];
  let spent = 0;
  const log = [];

  for (const part of parts) {
    if (part.kind === "self") {
      receipts.push({
        part: part.id,
        vendor: null,
        price: 0,
        passed: true,
        decision: "self",
      });
      log.push(`self ${part.id}`);
      continue;
    }

    const vendor = vendors[part.vendorId];
    if (!vendor) {
      receipts.push({
        part: part.id,
        vendor: part.vendorId,
        price: 0,
        passed: false,
        decision: "no-vendor",
      });
      continue;
    }

    const deal = negotiate(part, vendor);
    if (!deal.accepted) {
      receipts.push({
        part: part.id,
        vendor: vendor.accountId,
        price: 0,
        passed: false,
        decision: "walked",
        reason: deal.reason,
      });
      log.push(`walk ${vendor.accountId}: ${deal.reason}`);
      continue;
    }

    if (spent + deal.price > budget) {
      receipts.push({
        part: part.id,
        vendor: vendor.accountId,
        price: 0,
        passed: false,
        decision: "over-budget",
        reason: `spent ${spent} + ${deal.price} exceeds budget ${budget}`,
      });
      log.push(`budget stop before paying ${vendor.accountId}`);
      continue;
    }

    const profile = accounts[vendor.accountId] ?? {};
    const review = reviewCounterparty({
      accountId: vendor.accountId,
      blocklist,
      nowMs,
      createdMs: profile.createdMs,
      codeChangedMs: profile.codeChangedMs,
      priorPayments: profile.priorPayments ?? 0,
      amount: deal.price,
    });

    if (review.verdict === "block") {
      receipts.push({
        part: part.id,
        vendor: vendor.accountId,
        price: 0,
        passed: false,
        decision: "blocked",
        reason: review.reasons.join("; "),
      });
      log.push(`block ${vendor.accountId}: ${review.reasons.join("; ")}`);
      continue;
    }

    if (review.verdict === "warn" && !humanApprovesWarn) {
      receipts.push({
        part: part.id,
        vendor: vendor.accountId,
        price: 0,
        passed: false,
        decision: "needs-human",
        reason: review.reasons.join("; "),
      });
      log.push(`warn ${vendor.accountId}: ${review.reasons.join("; ")}`);
      continue;
    }

    const signed = authorize(key, {
      type: "function_call",
      receiverId: key.contractId,
      method: "pay",
      gas: 30,
    });
    if (!signed.ok) {
      receipts.push({
        part: part.id,
        vendor: vendor.accountId,
        price: 0,
        passed: false,
        decision: "unsigned",
        reason: signed.reason,
      });
      log.push(`unsigned: ${signed.reason}`);
      continue;
    }

    const passed = vendor.workOk === true;
    if (!passed) {
      receipts.push({
        part: part.id,
        vendor: vendor.accountId,
        price: 0,
        passed: false,
        decision: "work-failed",
        reason: "checker rejected the delivery; nothing paid",
      });
      log.push(`work failed from ${vendor.accountId}; no payment`);
      continue;
    }

    spent += deal.price;
    receipts.push({
      part: part.id,
      vendor: vendor.accountId,
      price: deal.price,
      passed: true,
      decision: "paid",
      reason: deal.reason,
    });
    log.push(`paid ${vendor.accountId} ${deal.price}`);
  }

  return { spent, budgetLeft: budget - spent, receipts, log };
}

/**
 * Prompt-injection path. The model is told to pay a blocked account
 * by a transfer. The key and the blocklist both refuse.
 */
export function injectedPayment({ key, blocklist, nowMs, phishAccount }) {
  const review = reviewCounterparty({
    accountId: phishAccount,
    blocklist,
    nowMs,
    createdMs: nowMs,
    priorPayments: 0,
    amount: 100_000_000,
  });
  const transfer = authorize(key, {
    type: "transfer",
    receiverId: phishAccount,
    method: "transfer",
    gas: 30,
  });
  const foreignCall = authorize(key, {
    type: "function_call",
    receiverId: phishAccount,
    method: "pay",
    gas: 30,
  });
  return {
    review,
    transfer,
    foreignCall,
    paid: false,
  };
}
