// POST /api/contact: verifies Turnstile, then emails the message via Resend.
// Env (Pages secrets/vars): RESEND_API_KEY, TURNSTILE_SECRET, CONTACT_TO, CONTACT_FROM.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function onRequestPost({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (form.get("website")) return json({ ok: true }); // honeypot: pretend success

  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const message = String(form.get("message") || "").trim();
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please fill in all fields with a valid email." }, 400);
  }
  if (name.length > 200 || email.length > 200 || message.length > 5000) {
    return json({ error: "Message is too long." }, 400);
  }

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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM || "Photo Portal <onboarding@resend.dev>",
      to: [env.CONTACT_TO],
      reply_to: email,
      subject: `Photo portal message from ${name}`,
      text: `From: ${name} <${email}>\n\n${message}`,
    }),
  });
  if (!res.ok) return json({ error: "Could not send. Please try again later." }, 502);
  return json({ ok: true });
}
