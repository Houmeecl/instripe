const root = document.getElementById("members");

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

fetch("/api/registro")
  .then((res) => {
    if (!res.ok) throw new Error("No se pudo cargar el registro");
    return res.json();
  })
  .then((data) => {
    const members = data.members || [];
    if (!members.length) {
      root.innerHTML = `<p class="loading">No hay preinscritos.</p>`;
      return;
    }
    root.innerHTML = members
      .map(
        (member) => `
        <article class="member">
          <div>
            <h2>${escapeHtml(member.name)}</h2>
            <p>${escapeHtml(member.email)} · ${escapeHtml(member.city)}</p>
          </div>
          <div class="member-meta">
            <span class="pill">${roleLabel(member.role)}</span>
            <span class="pill on">Preinscrito</span>
            <b>${escapeHtml(member.displayBalance || "$0")}</b>
          </div>
        </article>`,
      )
      .join("");
  })
  .catch((error) => {
    root.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  });
