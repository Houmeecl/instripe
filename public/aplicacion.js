const stage = document.getElementById("stage");
const mode = document.getElementById("app-mode");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStep(id) {
  const order = ["tos", "space", "dash"];
  const current = order.indexOf(id);
  document.querySelectorAll("#steps li").forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle("current", item.dataset.step === id);
    item.classList.toggle("done", index > -1 && index < current);
  });
}

function showTos() {
  mode.textContent = "Términos";
  setStep("tos");
  stage.innerHTML = `
    <form id="tos-form" class="tos">
      <h2>Acepta los términos</h2>
      <p>Lee y acepta los términos para continuar al inicio de sesión.</p>
      <p>Aceptar no crea una cuenta ni reemplaza tu clave. El dashboard requiere credenciales habilitadas por el equipo.</p>
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
      showAccepted();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Acepto los términos";
    }
  });
}

function showAccepted() {
  mode.textContent = "Términos aceptados";
  setStep("space");
  stage.innerHTML = `
    <div class="empty-space">
      <h2>Términos aceptados</h2>
      <p>La aceptación quedó registrada, pero no inicia sesión ni crea una cuenta de acceso.</p>
      <p>Para entrar al dashboard necesitas el correo y la clave que te haya habilitado el equipo. Si todavía no tienes credenciales, solicita acceso a Operación.</p>
      <a class="dash-link" href="/operacion" target="_top">Ir al inicio de sesión</a>
    </div>`;
}

fetch("/api/onboarding")
  .then((res) => res.json())
  .then((session) => (session.accepted ? showAccepted() : showTos()))
  .catch((error) => {
    stage.innerHTML = `<p class="tos-error" role="alert">${escapeHtml(error.message)}</p>`;
  });
