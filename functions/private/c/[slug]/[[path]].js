// GET /private/c/<slug>/<path>: serves <slug>/<path> from the private R2 bucket (binding
// PRIVATE_BUCKET) to visitors holding the signed cookie for that collection.
import { SLUG_RE, hasAccess } from "../../../_lib/private-auth.js";

const deny = (status, text) =>
  new Response(text, { status, headers: { "cache-control": "no-store" } });

function contentRange(range, size) {
  const offset = range.suffix !== undefined ? size - range.suffix : (range.offset ?? 0);
  const length = range.suffix !== undefined ? range.suffix : (range.length ?? size - offset);
  return `bytes ${offset}-${offset + length - 1}/${size}`;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return deny(405, "Method not allowed");
  }
  const { slug } = params;
  const parts = [params.path].flat().filter(Boolean);
  if (!SLUG_RE.test(slug) || !parts.length || parts.some((p) => p === "." || p === "..")) {
    return deny(404, "Not found");
  }
  if (!(await hasAccess(request, slug, env))) return deny(401, "Password required");

  const key = `${slug}/${parts.join("/")}`;
  const object = await env.PRIVATE_BUCKET.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return deny(404, "Not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set(
    "cache-control",
    key.endsWith(".json") ? "private, no-cache" : "private, max-age=86400",
  );
  if (!object.body) return new Response(null, { status: 304, headers });

  let status = 200;
  if (object.range && request.headers.has("range")) {
    status = 206;
    headers.set("content-range", contentRange(object.range, object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}
