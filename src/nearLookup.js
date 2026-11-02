/**
 * Read-only NEAR mainnet lookup. No key. No transaction.
 * view_account confirms the account exists. nearblocks supplies
 * created.block_timestamp when the indexer has it (nanoseconds).
 */

const RPC = "https://rpc.mainnet.near.org";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

export async function lookupAccount(accountId, { rpc = RPC } = {}) {
  const view = await postJson(rpc, {
    jsonrpc: "2.0",
    id: "till",
    method: "query",
    params: {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    },
  });
  if (view.error) {
    return { accountId, exists: false, error: view.error.message ?? "rpc error" };
  }
  const result = view.result ?? {};
  let createdMs = null;
  try {
    const indexed = await fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(accountId)}`);
    if (indexed.ok) {
      const body = await indexed.json();
      const row = Array.isArray(body.account) ? body.account[0] : body.account;
      const ts = row?.created?.block_timestamp;
      if (typeof ts === "number" && ts > 0) {
        createdMs = Math.floor(ts / 1_000_000);
      }
    }
  } catch {
    createdMs = null;
  }
  return {
    accountId,
    exists: true,
    amountYocto: result.amount ?? null,
    codeHash: result.code_hash ?? null,
    createdMs,
  };
}
