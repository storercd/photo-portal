const form = document.getElementById("contact-form");
const status = document.getElementById("contact-status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  status.textContent = "Sending…";
  try {
    const res = await fetch("/api/contact", { method: "POST", body: new FormData(form) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not send (HTTP ${res.status}).`);
    form.reset();
    status.textContent = "Thank you! Your message was sent.";
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
    window.turnstile?.reset();
  }
});
