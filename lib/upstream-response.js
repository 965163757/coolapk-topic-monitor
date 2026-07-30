import { Buffer } from "node:buffer";

export function upstreamResponseMetadata(response, text) {
  return {
    status: Number(response?.status) || 0,
    contentType: String(response?.headers?.get?.("content-type") || ""),
    length: Buffer.byteLength(String(text || ""), "utf8"),
  };
}

export function invalidUpstreamResponseError() {
  return Object.assign(new Error("酷安上游返回了无效响应"), {
    statusCode: 502,
    code: "UPSTREAM_INVALID_RESPONSE",
  });
}

export function parseUpstreamJsonObject(response, text, { onInvalid = () => {} } = {}) {
  let payload;
  try {
    payload = JSON.parse(String(text || ""));
  } catch {
    onInvalid(upstreamResponseMetadata(response, text));
    throw invalidUpstreamResponseError();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    onInvalid(upstreamResponseMetadata(response, text));
    throw invalidUpstreamResponseError();
  }
  return payload;
}
