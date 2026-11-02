const form = document.getElementById("private-form");
const status = document.getElementById("private-status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  status.textContent = "Checking…";
  try {
    const res = await fetch("/private/login", { method: "POST", body: new FormData(form) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not sign in (HTTP ${res.status}).`);
    location.assign(`/galleries?p=${encodeURIComponent(data.slug)}`);
  } catch (err) {
    status.textContent = err.message;
    form.password.value = "";
    window.turnstile?.reset();
    button.disabled = false;
  }
});
