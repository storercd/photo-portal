// POST /private/login: checks Turnstile and the password, then sets a signed cookie for the
// matching private collection and returns its slug.
import {
  COOKIE_MAX_AGE,
  cookieName,
  cookiePath,
  findCollection,
  makeToken,
} from "../_lib/private-auth.js";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export async function onRequestPost({ request, env }) {
  if (!env.PRIVATE_COOKIE_SECRET) return json({ error: "Private area is not configured." }, 500);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const password = String(form.get("password") || "");
  if (!password || password.length > 200) return json({ error: "Incorrect password." }, 401);

  const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: String(form.get("cf-turnstile-response") || ""),
      remoteip: request.headers.get("CF-Connecting-IP") || "",
    }),
  });
  if (!(await check.json()).success) {
    return json({ error: "Verification failed. Please try again." }, 400);
  }

  const slug = await findCollection(password, env);
  if (!slug) return json({ error: "Incorrect password." }, 401);

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const cookie = `${cookieName(slug)}=${await makeToken(slug, env)}; Path=${cookiePath(slug)}; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
  return json({ slug }, 200, { "set-cookie": cookie });
}
