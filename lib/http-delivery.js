import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const TEXTUAL_CONTENT_TYPE = /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml)|image\/svg\+xml)/i;

function acceptedEncodings(value = "") {
  const priorities = new Map();
  String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [name, ...parameters] = part.split(";").map((item) => item.trim().toLowerCase());
      let quality = 1;
      for (const parameter of parameters) {
        const match = parameter.match(/^q=(0(?:\.\d+)?|1(?:\.0+)?)$/);
        if (match) quality = Number(match[1]);
      }
      priorities.set(name, quality);
    });
  return priorities;
}

export function preferredEncoding(header = "") {
  const accepted = acceptedEncodings(header);
  const wildcard = accepted.get("*") ?? 0;
  const brotli = accepted.get("br") ?? wildcard;
  const gzip = accepted.get("gzip") ?? wildcard;
  if (brotli > 0 && brotli >= gzip) return "br";
  if (gzip > 0) return "gzip";
  return "identity";
}

export function isCompressible(contentType = "", byteLength = 0) {
  return byteLength >= 1024 && TEXTUAL_CONTENT_TYPE.test(String(contentType));
}

export function createPayloadVariants(value, contentType = "application/octet-stream") {
  const identity = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const variants = { identity };
  if (isCompressible(contentType, identity.byteLength)) {
    variants.br = brotliCompressSync(identity, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: identity.byteLength,
      },
    });
    variants.gzip = gzipSync(identity, { level: 6 });
  }
  return {
    etag: `W/"${createHash("sha256").update(identity).digest("base64url").slice(0, 22)}"`,
    byteLength: identity.byteLength,
    variants,
  };
}

export function selectPayload(payload, acceptEncoding = "") {
  const preferred = preferredEncoding(acceptEncoding);
  const encoding = payload.variants[preferred] ? preferred : "identity";
  return {
    body: payload.variants[encoding],
    encoding,
  };
}

export function requestEtagMatches(header = "", etag = "") {
  if (!header || !etag) return false;
  const target = String(etag).replace(/^W\//i, "");
  return String(header)
    .split(",")
    .map((value) => value.trim().replace(/^W\//i, ""))
    .some((value) => value === "*" || value === target);
}
