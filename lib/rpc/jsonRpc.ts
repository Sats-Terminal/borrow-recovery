export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

export type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id: number;
  result: T;
};

export type JsonRpcError = {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string; data?: unknown };
};

export async function jsonRpcFetch<T>(
  url: string,
  method: string,
  params?: unknown,
): Promise<T> {
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1_000_000),
    method,
    ...(params === undefined ? {} : { params }),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC ${method} failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as JsonRpcSuccess<T> | JsonRpcError;
  if ("error" in json) {
    const err = new Error(`RPC ${method} error: ${json.error.message}`);
    (err as unknown as Record<string, unknown>).code = json.error.code;
    (err as unknown as Record<string, unknown>).data = json.error.data;
    throw err;
  }
  return json.result;
}
