/**
 * Local model of a NEAR function-call access key.
 * The agent holds this key. It does not hold a full-access key.
 *
 * A function-call key can call only the named methods on one contract,
 * and only until its gas allowance is spent. It cannot transfer NEAR,
 * add a key, or delete a key. If the allowance hits zero, the account
 * can lock itself out of that key. See
 * https://docs.near.org/protocol/accounts-contracts/access-keys
 */

export function functionCallKey({ contractId, methods, allowance }) {
  if (!contractId || !Array.isArray(methods) || methods.length === 0) {
    throw new Error("function-call key needs a contract and at least one method");
  }
  if (!Number.isInteger(allowance) || allowance <= 0) {
    throw new Error("allowance must be a positive integer of gas units");
  }
  return {
    type: "function_call",
    contractId,
    methods: [...methods],
    allowance,
  };
}

export function authorize(key, action) {
  if (!key || key.type !== "function_call") {
    return { ok: false, reason: "agent has no function-call key" };
  }
  if (action.type === "transfer" || action.type === "add_key" || action.type === "delete_key") {
    return {
      ok: false,
      reason: "a function-call key cannot transfer NEAR or change keys",
    };
  }
  if (action.receiverId !== key.contractId) {
    return {
      ok: false,
      reason: `receiver ${action.receiverId} is outside the key scope ${key.contractId}`,
    };
  }
  if (action.type !== "function_call") {
    return { ok: false, reason: `action ${action.type} is not a function call` };
  }
  if (!key.methods.includes(action.method)) {
    return { ok: false, reason: `method ${action.method} is not on the key` };
  }
  const gas = action.gas ?? 0;
  if (!Number.isInteger(gas) || gas <= 0) {
    return { ok: false, reason: "gas must be a positive integer" };
  }
  if (gas > key.allowance) {
    return { ok: false, reason: "gas allowance exhausted" };
  }
  return { ok: true, allowanceLeft: key.allowance - gas };
}
