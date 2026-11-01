// Shared helpers for private collections: password hashes and signed per-collection cookies.
// Env: PRIVATE_PASSWORDS (JSON {slug: "pbkdf2$iterations$salt$hash"}), PRIVATE_COOKIE_SECRET.
const enc = new TextEncoder();

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const COOKIE_MAX_AGE = 7 * 24 * 3600;
export const cookieName = (slug) => `pc_${slug}`;
export const cookiePath = (slug) => `/private/c/${slug}`;

const b64u = {
  encode: (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", ""),
  decode: (str) =>
    Uint8Array.from(atob(str.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)),
};

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64u.encode(salt)}$${b64u.encode(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const derived = await pbkdf2(password, b64u.decode(salt), Number(iterations));
  return equal(derived, b64u.decode(hash));
}

// Returns the slug whose password matches, or null.
export async function findCollection(password, env) {
  let table;
  try {
    table = JSON.parse(env.PRIVATE_PASSWORDS || "{}");
  } catch {
    return null;
  }
  for (const [slug, stored] of Object.entries(table)) {
    if (SLUG_RE.test(slug) && (await verifyPassword(password, stored))) return slug;
  }
  return null;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function makeToken(slug, env) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  return `${exp}.${b64u.encode(await hmac(env.PRIVATE_COOKIE_SECRET, `${slug}.${exp}`))}`;
}

export async function hasAccess(request, slug, env) {
  if (!env.PRIVATE_COOKIE_SECRET) return false;
  const jar = request.headers.get("cookie") || "";
  const match = jar.split(/;\s*/).find((c) => c.startsWith(`${cookieName(slug)}=`));
  if (!match) return false;
  const [exp, sig] = match.slice(cookieName(slug).length + 1).split(".");
  if (!sig || !(Number(exp) > Date.now() / 1000)) return false;
  try {
    return equal(await hmac(env.PRIVATE_COOKIE_SECRET, `${slug}.${exp}`), b64u.decode(sig));
  } catch {
    return false;
  }
}
