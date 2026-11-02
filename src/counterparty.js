/**
 * Counterparty check run before any payment.
 * Verdicts: allow, warn, block.
 * Block refuses the signature. Warn waits for a human.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewCounterparty({
  accountId,
  blocklist,
  nowMs,
  createdMs,
  codeChangedMs,
  priorPayments,
  amount,
}) {
  const reasons = [];
  if (!accountId || !/^[a-z0-9._-]+$/.test(accountId)) {
    return { verdict: "block", reasons: ["receiver is not a NEAR account id"] };
  }
  if (blocklist?.has(accountId)) {
    return { verdict: "block", reasons: ["shared blocklist"] };
  }
  if (createdMs == null) {
    reasons.push("account age unknown");
  } else if (nowMs - createdMs < 7 * DAY_MS) {
    reasons.push("account is younger than 7 days");
  }
  if (codeChangedMs != null && nowMs - codeChangedMs < 2 * DAY_MS) {
    reasons.push("contract code changed in the last 2 days");
  }
  const prior = priorPayments ?? 0;
  if (prior === 0 && amount > 1_000_000) {
    reasons.push("first payment to this receiver is above 1 NEAR");
  }
  if (reasons.length === 0) {
    return { verdict: "allow", reasons: ["known receiver, stable code, aged account"] };
  }
  return { verdict: "warn", reasons };
}
