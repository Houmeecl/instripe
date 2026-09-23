const stage = document.getElementById("stage");
const mode = document.getElementById("app-mode");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleLabel(role) {
  return role === "titular" ? "Titular" : "Comercio";
}

function setStep(id) {
  document.querySelectorAll("#steps li").forEach((item) => {
    const step = item.dataset.step;
    item.classList.toggle("current", step === id);
    item.classList.toggle("done", id === "space" && step === "tos");
  });
}

function showTos() {
  mode.textContent = "Términos";
  setStep("tos");
  stage.innerHTML = `
    <form id="tos-form" class="tos">
      <h2>Acepta los términos</h2>
      <p>Este es el onboarding. Al aceptar entras a la aplicación, que ya está ocupada por los preinscritos.</p>
      <label>Nombre<input name="name" required autocomplete="name" /></label>
      <label>Email<input name="email" type="email" required autocomplete="email" /></label>
      <label class="check"><input name="accepted" type="checkbox" required /> Acepto los términos de Proveedor Regional.</label>
      <button type="submit">Acepto los términos</button>
      <p id="tos-error" class="tos-error" role="alert" hidden></p>
    </form>`;
  document.getElementById("tos-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = document.getElementById("tos-error");
    const button = form.querySelector("button");
    error.hidden = true;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    if (!name || !email.includes("@") || !form.accepted.checked) {
      error.textContent = "Completa nombre, email y la aceptación.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "Aceptando…";
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, accepted: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.textContent = data.error || "No se pudieron aceptar los términos";
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Acepto los términos";
      return;
    }
    try {
      await showOccupied();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Acepto los términos";
    }
  });
}

async function showOccupied() {
  mode.textContent = "Aplicación ocupada";
  setStep("space");
  const res = await fetch("/api/registro");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo cargar la aplicación");
  const members = data.members || [];
  if (!members.length) {
    stage.innerHTML = `
      <div class="empty-space">
        <h2>Espacio ocupado</h2>
        <p>Todavía no hay preinscritos en esta aplicación.</p>
        <a class="dash-link" href="/operacion" target="_top">Abrir dashboard</a>
      </div>`;
    return;
  }
  const cards = members
    .map(
      (member) => `
      <article class="member">
        <div>
          <h2>${escapeHtml(member.name)}</h2>
          <p>${escapeHtml(member.email)} · ${escapeHtml(member.city)}</p>
        </div>
        <div class="member-meta">
          <span class="pill">${roleLabel(member.role)}</span>
          <span class="pill on">Ocupado</span>
          <b>${escapeHtml(member.displayBalance || "$0")}</b>
        </div>
      </article>`,
    )
    .join("");
  stage.innerHTML = `
    <p class="occupied-note">Esta aplicación ya está ocupada.</p>
    ${cards}
    <a class="dash-link" href="/operacion" target="_top">Abrir dashboard</a>`;
}

fetch("/api/onboarding")
  .then((res) => res.json())
  .then((session) => (session.accepted ? showOccupied() : showTos()))
  .catch((error) => {
    stage.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  });
