const state = {
  currency: "clp",
  defaultGateway: "chile",
  gateways: [],
  health: {},
  overview: { float: { balance: 0, displayBalance: "—" }, policies: [], claims: [] },
  plans: [],
  stripeEvents: [],
};

/* ---------------- icons ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  shield: '<path d="M12 3 5 6v5c0 5 3.5 8 7 10 3.5-2 7-5 7-10V6l-7-3Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M18 12h3v4h-3a2 2 0 0 1 0-4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6l3-7Z"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

const NAV = [
  { route: "overview", label: "Resumen", icon: "home", title: "Resumen", sub: "Vista general de la plataforma" },
  { route: "plans", label: "Planes", icon: "layers", title: "Planes de seguro", sub: "Catálogo de productos y contratación" },
  { route: "policies", label: "Pólizas", icon: "shield", title: "Pólizas", sub: "Pólizas activas y dispersión de siniestros" },
  { route: "claims", label: "Siniestros", icon: "file", title: "Siniestros", sub: "Historial de dispersiones de fondos" },
  { route: "payments", label: "Pagos", icon: "card", title: "Pagos y pasarelas", sub: "Estado de Stripe y la pasarela chilena" },
];

/* ---------------- helpers ---------------- */
function money(amount, currency = state.currency) {
  const zero = ["clp", "jpy", "krw"].includes(currency);
  const value = zero ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(currency === "clp" ? "es-CL" : "en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: zero ? 0 : 2,
    }).format(value);
  } catch {
    return `${value} ${currency.toUpperCase()}`;
  }
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function selectedGateway() {
  const sel = document.getElementById("gateway");
  return (sel && sel.value) || state.defaultGateway;
}

function gatewayLabel(name) {
  const g = state.gateways.find((x) => x.name === name);
  return g ? g.label : name;
}

function toast(message, kind = "ok") {
  const el = document.getElementById("toast");
  const ic = kind === "error" ? icon("bell") : icon("check");
  el.className = `toast ${kind}`;
  el.innerHTML = `${ic}<span>${message}</span>`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 4200);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/* ---------------- boot ---------------- */
async function boot() {
  renderNav();
  try {
    state.health = await api("/health");
    state.currency = state.health.currency;
    state.defaultGateway = state.health.defaultGateway;
    const gw = await api("/api/gateways");
    state.gateways = gw.gateways;
    state.defaultGateway = gw.defaultGateway;
    renderGatewaySelect();
    const plans = await api("/api/plans");
    state.plans = plans.plans;
    await refresh();
  } catch (err) {
    toast("Error al iniciar: " + err.message, "error");
  }
  window.addEventListener("hashchange", route);
  route();
}

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = NAV.map(
    (n) => `<a href="#/${n.route}" data-route="${n.route}">${icon(n.icon)}<span>${n.label}</span></a>`,
  ).join("");
}

function renderGatewaySelect() {
  const sel = document.getElementById("gateway");
  sel.innerHTML = state.gateways
    .map(
      (g) =>
        `<option value="${g.name}" ${g.name === state.defaultGateway ? "selected" : ""}>${g.label} · ${g.configured ? "live" : "demo"}</option>`,
    )
    .join("");
  sel.onchange = () => {
    updateModeBadge();
    route();
  };
  updateModeBadge();
}

function updateModeBadge() {
  const badge = document.getElementById("mode-badge");
  const g = state.gateways.find((x) => x.name === selectedGateway());
  const live = g && g.configured;
  badge.textContent = live ? "modo live" : "modo demo";
  badge.className = "badge" + (live ? " live" : "");
  const chip = document.getElementById("env-chip");
  const chipText = document.getElementById("env-chip-text");
  chip.className = "env-chip" + (live ? " live" : "");
  chipText.textContent = live ? "Live" : "Sandbox";
}

async function refresh() {
  state.overview = await api("/api/overview");
  try {
    const ev = await api("/api/stripe/events");
    state.stripeEvents = ev.events || [];
  } catch {
    state.stripeEvents = [];
  }
}

/* ---------------- router ---------------- */
function currentRoute() {
  const r = (location.hash || "#/overview").replace("#/", "");
  return NAV.find((n) => n.route === r) ? r : "overview";
}

function route() {
  const r = currentRoute();
  const meta = NAV.find((n) => n.route === r);
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-subtitle").textContent = meta.sub;
  document.querySelectorAll("#nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === r);
  });
  const view = document.getElementById("view");
  view.innerHTML = VIEWS[r]();
  wireView(r);
}

/* ---------------- views ---------------- */
const VIEWS = {
  overview: viewOverview,
  plans: viewPlans,
  policies: viewPolicies,
  claims: viewClaims,
  payments: viewPayments,
};

function viewOverview() {
  const o = state.overview;
  const activePolicies = o.policies.length;
  const kpi = `
    <div class="grid-kpi">
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-ico">${icon("wallet")}</div></div>
        <div class="kpi-label">Float asegurador</div>
        <div class="kpi-value">${o.float.displayBalance}</div>
        <div class="kpi-hint">Primas acumuladas menos siniestros</div>
      </div>
      <div class="kpi green">
        <div class="kpi-top"><div class="kpi-ico">${icon("shield")}</div></div>
        <div class="kpi-label">Pólizas activas</div>
        <div class="kpi-value">${activePolicies}</div>
        <div class="kpi-hint">Clientes con cobertura vigente</div>
      </div>
      <div class="kpi amber">
        <div class="kpi-top"><div class="kpi-ico">${icon("file")}</div></div>
        <div class="kpi-label">Siniestros dispersados</div>
        <div class="kpi-value">${o.claims.length}</div>
        <div class="kpi-hint">Payouts realizados a beneficiarios</div>
      </div>
    </div>`;

  const feed = o.claims.length
    ? `<ul class="feed">${[...o.claims].reverse().map((c) => `
        <li>
          <div class="fi">${icon("zap")}</div>
          <div>
            <div class="ft"><b>${money(c.amount)}</b> dispersado a ${c.beneficiary}</div>
            <div class="fdate"><code class="mono">${c.id}</code> · ${c.status}</div>
          </div>
        </li>`).join("")}</ul>`
    : `<div class="empty">${icon("inbox")}<div>Aún no hay actividad. Contrata un plan y dispersa un siniestro.</div></div>`;

  const quick = `
    <div class="card">
      <div class="card-head"><h3>Acciones rápidas</h3></div>
      <div class="card-body">
        <button class="btn btn-primary btn-block" onclick="location.hash='#/plans'">${icon("plus")} Contratar una póliza</button>
        <div style="height:10px"></div>
        <button class="btn btn-ghost btn-block" onclick="location.hash='#/payments'">${icon("card")} Ver estado de pasarelas</button>
      </div>
    </div>`;

  return `${kpi}
    <div class="cols">
      <div class="card">
        <div class="card-head"><h3>Actividad reciente</h3><a class="btn btn-ghost btn-sm" href="#/claims">Ver todo</a></div>
        <div class="card-body flush">${feed}</div>
      </div>
      ${quick}
    </div>`;
}

function viewPlans() {
  const cards = state.plans
    .map((p, i) => {
      const featured = i === 1;
      const feats = [
        `Cobertura hasta ${p.displayCoverage}`,
        "Contratación 100% digital",
        "Dispersión de siniestros en 1 clic",
      ];
      return `
      <div class="plan ${featured ? "featured" : ""}">
        ${featured ? '<span class="ribbon">Recomendado</span>' : ""}
        <h3>${p.name}</h3>
        <p class="plan-desc">${p.description}</p>
        <div class="price"><b>${p.displayPremium}</b><span>/mes</span></div>
        <div class="coverage">Cobertura hasta ${p.displayCoverage}</div>
        <ul class="features">${feats.map((f) => `<li>${icon("check")}${f}</li>`).join("")}</ul>
        <button class="btn btn-primary btn-block" data-plan="${p.id}">${icon("plus")} Contratar</button>
      </div>`;
    })
    .join("");
  return `<div class="plans">${cards}</div>`;
}

function viewPolicies() {
  const rows = state.overview.policies;
  if (!rows.length) {
    return `<div class="card"><div class="card-body"><div class="empty">${icon("shield")}<div>No hay pólizas todavía. Ve a <a href="#/plans">Planes</a> para contratar una.</div></div></div></div>`;
  }
  const list = rows
    .map(
      (p) => `
      <div class="row">
        <div class="avatar">${initials(p.holderName)}</div>
        <div>
          <div class="who">${p.holderName}</div>
          <div class="meta"><code class="mono">${p.id}</code> · plan ${p.planId}</div>
        </div>
        <div class="push">
          <span class="pill">${p.status}</span>
          <button class="btn btn-ghost btn-sm" data-claim="${p.id}">${icon("zap")} Dispersar siniestro</button>
        </div>
      </div>`,
    )
    .join("");
  return `<div class="card"><div class="card-head"><h3>Pólizas (${rows.length})</h3><a class="btn btn-primary btn-sm" href="#/plans">${icon("plus")} Nueva</a></div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewClaims() {
  const rows = state.overview.claims;
  if (!rows.length) {
    return `<div class="card"><div class="card-body"><div class="empty">${icon("file")}<div>Sin siniestros dispersados aún.</div></div></div></div>`;
  }
  const body = [...rows]
    .reverse()
    .map(
      (c) => `
      <tr>
        <td><code class="mono">${c.id}</code></td>
        <td class="amt-pos">${money(c.amount)}</td>
        <td>${c.beneficiary}</td>
        <td><span class="pill ${c.status === "paid" ? "" : "amber"}">${c.status}</span></td>
        <td><code class="mono">${c.payoutId}</code></td>
      </tr>`,
    )
    .join("");
  return `<div class="card"><div class="card-head"><h3>Siniestros dispersados</h3></div><div class="card-body flush">
    <table class="tbl"><thead><tr><th>ID</th><th>Monto</th><th>Beneficiario</th><th>Estado</th><th>Payout</th></tr></thead><tbody>${body}</tbody></table>
  </div></div>`;
}

function viewPayments() {
  const h = state.health;
  const statusItem = (label, on, ic) => `
    <div class="status-item">
      <div class="si-ic">${icon(ic)}</div>
      <div><div class="si-label">${label}</div><div class="si-value ${on ? "on" : "off"}">${on ? "Conectado" : "Modo demo"}</div></div>
    </div>`;

  const events = state.stripeEvents.length
    ? `<ul class="feed">${state.stripeEvents.map((e) => `
        <li><div class="fi">${icon("activity")}</div>
          <div><div class="ft"><b>${e.type}</b></div>
          <div class="fdate"><code class="mono">${e.id}</code></div></div>
        </li>`).join("")}</ul>`
    : `<div class="empty">${icon("inbox")}<div>Sin eventos de webhook. Ejecuta <code class="mono">stripe trigger checkout.session.completed</code>.</div></div>`;

  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><h3>Estado de pasarelas</h3><span class="badge ${h.stripeConfigured ? "live" : ""}">${h.currency ? h.currency.toUpperCase() : ""}</span></div>
      <div class="card-body">
        <div class="status-grid">
          ${statusItem("Stripe", h.stripeConfigured, "card")}
          ${statusItem("Webhooks Stripe", h.stripeWebhookConfigured, "bell")}
          ${statusItem("Pasarela Chile", h.chileConfigured, "wallet")}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Eventos de webhook de Stripe</h3></div>
      <div class="card-body flush">${events}</div>
    </div>`;
}

/* ---------------- view wiring ---------------- */
function wireView(r) {
  if (r === "plans") {
    document.querySelectorAll("[data-plan]").forEach((btn) => {
      btn.onclick = () => openSubscribeModal(state.plans.find((p) => p.id === btn.dataset.plan));
    });
  }
  if (r === "policies") {
    document.querySelectorAll("[data-claim]").forEach((btn) => {
      btn.onclick = () => openClaimModal(state.overview.policies.find((p) => p.id === btn.dataset.claim));
    });
  }
}

/* ---------------- modals ---------------- */
function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function mountModal(html) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="overlay" data-overlay>${html}</div>`;
  root.querySelector("[data-overlay]").addEventListener("click", (e) => {
    if (e.target.dataset.overlay !== undefined) closeModal();
  });
}

function openSubscribeModal(plan) {
  if (!plan) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Contratar ${plan.name}</h3><p>Se cobrará la prima de ${plan.displayPremium}/mes vía ${gatewayLabel(selectedGateway())}.</p></div>
      <div class="modal-body">
        <div class="field"><label>Nombre del titular</label><input id="m-name" value="Constructora Andes SpA" /></div>
        <div class="field"><label>Email</label><input id="m-email" type="email" value="ops@andes.cl" /></div>
        <div class="field"><label>Pasarela</label>
          <select id="m-gateway">${state.gateways.map((g) => `<option value="${g.name}" ${g.name === selectedGateway() ? "selected" : ""}>${g.label} · ${g.configured ? "live" : "demo"}</option>`).join("")}</select>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("check")} Contratar</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = "Procesando…";
    try {
      const result = await api("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          holderName: document.getElementById("m-name").value || "Cliente",
          email: document.getElementById("m-email").value || "cliente@demo.cl",
          gateway: document.getElementById("m-gateway").value,
        }),
      });
      closeModal();
      await refresh();
      route();
      toast(`Póliza ${result.policy.id} activada · cobro vía ${result.charge.gateway} (${result.charge.mode})`);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon("check")} Contratar`;
      toast(err.message, "error");
    }
  };
}

function openClaimModal(policy) {
  if (!policy) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Dispersar siniestro</h3><p>Payout desde el float al beneficiario · póliza ${policy.id}.</p></div>
      <div class="modal-body">
        <div class="field"><label>Monto del siniestro</label><input id="c-amount" type="number" placeholder="Ej: 20000" />
          <div class="hint">Cobertura máxima: ${money(policy.coverage)}</div></div>
        <div class="field"><label>Beneficiario (RUT o cuenta)</label><input id="c-benef" value="12.345.678-9" /></div>
        <div class="field"><label>Pasarela de dispersión</label>
          <select id="c-gateway">${state.gateways.map((g) => `<option value="${g.name}" ${g.name === selectedGateway() ? "selected" : ""}>${g.label} · ${g.configured ? "live" : "demo"}</option>`).join("")}</select>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("zap")} Dispersar fondos</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const amount = Number(document.getElementById("c-amount").value);
    if (!amount) return toast("Ingresa un monto de siniestro", "error");
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = "Dispersando…";
    try {
      const result = await api("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policy.id,
          amount,
          beneficiary: document.getElementById("c-benef").value || "beneficiario-demo",
          gateway: document.getElementById("c-gateway").value,
        }),
      });
      closeModal();
      await refresh();
      route();
      toast(`Fondos dispersados: ${result.claim.id} vía ${result.payout.gateway} (${result.payout.status})`);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon("zap")} Dispersar fondos`;
      toast(err.message, "error");
    }
  };
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

boot();
