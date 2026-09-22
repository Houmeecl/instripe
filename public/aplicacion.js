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

function showTos() {
  mode.textContent = "Términos";
  stage.innerHTML = `
    <form id="tos-form" class="tos">
      <h2>Términos</h2>
      <p>Al aceptar, entras a la aplicación. Ese espacio ya está ocupado por los preinscritos.</p>
      <label>Nombre<input name="name" required autocomplete="name" /></label>
      <label>Email<input name="email" type="email" required autocomplete="email" /></label>
      <label class="check"><input name="accepted" type="checkbox" required /> Acepto los términos de Proveedor Regional.</label>
      <button type="submit">Acepto los términos</button>
      <p id="tos-error" class="tos-error" hidden></p>
    </form>`;
  document.getElementById("tos-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = document.getElementById("tos-error");
    error.hidden = true;
    const body = {
      name: form.name.value,
      email: form.email.value,
      accepted: form.accepted.checked,
    };
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.textContent = data.error || "No se pudieron aceptar los términos";
      error.hidden = false;
      return;
    }
    await showOccupied();
  });
}

async function showOccupied() {
  mode.textContent = "Aplicación ocupada";
  const res = await fetch("/api/registro");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo cargar la aplicación");
  const members = data.members || [];
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
  stage.innerHTML = `<p class="occupied-note">Esta aplicación ya está ocupada.</p>${cards}`;
}

fetch("/api/onboarding")
  .then((res) => res.json())
  .then((session) => (session.accepted ? showOccupied() : showTos()))
  .catch((error) => {
    stage.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  });
