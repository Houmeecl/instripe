const state = {
  currency: "clp",
  defaultGateway: "chile",
  gateways: [],
  health: {},
  overview: { float: { balance: 0, displayBalance: "—" }, policies: [], claims: [], payments: [], modules: [] },
  plans: [],
  accounts: [],
  cobros: [],
  connect: [],
  treasury: [],
  cards: [],
  issuing: null,
  companies: [],
  canCreateCompany: false,
  courses: [],
  sicr3p: null,
  actuarial: [],
  frosting: null,
  design: null,
  appManifest: null,
  stripeEvents: [],
  onboarding: null,
  registro: null,
  user: null,
  exits: [],
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
  {
    group: "Operación",
    items: [
      { route: "overview", label: "Inicio", icon: "home", title: "Inicio", sub: "Tus datos y la entrada a cursos." },
      { route: "correo", label: "Correo", icon: "inbox", title: "Correo", sub: "Bandeja de la empresa." },
      { route: "clases", label: "Cursos", icon: "layers", title: "Cursos", sub: "Gestión financiera, débito, gastos, seguros y riesgos." },
      { route: "configuracion", label: "Configuración", icon: "file", title: "Configuración", sub: "SICR3P es un sitio externo. Este panel no reenvía su tráfico." },
      { route: "actuarial", label: "Tasas", icon: "activity", title: "Vista actuarial", sub: "Clases de riesgo de Frosting. Aparte de los cursos." },
    ],
  },
  {
    group: "Cuentas",
    items: [
      { route: "accounts", label: "Cuentas", icon: "wallet", title: "Cuentas", sub: "Saldos de clientes" },
    ],
  },
  {
    group: "Cobros",
    items: [
      { route: "cobros", label: "Cobros", icon: "file", title: "Cobros", sub: "Cobros sueltos a un pagador" },
    ],
  },
  {
    group: "Seguros",
    items: [
      { route: "plans", label: "Crédito TC", icon: "layers", title: "Crédito de la TC", sub: "La póliza cubre el cupo de la tarjeta" },
      { route: "policies", label: "Pólizas", icon: "shield", title: "Pólizas", sub: "Seguro del crédito de cada tarjeta" },
      { route: "claims", label: "Siniestros", icon: "zap", title: "Siniestros", sub: "Pagos a beneficiarios" },
    ],
  },
  {
    group: "Débito",
    items: [
      { route: "empresas", label: "Débito", icon: "card", title: "Tarjetas virtuales", sub: "Débito prepago. Sin plástico y sin línea de crédito." },
    ],
  },
  {
    group: "Finanzas",
    items: [
      { route: "connect", label: "Comercios", icon: "arrow", title: "Comercios", sub: "Cuentas de comercios de la plataforma" },
      { route: "treasury", label: "Caja", icon: "wallet", title: "Caja", sub: "Cuentas financieras. El abono entra por pagos" },
      { route: "cards", label: "Tarjetas", icon: "card", title: "Tarjetas", sub: "Tarjetas emitidas y su cupo" },
      { route: "design", label: "Diseño", icon: "layers", title: "Diseño y workflow", sub: "Marca, colores y el recorrido de la plataforma" },
      { route: "apps", label: "App", icon: "file", title: "App", sub: "Manifest de la aplicación" },
    ],
  },
  {
    group: "Admin técnico",
    tone: "tech",
    items: [
      { route: "payments", label: "Libro y pasarelas", icon: "activity", title: "Admin técnico", sub: "Ids, pasarelas, webhooks y el libro de pagos" },
    ],
  },
];

function allowed(option) {
  return Boolean(state.user && state.user.options.includes(option));
}

function visibleGroups() {
  const options = new Set((state.user && state.user.options) || []);
  const accountHolder = state.user && state.user.role !== "operacion";
  return NAV.map((group) => ({
    ...group,
    group: accountHolder && group.group === "Operación" ? "Cuenta" : group.group,
    items: group.items.filter((item) => options.has(item.route)),
  })).filter((group) => group.items.length);
}

function navItems() {
  return visibleGroups().flatMap((group) => group.items);
}

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

function applyDesign(design) {
  if (!design) return;
  document.documentElement.style.setProperty("--indigo", design.buttonColor);
  document.documentElement.style.setProperty("--bg", design.backgroundColor);
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
let routed = false;

async function boot() {
  document.getElementById("login-form").addEventListener("submit", onLogin);
  document.getElementById("logout").addEventListener("click", onLogout);
  document.getElementById("logout-top").addEventListener("click", onLogout);
  document.getElementById("change-pass").addEventListener("click", openPasswordModal);
  document.getElementById("change-pass-top").addEventListener("click", openPasswordModal);
  try {
    const session = await api("/api/session");
    if (session.user) await enter(session.user);
    else document.getElementById("gate").hidden = false;
  } catch (err) {
    document.getElementById("gate").hidden = false;
    showLoginError(err.message);
  }
}

function showLoginError(message) {
  const el = document.getElementById("login-error");
  el.hidden = !message;
  el.textContent = message || "";
}

async function onLogin(event) {
  event.preventDefault();
  const btn = event.currentTarget.querySelector("button[type=submit]");
  btn.disabled = true;
  showLoginError("");
  try {
    const data = await api("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value,
      }),
    });
    await enter(data.user);
  } catch (err) {
    showLoginError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function onLogout() {
  try {
    await api("/api/session", { method: "DELETE" });
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  state.user = null;
  document.querySelector(".app").hidden = true;
  document.getElementById("gate").hidden = false;
  document.getElementById("login-password").value = "";
  if (location.hash) history.replaceState({}, "", location.pathname + location.search);
}

async function enter(user) {
  state.user = user;
  document.getElementById("gate").hidden = true;
  document.querySelector(".app").hidden = false;
  document.getElementById("who-name").textContent = user.name;
  document.getElementById("who-role").textContent = user.roleLabel;
  document.getElementById("top-role").textContent = user.roleLabel;
  renderNav();
  if (user.mustChangePassword) {
    openPasswordModal(true);
    return;
  }
  await loadPanel();
}

async function loadPanel() {
  try {
    state.health = await api("/health");
    state.currency = state.health.currency;
    state.defaultGateway = state.health.defaultGateway;
    const gw = await api("/api/gateways");
    state.gateways = gw.gateways;
    state.defaultGateway = gw.defaultGateway;
    renderGatewaySelect();
    state.plans = allowed("plans") ? (await api("/api/plans")).plans : [];
    await refresh();
    await confirmReturnedCheckout();
  } catch (err) {
    toast("Error al iniciar: " + err.message, "error");
  }
  if (!routed) {
    window.addEventListener("hashchange", route);
    routed = true;
  }
  route();
}

function openPasswordModal(forced) {
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>${forced ? "Cambia la clave inicial" : "Cambiar clave"}</h3><p>${forced ? "La clave de inicio no sirve para operar. Elige una propia." : "La clave nueva queda solo en tu usuario."}</p></div>
      <div class="modal-body">
        <div class="field"><label>Clave actual</label><input id="pw-current" type="password" autocomplete="current-password" /></div>
        <div class="field"><label>Clave nueva</label><input id="pw-next" type="password" autocomplete="new-password" /></div>
        <div class="field"><label>Repetir clave nueva</label><input id="pw-repeat" type="password" autocomplete="new-password" /></div>
      </div>
      <div class="modal-foot">
        ${forced ? "" : `<button class="btn btn-ghost" data-cancel>Cancelar</button>`}
        <button class="btn btn-primary" data-confirm>Guardar</button>
      </div>
    </div>`, { locked: Boolean(forced) });
  const root = document.getElementById("modal-root");
  const cancel = root.querySelector("[data-cancel]");
  if (cancel) cancel.onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const next = document.getElementById("pw-next").value;
    const repeat = document.getElementById("pw-repeat").value;
    if (next.length < 8) {
      toast("La clave nueva necesita al menos 8 caracteres", "error");
      return;
    }
    if (next !== repeat) {
      toast("La clave nueva no coincide", "error");
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/api/session/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: document.getElementById("pw-current").value,
          newPassword: next,
        }),
      });
      if (data.user) state.user = data.user;
      closeModal();
      toast("Clave actualizada");
      if (forced) await loadPanel();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  };
}

async function confirmReturnedCheckout() {
  const sessionId = new URLSearchParams(location.search).get("session_id");
  if (!sessionId || sessionId.includes("{")) return;
  try {
    const session = await api(`/api/checkout/sessions/${encodeURIComponent(sessionId)}`);
    const ref = session.reference || session.policyId || "";
    const mod = session.module || "";
    const dest =
      mod === "cuentas" || ref.startsWith("top_")
        ? "#/accounts"
        : mod === "cobros" || ref.startsWith("cob_")
          ? "#/cobros"
          : mod === "treasury" || ref.startsWith("tin_")
            ? "#/treasury"
            : mod === "seguros" || ref.startsWith("pol_")
              ? "#/policies"
              : "#/overview";
    history.replaceState({}, "", `${location.pathname}${dest}`);
    await refresh();
    if (session.paymentStatus === "paid") {
      toast(`Pago confirmado · ${ref || "movimiento"} liquidado en pagos.`);
    } else {
      toast("El pago todavía no está confirmado.", "error");
    }
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = visibleGroups()
    .map(
      (group) =>
        `<div class="nav-label${group.tone ? " " + group.tone : ""}">${group.group}</div>` +
        group.items
          .map((n) => `<a href="#/${n.route}" data-route="${n.route}">${icon(n.icon)}<span>${n.label}</span></a>`)
          .join(""),
    )
    .join("");
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
  state.overview.payments = state.overview.payments || [];
  state.overview.policies = state.overview.policies || [];
  state.overview.claims = state.overview.claims || [];
  state.overview.float = state.overview.float || { balance: 0, displayBalance: "—" };
  state.accounts = allowed("accounts") ? (await api("/api/cuentas")).accounts || [] : [];
  state.cobros = allowed("cobros") ? (await api("/api/cobros")).cobros || [] : [];
  state.connect = allowed("connect") ? (await api("/api/connect")).accounts || [] : [];
  state.treasury = allowed("treasury") ? (await api("/api/treasury")).accounts || [] : [];
  if (allowed("cards")) {
    const tarjetas = await api("/api/tarjetas");
    state.cards = tarjetas.cards || [];
    state.issuing = tarjetas.issuing || null;
  } else {
    state.cards = [];
    state.issuing = null;
  }
  if (allowed("empresas")) {
    const empresas = await api("/api/empresas");
    state.companies = empresas.companies || [];
    state.canCreateCompany = Boolean(empresas.canCreate);
  } else {
    state.companies = [];
    state.canCreateCompany = false;
  }
  state.frosting = allowed("actuarial") ? await api("/api/frosting") : null;
  state.courses = allowed("clases") ? (await api("/api/clases")).courses || [] : [];
  state.sicr3p = allowed("configuracion") ? (await api("/api/configuracion")).sicr3p || null : null;
  state.actuarial = allowed("actuarial") ? (await api("/api/actuarial")).classes || [] : [];
  if (allowed("design")) {
    state.design = (await api("/api/diseno")).design;
    applyDesign(state.design);
  }
  state.appManifest = allowed("apps") ? (await api("/api/apps")).manifest : state.appManifest;
  if (allowed("payments")) {
    try {
      const ev = await api("/api/stripe/events");
      state.stripeEvents = ev.events || [];
    } catch {
      state.stripeEvents = [];
    }
    state.exits = (await api("/api/salidas")).exits || [];
  } else {
    state.stripeEvents = [];
    state.exits = [];
  }
  try {
    state.onboarding = await api("/api/onboarding");
    state.registro = await api("/api/registro");
  } catch {
    state.onboarding = null;
    state.registro = null;
  }
}

/* ---------------- router ---------------- */
function currentRoute() {
  const r = (location.hash || "#/overview").replace("#/", "");
  if (navItems().find((n) => n.route === r)) return r;
  if (location.hash && location.hash !== "#/overview") {
    history.replaceState({}, "", `${location.pathname}${location.search}#/overview`);
  }
  return "overview";
}

function route() {
  const r = currentRoute();
  const meta = navItems().find((n) => n.route === r);
  let title = meta.title;
  let sub = meta.sub;
  if (r === "overview" && state.user && state.user.role === "operacion") {
    title = "Inicio";
    sub = "Resumen de la plataforma";
  }
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-subtitle").textContent = sub;
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
  accounts: viewAccounts,
  cobros: viewCobros,
  plans: viewPlans,
  policies: viewPolicies,
  claims: viewClaims,
  connect: viewConnect,
  treasury: viewTreasury,
  cards: viewCards,
  empresas: viewEmpresas,
  clases: viewClases,
  configuracion: viewConfiguracion,
  actuarial: viewActuarial,
  correo: viewCorreo,
  design: viewDesign,
  apps: viewApps,
  payments: viewPayments,
};

function movementLabel(p) {
  if (p.description) return p.description;
  if (p.module === "seguros" && p.kind === "disburse") return "Siniestro";
  if (p.module === "seguros") return "Prima";
  if (p.module === "cuentas" && p.kind === "disburse") return "Retiro";
  if (p.module === "cuentas") return "Recarga";
  if (p.module === "treasury") return "Abono Treasury";
  if (p.module === "connect") return "Pago Connect";
  return "Cobro";
}

function movementFeed(rows, technical) {
  if (!rows.length) {
    return `<div class="empty">${icon("inbox")}<div>${technical ? "El libro está vacío." : "Todavía no hay actividad."}</div></div>`;
  }
  return `<ul class="feed">${[...rows].reverse().map((p) => `
        <li>
          <div class="fi">${icon(p.kind === "disburse" ? "zap" : "card")}</div>
          <div>
            <div class="ft"><b>${p.kind === "disburse" ? "−" : "+"}${money(p.amount)}</b> ${movementLabel(p)}</div>
            <div class="fdate">${p.status === "paid" ? "Pagado" : p.status === "failed" ? "Fallido" : "Pendiente"}${technical ? ` · <code class="mono">${p.module}</code> · <code class="mono">${p.id}</code> · <code class="mono">${p.reference}</code>` : ""}</div>
          </div>
        </li>`).join("")}</ul>`;
}

function workflowStrip() {
  const members = (state.registro && state.registro.members) || [];
  const known = Boolean(state.onboarding);
  const accepted = Boolean(known && state.onboarding.accepted);
  const names = members.map((member) => member.name).join(" · ");
  const steps = [
    {
      n: "1",
      title: "Términos",
      text: !known ? "Onboarding" : accepted ? "Aceptados" : "Falta aceptar",
      href: "/#aplicacion",
      state: accepted ? "done" : "current",
    },
    {
      n: "2",
      title: "Espacio ocupado",
      text: members.length ? `${members.length} preinscritos${names ? ` · ${names}` : ""}` : "Preinscritos con saldo en cero",
      href: "/aplicacion",
      state: accepted ? "done" : "",
    },
    {
      n: "3",
      title: "Operación",
      text: "Cuentas, cobros y crédito",
      href: `#/${(navItems().find((item) => item.route !== "overview") || { route: "overview" }).route}`,
      state: "",
    },
  ];
  return `<ol class="workflow">${steps
    .map(
      (step) => `<li class="${step.state}"><a href="${step.href}"><span>${step.n}</span><strong>${step.title}</strong><em>${escapeAttr(step.text)}</em></a></li>`,
    )
    .join("")}</ol>`;
}

function pendingExitsCard() {
  if (!allowed("payments") || !state.exits.length) return "";
  const list = state.exits
    .map(
      (exit) => `
      <div class="row">
        <div>
          <div class="who">${escapeAttr(exit.description)}</div>
          <div class="meta">${money(exit.amount)} · ${escapeAttr(exit.destination)}</div>
        </div>
        <div class="push">
          <button class="btn btn-primary btn-sm" data-confirm-exit="${escapeAttr(exit.id)}">Confirmar</button>
        </div>
      </div>`,
    )
    .join("");
  return `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Salidas por confirmar</h3><span class="badge">${state.exits.length}</span></div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewOverview() {
  if (!state.user || state.user.role === "operacion") return viewOperacionHome();
  return viewClientHome();
}

function viewClientHome() {
  const inicio = state.overview.inicio || {};
  const company = (state.companies || []).find((item) => item.card && inicio.card && item.card.id === inicio.card.id)
    || (state.companies || []).find((item) => item.ownWorkerId && inicio.card && item.ownWorkerId === inicio.card.id)
    || (state.companies || [])[0];
  const color = company ? company.color : "#0e3e66";
  const rows = [];
  rows.push(["Nombre", inicio.name || (state.user && state.user.name) || ""]);
  if (state.user && state.user.role === "comercio") rows.push(["Comuna", inicio.commune || "Sin comuna"]);
  if (inicio.companyName && state.user && state.user.role === "titular") rows.push(["Empresa", inicio.companyName]);
  rows.push(["Correo", inicio.email || (state.user && state.user.email) || ""]);
  const identity = rows
    .map(([label, value]) => `<div><span>${label}</span><b>${escapeAttr(value)}</b></div>`)
    .join("");
  const card = inicio.card
    ? virtualCard(inicio.card, color, "Débito virtual")
    : `<article class="plastic vcard vcard-empty"><b>Todavía no hay tarjeta</b><span>Operación abre tu cuenta.</span></article>`;
  const note = inicio.card && inicio.card.balance > 0 && !inicio.card.realFunds
    ? `<p class="funds-note">Este abono está en el libro. No es dinero disponible: Stripe todavía no lo liquidó.</p>`
    : `<p class="funds-note">Disponible es solo el dinero que Stripe ya liquidó. La tarjeta es virtual y de débito.</p>`;
  const moves = inicio.card && inicio.card.displayBalance !== "—"
    ? `<div class="card" style="margin-top:16px"><div class="card-head"><h3>Movimientos</h3></div><div class="card-body flush">${cardFeed(inicio.card.movements)}</div></div>`
    : "";
  return `<section class="home-board">
    <div class="home-identity">
      <p class="home-kicker">${escapeAttr(state.user.roleLabel)}</p>
      <h2>${escapeAttr(inicio.name || state.user.name)}</h2>
      <div class="identity-list">${identity}</div>
      ${contractBox(inicio.contract)}
      <a class="btn btn-primary" href="#/clases">${icon("layers")} Entrar a cursos</a>
      ${allowed("empresas") ? `<a class="btn btn-ghost" href="#/empresas" style="margin-left:8px">${icon("card")} Débito</a>` : ""}
    </div>
    <div>
      ${card}
      ${note}
      ${moves}
    </div>
  </section>
  ${giftSection(inicio.gifts)}`;
}

function contractBox(contract) {
  if (!contract || !contract.text) return "";
  return `<details class="contract">
    <summary>Ver contrato</summary>
    <pre class="contract-text">${escapeAttr(contract.text)}</pre>
  </details>`;
}

function giftSection(gifts) {
  const list = giftList(gifts);
  if (!list) return "";
  return `<section class="card gift-section"><div class="card-head"><h3>Regalos virtuales</h3></div><div class="card-body">${list}</div></section>`;
}

function giftList(gifts) {
  if (!gifts || !gifts.length) return "";
  return `<div class="gift-list">${gifts.map((gift) => giftCard(gift)).join("")}</div>`;
}

function giftCard(gift) {
  const code = gift.code
    ? `<p class="gift-code">${escapeAttr(gift.code)}</p>${qrSvg(gift.qr)}`
    : "";
  const pending = gift.pendingMessage ? `<p class="funds-note">${escapeAttr(gift.pendingMessage)}</p>` : "";
  const inactive = gift.active
    ? ""
    : `<p class="funds-note">${escapeAttr(gift.inactiveMessage || "Inactivo. Operación lo activa.")}</p>`;
  const activate = gift.canActivate
    ? `<button class="btn btn-primary btn-sm" data-activate-gift="${escapeAttr(gift.companyId)}:${escapeAttr(gift.id)}">Activar</button>`
    : "";
  const nfc = gift.nfcNote ? `<p class="funds-note">${escapeAttr(gift.nfcNote)}</p>` : "";
  return `<article class="gift-card">
    <h3>${escapeAttr(gift.title)} ${gift.active ? `<span class="pill">Activo</span>` : `<span class="pill amber">Inactivo</span>`}</h3>
    <p>${escapeAttr(gift.note)}</p>
    <p class="meta">Para ${escapeAttr(gift.recipientName)}</p>
    ${code}
    ${pending}
    ${inactive}
    ${activate}
    ${nfc}
    <p class="funds-note">${escapeAttr(gift.disclaimer || "Este regalo es virtual. No es una cuenta de débito y no es dinero.")}</p>
  </article>`;
}

function qrSvg(matrix) {
  if (!matrix || !matrix.length) return "";
  const size = matrix.length;
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return `<svg class="gift-qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="Código del regalo">${cells.join("")}</svg>`;
}

function usersSection(company) {
  if (!company || !company.canManage) return "";
  const rows = (company.users || [])
    .map(
      (user) => `<div class="row"><div><div class="who">${escapeAttr(user.name)}</div><div class="meta">${escapeAttr(user.email)}</div></div><div class="push"><span class="pill">${escapeAttr(user.roleLabel || "")}</span></div></div>`,
    )
    .join("");
  const list = rows
    ? `<div class="rowlist">${rows}</div>`
    : `<p class="hint">Esta empresa todavía no tiene usuarios propios.</p>`;
  return `<section class="card gift-section">
    <div class="card-head"><h3>Usuarios de la empresa</h3></div>
    <div class="card-body">
      <p class="hint">Cada empresa y cada cliente tiene su propio usuario. No comparten el acceso con otra empresa.</p>
      ${list}
      <div class="inline-form">
        <div class="field"><label>Nombre</label><input id="user-name-${company.id}" placeholder="Ana Díaz" /></div>
        <div class="field"><label>Correo</label><input id="user-email-${company.id}" type="email" placeholder="ana.sur@taller.cl" /></div>
        <div class="field"><label>Rol</label><select id="user-role-${company.id}"><option value="comercio">Usuario de la empresa</option><option value="titular">Cliente</option></select></div>
        <div class="field"><label>Clave inicial</label><input id="user-password-${company.id}" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres" /></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-create-user="${company.id}">${icon("plus")} Crear usuario</button></div>
      </div>
    </div>
  </section>`;
}

function giftForm(company) {
  if (!company.canManage) return "";
  const people = [`<option value="${escapeAttr(company.id)}">${escapeAttr(company.name)}</option>`]
    .concat((company.workers || []).map((worker) => `<option value="${escapeAttr(worker.id)}">${escapeAttr(worker.name)}</option>`))
    .join("");
  return `<h2 class="section-title">Regalo virtual</h2>
    <p class="hint">No es dinero y no descuenta el débito. Queda inactivo hasta que lo actives. El código, cuando Stripe lo emite y lo activas, se puede copiar después en una etiqueta NFC.</p>
    <div class="inline-form">
      <div class="field"><label>Título</label><input id="gift-title-${company.id}" placeholder="Almuerzo de equipo" /></div>
      <div class="field"><label>Nota</label><input id="gift-note-${company.id}" placeholder="Para celebrar el mes" /></div>
      <div class="field"><label>Destinatario</label><select id="gift-who-${company.id}">${people}</select></div>
      <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-create-gift="${company.id}">${icon("plus")} Crear regalo</button></div>
    </div>
    ${giftList(company.gifts)}`;
}

function viewOperacionHome() {
  const o = state.overview;
  const payments = o.payments || [];
  const activePolicies = (o.policies || []).filter((p) => p.status === "active").length;
  const pendingCobros = state.cobros.filter((c) => c.status === "pending_payment").length;
  const kpis = [];
  if (allowed("payments")) {
    kpis.push(`<div class="kpi"><div class="kpi-top"><div class="kpi-ico">${icon("wallet")}</div></div><div class="kpi-label">Dinero en la plataforma</div><div class="kpi-value">${o.float.displayBalance}</div><div class="kpi-hint">Puede salir por Stripe: ${o.transferable ? o.transferable.displayBalance : "—"}</div></div>`);
  }
  if (allowed("accounts")) {
    kpis.push(`<div class="kpi green"><div class="kpi-top"><div class="kpi-ico">${icon("wallet")}</div></div><div class="kpi-label">Cuentas</div><div class="kpi-value">${state.accounts.length}</div><div class="kpi-hint">Clientes con wallet</div></div>`);
  }
  if (allowed("cobros")) {
    kpis.push(`<div class="kpi"><div class="kpi-top"><div class="kpi-ico">${icon("file")}</div></div><div class="kpi-label">Cobros</div><div class="kpi-value">${state.cobros.length}</div><div class="kpi-hint">${pendingCobros ? pendingCobros + " con pago pendiente" : "Todos liquidados en pagos"}</div></div>`);
  }
  if (allowed("policies")) {
    kpis.push(`<div class="kpi amber"><div class="kpi-top"><div class="kpi-ico">${icon("shield")}</div></div><div class="kpi-label">Pólizas al día</div><div class="kpi-value">${activePolicies}</div><div class="kpi-hint">Seguro del crédito de la TC</div></div>`);
  }
  const shortcuts = [
    ["accounts", "wallet", "Cuentas"],
    ["cobros", "file", "Cobros"],
    ["policies", "shield", "Pólizas"],
    ["connect", "arrow", "Comercios"],
    ["treasury", "wallet", "Caja"],
    ["cards", "card", "Tarjetas"],
    ["empresas", "card", "Débito"],
    ["configuracion", "file", "Configuración"],
    ["clases", "layers", "Cursos"],
  ].filter(([route]) => allowed(route));
  const activity = allowed("payments")
    ? `<div class="card"><div class="card-head"><h3>Actividad reciente</h3><a class="btn btn-ghost btn-sm" href="#/payments">Admin técnico</a></div><div class="card-body flush">${movementFeed(payments, false)}</div></div>`
    : "";
  const links = shortcuts
    .map(([route, ic, label], index) => `<a class="btn btn-ghost btn-block" href="#/${route}"${index ? ' style="margin-top:10px"' : ""}>${icon(ic)} ${label}</a>`)
    .join("");

  const configCard = allowed("configuracion")
    ? `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>SICR3P</h3></div><div class="card-body"><p class="hint">${state.sicr3p && state.sicr3p.configured ? "La URL externa ya está guardada." : "Falta la URL de SICR3P. Configúrala para salir a ese sitio."}</p><a class="btn btn-primary" href="#/configuracion">${icon("file")} Ir a configuración</a></div></div>`
    : "";
  return `${configCard}${adminGlobalAccounts()}${workflowStrip()}${pendingExitsCard()}${kpis.length ? `<div class="grid-kpi">${kpis.join("")}</div>` : ""}
    <div class="cols${activity ? "" : " single"}">
      ${activity}
      <div class="card">
        <div class="card-head"><h3>Ir a</h3></div>
        <div class="card-body">${links}</div>
      </div>
    </div>`;
}

function viewAccounts() {
  const rows = state.accounts;
  if (!rows.length) {
    return `<div class="card"><div class="card-head"><h3>Cuentas</h3><button class="btn btn-primary btn-sm" data-open-account>${icon("plus")} Abrir cuenta</button></div><div class="card-body"><div class="empty">${icon("wallet")}<div>Todavía no hay clientes con saldo.</div></div></div></div>`;
  }
  const list = rows
    .map(
      (a) => `
      <div class="row">
        <div class="avatar">${initials(a.name)}</div>
        <div>
          <div class="who">${a.name}</div>
          <div class="meta">${a.email}</div>
        </div>
        <div class="push">
          <b>${money(a.balance)}</b>
          <button class="btn btn-ghost btn-sm" data-fund="${a.id}">${icon("plus")} Recargar</button>
          <button class="btn btn-ghost btn-sm" data-withdraw="${a.id}">${icon("zap")} Retirar</button>
        </div>
      </div>`,
    )
    .join("");
  return `<div class="card"><div class="card-head"><h3>Cuentas (${rows.length})</h3><button class="btn btn-primary btn-sm" data-open-account>${icon("plus")} Abrir cuenta</button></div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewCobros() {
  const rows = state.cobros;
  if (!rows.length) {
    return `<div class="card"><div class="card-head"><h3>Cobros</h3><button class="btn btn-primary btn-sm" data-new-cobro>${icon("plus")} Nuevo cobro</button></div><div class="card-body"><div class="empty">${icon("file")}<div>No hay cobros pendientes ni pagados.</div></div></div></div>`;
  }
  const list = rows
    .map((c) => {
      const pending = c.status === "pending_payment";
      return `
      <div class="row">
        <div class="avatar">${initials(c.payerName)}</div>
        <div>
          <div class="who">${c.concept}</div>
          <div class="meta">${c.payerName}</div>
        </div>
        <div class="push">
          <b>${money(c.amount)}</b>
          <span class="pill ${pending ? "amber" : ""}">${pending ? "pago pendiente" : "pagado"}</span>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="card"><div class="card-head"><h3>Cobros (${rows.length})</h3><button class="btn btn-primary btn-sm" data-new-cobro>${icon("plus")} Nuevo cobro</button></div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewPlans() {
  const credit = state.plans.find((plan) => plan.id === "credito-tc") || state.plans[0];
  const frosting = state.plans.find((plan) => plan.id === "frosting");
  const rate = credit ? credit.displayRate : "0,60%";
  const frostingCard = frosting
    ? `<div class="plan">
        <span class="ribbon">Frosting</span>
        <h3>Seguro por trabajadores</h3>
        <p class="plan-desc">${escapeAttr(frosting.description)}</p>
        <div class="price"><b>${escapeAttr(frosting.displayRate)}</b><span>sin cupo</span></div>
        <div class="coverage">No abre crédito. La tasa vive en la vista actuarial.</div>
        <ul class="features">
          <li>${icon("check")} Prima = trabajadores × tasa de la clase</li>
          <li>${icon("check")} Se cobra por el libro de pagos</li>
          <li>${icon("check")} La empresa lo contrata en Tarjetas</li>
        </ul>
        ${allowed("actuarial") ? `<a class="btn btn-ghost btn-block" href="#/actuarial">Ver tasas</a>` : `<p class="hint">La empresa contrata Frosting desde su tarjeta.</p>`}
      </div>`
    : "";
  return `<div class="plans">
    <div class="plan featured">
      <span class="ribbon">Crédito TC</span>
      <h3>Póliza del crédito</h3>
      <p class="plan-desc">Cubre el cupo de una tarjeta de crédito. La prima es ${rate} de ese crédito y se cobra por pagos.</p>
      <div class="price"><b>${rate}</b><span>del cupo</span></div>
      <div class="coverage">El monto asegurado es el crédito de la tarjeta</div>
      <ul class="features">
        <li>${icon("check")} Una póliza por tarjeta</li>
        <li>${icon("check")} El siniestro no puede pasar el cupo</li>
        <li>${icon("check")} La prima entra al libro de pagos</li>
      </ul>
      <button class="btn btn-primary btn-block" data-credito>${icon("plus")} Asegurar un crédito</button>
    </div>
    ${frostingCard}
  </div>`;
}

function viewPolicies() {
  const rows = state.overview.policies;
  if (!rows.length) {
    return `<div class="card"><div class="card-body"><div class="empty">${icon("shield")}<div>No hay pólizas de crédito. Asegura el cupo de una tarjeta en <a href="#/plans">Crédito TC</a>.</div></div></div></div>`;
  }
  const list = rows
    .map((p) => {
      const pending = p.status === "pending_payment";
      return `
      <div class="row">
        <div class="avatar">${initials(p.holderName)}</div>
        <div>
          <div class="who">${p.holderName}</div>
          <div class="meta">${p.planId === "frosting" ? `${p.workers || 0} trabajadores · ${escapeAttr(p.companyName || "Frosting")}` : `${p.cardLabel || "Tarjeta"} · crédito ${money(p.cupo || p.coverage)}`}</div>
        </div>
        <div class="push">
          <span class="pill ${pending ? "amber" : ""}">${pending ? "Pago pendiente" : "Al día"}</span>
          ${
            pending
              ? `<span class="meta">Esperando el pago</span>`
              : p.planId === "frosting"
                ? `<span class="meta">Sin crédito</span>`
                : `<button class="btn btn-ghost btn-sm" data-claim="${p.id}">${icon("zap")} Dispersar siniestro</button>`
          }
        </div>
      </div>`;
    })
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
        <td>${c.beneficiary}</td>
        <td class="amt-pos">${money(c.amount)}</td>
        <td><span class="pill ${c.status === "paid" ? "" : "amber"}">${c.status === "paid" ? "Pagado" : "Pendiente"}</span></td>
      </tr>`,
    )
    .join("");
  return `<div class="card"><div class="card-head"><h3>Siniestros</h3></div><div class="card-body flush">
    <table class="tbl"><thead><tr><th>Beneficiario</th><th>Monto</th><th>Estado</th></tr></thead><tbody>${body}</tbody></table>
  </div></div>`;
}

function viewConnect() {
  const rows = state.connect;
  if (!rows.length) {
    return `<div class="card"><div class="card-head"><h3>Connect</h3><button class="btn btn-primary btn-sm" data-new-connect>${icon("plus")} Cuenta conectada</button></div><div class="card-body"><div class="empty">${icon("arrow")}<div>No hay cuentas conectadas.</div></div></div></div>`;
  }
  const list = rows
    .map((a) => {
      const pay = a.onboardingUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeAttr(a.onboardingUrl)}" target="_blank" rel="noreferrer">Onboarding</a>` : "";
      const modeLabel = a.mode === "live" ? "live" : a.mode === "pending" ? "pendiente" : "demo";
      return `
      <div class="row">
        <div class="avatar">${initials(a.businessName)}</div>
        <div>
          <div class="who">${a.businessName}</div>
          <div class="meta">${a.email}${a.notice ? ` · ${a.notice}` : ""}</div>
        </div>
        <div class="push">
          <span class="pill ${a.mode === "live" ? "" : "amber"}">${modeLabel}</span>
          ${pay}
          <button class="btn btn-ghost btn-sm" data-connect-pay="${a.id}">${icon("zap")} Pagar</button>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="card"><div class="card-head"><h3>Connect (${rows.length})</h3><button class="btn btn-primary btn-sm" data-new-connect>${icon("plus")} Cuenta conectada</button></div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewTreasury() {
  const rows = state.treasury;
  if (!rows.length) {
    return `<div class="card"><div class="card-head"><h3>Treasury</h3><button class="btn btn-primary btn-sm" data-new-treasury>${icon("plus")} Cuenta financiera</button></div><div class="card-body"><div class="empty">${icon("wallet")}<div>No hay cuentas financieras. El abono se liquida en pagos.</div></div></div></div>`;
  }
  const list = rows
    .map(
      (a) => `
      <div class="row">
        <div class="avatar">${initials(a.nickname)}</div>
        <div>
          <div class="who">${a.nickname}</div>
          <div class="meta">${a.mode === "live" ? "FinancialAccount" : "Demo"}${a.notice ? ` · ${a.notice}` : ""}</div>
        </div>
        <div class="push">
          <b>${money(a.balance)}</b>
          <button class="btn btn-ghost btn-sm" data-treasury-fund="${a.id}">${icon("plus")} Abonar</button>
        </div>
      </div>`,
    )
    .join("");
  return `<div class="card"><div class="card-head"><h3>Treasury (${rows.length})</h3><button class="btn btn-primary btn-sm" data-new-treasury>${icon("plus")} Cuenta financiera</button></div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewCards() {
  const rows = state.cards;
  const funding = state.issuing && state.issuing.funding ? `<p class="hint">${escapeAttr(state.issuing.funding)}</p>` : "";
  const note = state.issuing ? `<p class="hint">${escapeAttr(state.issuing.detail)}</p>${funding}` : "";
  if (!rows.length) {
    return `<div class="card"><div class="card-head"><h3>Tarjetas</h3><button class="btn btn-primary btn-sm" data-new-card>${icon("plus")} Emitir tarjeta</button></div><div class="card-body">${note}<div class="empty">${icon("card")}<div>No hay tarjetas emitidas. El cupo es el crédito que puede cubrir el seguro.</div></div></div></div>`;
  }
  const list = rows
    .map((c) => {
      const label = `${c.brand} •••• ${c.last4}`;
      return `
      <div class="row">
        <div class="plastic">${label}</div>
        <div>
          <div class="who">${c.holderName}</div>
          <div class="meta">cupo ${money(c.cupo)}${c.notice ? ` · ${c.notice}` : ""}</div>
        </div>
        <div class="push">
          <span class="pill ${c.status === "active" ? "" : "amber"}">${c.status === "active" ? "activa" : "inactiva"}</span>
          <button class="btn btn-ghost btn-sm" data-insure="${c.id}">${icon("shield")} Asegurar cupo</button>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="card"><div class="card-head"><h3>Tarjetas (${rows.length})</h3><button class="btn btn-primary btn-sm" data-new-card>${icon("plus")} Emitir tarjeta</button></div><div class="card-body">${note}</div><div class="card-body flush"><div class="rowlist">${list}</div></div></div>`;
}

function viewDesign() {
  const d = state.design || {
    displayName: "Proveedor Regional",
    buttonColor: "#0e3e66",
    backgroundColor: "#f5f7fb",
    borderStyle: "rounded",
    carrierTitle: "Tu tarjeta",
    carrierBody: "Crédito de la plataforma",
  };
  const borders = [
    ["rounded", "Redondeado"],
    ["rectangular", "Rectangular"],
    ["pill", "Píldora"],
  ];
  return `
    <h2 class="section-title">Workflow</h2>
    <p class="workflow-lead">El recorrido es aceptar los términos, ver el espacio ocupado y operar las cuentas.</p>
    ${workflowStrip()}
    <h2 class="section-title">Diseño</h2>
    <div class="brand-row">
      <img src="/logo-mark.png" alt="" />
      <span class="swatch"><i style="background:#0e3e66"></i>Azul</span>
      <span class="swatch"><i style="background:#f3932c"></i>Sol</span>
      <span class="swatch"><i style="background:${escapeAttr(d.buttonColor)}"></i>Botón ${escapeAttr(d.buttonColor)}</span>
    </div>
    <div class="cols">
    <div class="card">
      <div class="card-head"><h3>Pago</h3></div>
      <div class="card-body">
        <div class="field"><label>Nombre en el pago</label><input id="d-name" value="${escapeAttr(d.displayName)}" /></div>
        <div class="field"><label>Color del botón</label><input id="d-button" value="${escapeAttr(d.buttonColor)}" /></div>
        <div class="field"><label>Fondo</label><input id="d-bg" value="${escapeAttr(d.backgroundColor)}" /></div>
        <div class="field"><label>Bordes</label>
          <select id="d-border">
            ${borders.map(([value, label]) => `<option value="${value}" ${d.borderStyle === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Texto de la tarjeta</label><input id="d-title" value="${escapeAttr(d.carrierTitle)}" /></div>
        <div class="field"><label>Detalle</label><input id="d-body" value="${escapeAttr(d.carrierBody)}" /></div>
        <button class="btn btn-primary" data-save-design>${icon("check")} Guardar diseño</button>
        <p class="hint">El nombre y estos colores salen en el pago.</p>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Vista de la tarjeta</h3></div>
      <div class="card-body">
        <div class="plastic big" id="design-preview" style="background:${escapeAttr(d.buttonColor)}">
          <b>${escapeAttr(d.carrierTitle)}</b>
          <span>${escapeAttr(d.carrierBody)}</span>
          <em>Visa •••• 4242</em>
        </div>
      </div>
    </div>
  </div>`;
}

function viewApps() {
  const m = state.appManifest;
  const pretty = m ? JSON.stringify(m, null, 2) : "";
  return `<div class="card">
    <div class="card-head"><h3>App</h3></div>
    <div class="card-body">
      <div class="field"><label>Nombre</label><input id="app-name" value="${escapeAttr(m ? m.name : "Proveedor Regional")}" /></div>
      <button class="btn btn-primary" data-create-app>${icon("plus")} Crear app</button>
      <p class="hint">Nombre de la aplicación de la plataforma. El manifest queda en el repositorio.</p>
      <pre class="manifest">${pretty}</pre>
    </div>
  </div>`;
}

const SPEND_CATEGORIES = [
  ["alimentacion", "Alimentación"],
  ["transporte", "Transporte"],
  ["combustible", "Combustible"],
  ["salud", "Salud"],
  ["oficina", "Oficina"],
  ["otros", "Otros"],
];

function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#0e3e66";
}

function virtualCard(card, color, kicker) {
  const logo = card.logo
    ? `<img class="vcard-logo" src="${escapeAttr(card.logo)}" alt="" />`
    : `<span class="vcard-mark">${escapeAttr(initials(card.name || "PR"))}</span>`;
  const book = card.displayBalance === "—" ? "" : `<div><span>Saldo en libro</span><b>${escapeAttr(card.displayBalance)}</b></div>`;
  const available = card.displayAvailable || (card.displayBalance === "—" ? "—" : money(0));
  return `<article class="plastic vcard" style="background:linear-gradient(155deg, ${safeColor(color)} 0%, #102033 78%)">
    <div class="vcard-top">${logo}<span class="vcard-kicker">${escapeAttr(kicker)}</span></div>
    <div>
      <b class="vcard-name">${escapeAttr(card.name)}</b>
      <em>•••• ${escapeAttr(card.last4)}</em>
    </div>
    <div class="vcard-foot">
      <div><span>Disponible</span><strong>${escapeAttr(String(available))}</strong></div>
      ${book}
    </div>
  </article>`;
}

function cardFeed(rows) {
  if (!rows || !rows.length) {
    return `<div class="empty">${icon("inbox")}<div>Sin movimientos en esta tarjeta.</div></div>`;
  }
  return `<ul class="feed">${rows
    .map(
      (item) => `<li><div class="fi">${icon(item.kind === "debit" ? "zap" : "card")}</div><div><div class="ft"><b>${item.kind === "debit" ? "−" : "+"}${escapeAttr(item.displayAmount)}</b> ${escapeAttr(item.reference)}</div><div class="fdate">${escapeAttr(String(item.createdAt).slice(0, 16).replace("T", " "))}</div></div></li>`,
    )
    .join("")}</ul>`;
}

function cardControls(company, card) {
  const options = card.options || {};
  const editable = Boolean(company.canManage);
  const selected = new Set(options.categories || []);
  const checks = SPEND_CATEGORIES.map(
    ([id, label]) =>
      `<label class="checkline"><input type="checkbox" data-cat="${escapeAttr(card.id)}" value="${id}" ${selected.has(id) ? "checked" : ""} ${editable ? "" : "disabled"} /> ${label}</label>`,
  ).join("");
  const period = options.period || "siempre";
  const moneyHidden = card.displayBalance === "—";
  const ledger = moneyHidden
    ? `<p class="hint">El saldo, los movimientos y los comprobantes los ve solo quien usa esta tarjeta.</p>`
    : `<h2 class="section-title">Saldo y movimientos</h2><p class="hint">Disponible ${escapeAttr(card.displayAvailable || money(0))}. En el libro: ${escapeAttr(card.displayBalance)}. ${card.realFunds ? "Stripe ya liquidó este saldo." : "Un abono de demostración no es dinero disponible."}</p>${cardFeed(card.movements)}<h2 class="section-title">Comprobantes</h2>${cardFeed(card.receipts)}`;
  return `<div class="card-options">
    ${ledger}
    <h2 class="section-title">Opciones de la tarjeta</h2>
    <div class="inline-form">
      <div class="field"><label>Límite de gasto</label><input id="limit-${card.id}" inputmode="numeric" placeholder="Sin límite" value="${options.spendLimit || ""}" ${editable ? "" : "disabled"} /></div>
      <div class="field"><label>Período de uso</label>
        <select id="period-${card.id}" ${editable ? "" : "disabled"}>
          <option value="siempre" ${period === "siempre" ? "selected" : ""}>Siempre</option>
          <option value="mensual" ${period === "mensual" ? "selected" : ""}>Mensual</option>
          <option value="rango" ${period === "rango" ? "selected" : ""}>Rango de fechas</option>
        </select>
      </div>
      <div class="field"><label>Desde</label><input id="from-${card.id}" type="date" value="${escapeAttr(options.periodFrom || "")}" ${editable ? "" : "disabled"} /></div>
      <div class="field"><label>Hasta</label><input id="until-${card.id}" type="date" value="${escapeAttr(options.periodUntil || "")}" ${editable ? "" : "disabled"} /></div>
    </div>
    <div class="checkgrid">${checks}</div>
    <div class="checkgrid">
      <label class="checkline"><input id="block-${card.id}" type="checkbox" ${options.blocked ? "checked" : ""} ${editable ? "" : "disabled"} /> Bloquear tarjeta</label>
      <label class="checkline"><input id="alerts-${card.id}" type="checkbox" ${options.alerts ? "checked" : ""} ${editable ? "" : "disabled"} /> Alertas</label>
    </div>
    ${editable ? `<button class="btn btn-primary btn-sm" data-save-card="${escapeAttr(company.id)}:${escapeAttr(card.id)}">${icon("check")} Guardar opciones</button>` : ""}
  </div>`;
}

function adminGlobalAccounts() {
  if (!state.user || state.user.role !== "operacion") return "";
  const companies = state.companies || [];
  const notice = companies.reduce(
    (found, company) => found || (company.globalAccounts && company.globalAccounts.notice) || "",
    "",
  ) || "Las cuentas para depositar en otros países quedan pendientes. Global66 abre cuentas en otros países para depositar; la documentación pública lista movimientos y pagos, no la apertura, así que no hay número de cuenta. La cuenta de Stripe no cambia.";
  const body = companies.length
    ? companies.map((company) => globalAccountsBox(company)).join("")
    : `<div class="empty">${icon("inbox")}<div>Todavía no hay empresas. El débito se abre en Débito.</div></div>`;
  return `<div class="card" style="margin-bottom:20px">
    <div class="card-head"><h3>Cuentas para depositar en otros países</h3></div>
    <div class="card-body">
      <p class="funds-note">${escapeAttr(notice)}</p>
      <p class="hint">Estilo Global66: el dinero se deposita en cuentas de otros países. La cuenta de Stripe no cambia.</p>
      ${body}
    </div>
  </div>`;
}

function globalAccountsBox(company) {
  if (!state.user || state.user.role !== "operacion") return "";
  const accounts = (company.globalAccounts && company.globalAccounts.accounts) || [];
  const rows = accounts.length
    ? `<div class="account-pair">${accounts
        .map(
          (account) => `<article>
            <div class="account-head"><h3>${escapeAttr(account.label)}</h3><span class="pill amber">Pendiente</span></div>
            <p class="hint">${escapeAttr(account.purpose)}</p>
            <p class="funds-note">Sin número de cuenta. Para depositar en otro país.</p>
          </article>`,
        )
        .join("")}</div>`
    : `<div class="account-pair">
        <article>
          <div class="account-head"><h3>Cuenta para depositar en otro país</h3></div>
          <p class="hint">Se deposita en una cuenta de otro país, al estilo Global66.</p>
          <p class="funds-note">Sin número de cuenta</p>
        </article>
        <article>
          <div class="account-head"><h3>Cuenta para depositar en otro país</h3></div>
          <p class="hint">El depósito entra a la cuenta del otro país. La cuenta de Stripe no cambia.</p>
          <p class="funds-note">Sin número de cuenta</p>
        </article>
      </div>`;
  const action = accounts.length >= 2
    ? `<p class="hint">La solicitud ya está pendiente. No hay número de cuenta.</p>`
    : `<button class="btn btn-primary" data-global-accounts="${escapeAttr(company.id)}">${icon("plus")} Solicitar cuentas para depositar en otros países</button>`;
  return `<section>
    <h2 class="section-title">${escapeAttr(company.name)}</h2>
    ${rows}
    ${action}
  </section>`;
}

function transferLabel(transfer) {
  if (transfer.kind === "abono") return "Abono interno a la empresa";
  if (transfer.kind === "to_worker") return `Hacia ${transfer.workerName || "el trabajador"}`;
  return `Desde ${transfer.workerName || "el trabajador"} a la empresa`;
}

function transferForm(company) {
  if (!(company.workers.length && (company.canManage || company.ownWorkerId))) {
    return `<p class="hint">Agrega un trabajador para transferir prepago.</p>`;
  }
  const options = company.workers
    .map((worker) => `<option value="${escapeAttr(worker.id)}">${escapeAttr(worker.name)}</option>`)
    .join("");
  const directions = company.canManage
    ? `<div class="field"><label>Hacia</label><select id="dir-${company.id}"><option value="to_worker">Al trabajador</option><option value="to_company">A la empresa</option></select></div>`
    : `<input id="dir-${company.id}" type="hidden" value="to_company" />`;
  return `<div class="inline-form">
    <div class="field"><label>Tarjeta</label><select id="who-${company.id}">${options}</select></div>
    <div class="field"><label>Monto</label><input id="amt-${company.id}" inputmode="numeric" placeholder="10000" /></div>
    ${directions}
    <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-transfer="${company.id}">${icon("arrow")} Transferir</button></div>
  </div>
  <p class="hint">La transferencia queda en el libro local. No sale por Stripe.</p>`;
}

function logoForm(company) {
  if (!company.canManage) return "";
  const saved = company.logo ? `<p class="hint">El logo ya está en las tarjetas.</p>` : "";
  const value = company.logo && String(company.logo).startsWith("https://") ? escapeAttr(company.logo) : "";
  return `<div class="inline-form">
    <div class="field"><label>Logo de la empresa cliente</label><input id="logo-${company.id}" placeholder="https://…" value="${value}" /></div>
    <div class="field"><label>&nbsp;</label><button class="btn btn-ghost" data-save-logo="${company.id}">${icon("check")} Poner logo</button></div>
  </div>${saved}`;
}

function frostingBox(company) {
  if (!company.canManage || !state.frosting) return "";
  const classes = state.frosting.classes || [];
  const options = classes
    .map((item) => `<option value="${escapeAttr(item.id)}">${escapeAttr(item.name)} · ${money(item.rate)} por trabajador</option>`)
    .join("");
  return `<h2 class="section-title">Seguro Frosting</h2>
    <p class="hint">No abre crédito. La prima es trabajadores por la tasa de la clase y se cobra por pagos.</p>
    <div class="inline-form">
      <div class="field"><label>Trabajadores</label><input id="frost-workers-${company.id}" inputmode="numeric" value="${Math.max(company.workers.length, 1)}" /></div>
      <div class="field"><label>Clase de riesgo</label><select id="frost-class-${company.id}">${options}</select></div>
      <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-frosting="${company.id}">${icon("shield")} Cotizar y cobrar</button></div>
    </div>`;
}

function personalAccount(company) {
  const card = company.ownWorkerId
    ? (company.workers || []).find((worker) => worker.id === company.ownWorkerId)
    : company.card;
  if (!card || card.displayBalance === "—") {
    return `<div class="card"><div class="card-body"><div class="empty">${icon("card")}<div>Operación abre tu cuenta.</div></div></div></div>`;
  }
  const blocked = card.options && card.options.blocked ? `<p class="funds-note">Esta tarjeta está bloqueada.</p>` : "";
  return `<div class="card company-block">
    <div class="card-head"><h3>${escapeAttr(card.name)}</h3><span class="pill">${escapeAttr(company.name)}</span></div>
    <div class="card-body">
      <div class="vcard-layout">${virtualCard(card, company.color, "Débito virtual")}</div>
      ${blocked}
      ${contractBox(card.contract)}
      <h2 class="section-title">Movimientos</h2>
      ${cardFeed(card.movements)}
      <h2 class="section-title">Comprobantes</h2>
      ${cardFeed(card.receipts)}
      ${giftList(company.gifts)}
    </div>
  </div>`;
}

function companyBlock(company) {
  if (!company.canManage) return personalAccount(company);
  const workers = company.workers.length
    ? company.workers
        .map(
          (worker) => `<section class="worker-card">
            <div class="vcard-layout">${virtualCard(worker, company.color, "Débito virtual")}</div>
            ${contractBox(worker.contract)}
            ${cardControls(company, worker)}
          </section>`,
        )
        .join("")
    : `<div class="empty">${icon("inbox")}<div>Esta empresa todavía no tiene trabajadores con prepago.</div></div>`;
  const fund = company.canFund
    ? `<div class="inline-form">
        <div class="field"><label>Abono interno</label><input id="fund-${company.id}" inputmode="numeric" placeholder="50000" /></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-fund-company="${company.id}">${icon("plus")} Cargar prepago</button></div>
      </div>
      <p class="hint">Solo operación carga el saldo. El abono no pasa por Stripe.</p>`
    : "";
  const add = company.canManage
    ? `<div class="inline-form">
        <div class="field"><label>Trabajador</label><input id="worker-name-${company.id}" placeholder="Ana Díaz" /></div>
        <div class="field"><label>Correo</label><input id="worker-email-${company.id}" type="email" placeholder="ana@proveedorregional.cl" /></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-ghost" data-add-worker="${company.id}">${icon("plus")} Agregar prepago</button></div>
      </div>`
    : "";
  const transfer = transferForm(company);
  const moves = company.transfers.length
    ? `<ul class="feed">${company.transfers
        .map(
          (item) => `<li><div class="fi">${icon("arrow")}</div><div><div class="ft"><b>${escapeAttr(item.displayAmount)}</b> ${escapeAttr(transferLabel(item))}</div><div class="fdate">${escapeAttr(String(item.createdAt).slice(0, 16).replace("T", " "))}</div></div></li>`,
        )
        .join("")}</ul>`
    : `<div class="empty">${icon("inbox")}<div>Sin transferencias todavía.</div></div>`;
  return `<div class="card company-block">
    <div class="card-head"><h3>${escapeAttr(company.name)}</h3><span class="pill">Débito virtual</span></div>
    <div class="card-body">
      <div class="vcard-layout">${virtualCard(company.card, company.color, "Empresa")}</div>
      ${contractBox(company.card.contract)}
      ${logoForm(company)}
      ${fund}
      ${cardControls(company, company.card)}
      <h2 class="section-title">Trabajadores</h2>
      ${company.canManage && company.workers.some((worker) => worker.displayBalance === "—") ? `<p class="hint">El saldo de cada trabajador lo ve solo esa persona. Puedes ajustar su tarjeta y transferir igual.</p>` : ""}
      ${workers}
      ${add}
      <h2 class="section-title">Transferir</h2>
      ${transfer}
      ${frostingBox(company)}
      ${giftForm(company)}
      ${usersSection(company)}
      <h2 class="section-title">Revisar</h2>
      ${moves}
    </div>
  </div>`;
}

function viewEmpresas() {
  const companies = state.companies || [];
  const create = state.canCreateCompany
    ? `<div class="card" style="margin-bottom:20px">
        <div class="card-head"><h3>Nueva empresa</h3></div>
        <div class="card-body">
          <p class="hint">La tarjeta es virtual y de débito. El color y el logo son de la empresa cliente. El prepago queda en el libro y no sale por Stripe.</p>
          <div class="inline-form">
            <div class="field"><label>Nombre</label><input id="emp-name" placeholder="Taller Sur" /></div>
            <div class="field"><label>Correo del comercio</label><input id="emp-owner" type="email" placeholder="caja@taller.cl" /></div>
            <div class="field"><label>Color de la tarjeta</label><input id="emp-color" type="color" value="#0e3e66" /></div>
            <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-create-company>${icon("plus")} Crear empresa</button></div>
          </div>
        </div>
      </div>`
    : "";
  if (!companies.length) {
    const empty = state.canCreateCompany
      ? "Todavía no hay empresas con prepago."
      : "Operación abre tu cuenta.";
    return `${create}<div class="card"><div class="card-body"><div class="empty">${icon("card")}<div>${empty}</div></div></div></div>`;
  }
  return create + companies.map((company) => companyBlock(company)).join("");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function viewClases() {
  const courses = state.courses || [];
  if (!courses.length) {
    return `<div class="card"><div class="card-body"><div class="empty">${icon("layers")}<div>No hay cursos cargados.</div></div></div></div>`;
  }
  return `<div class="course-grid">${courses
    .map((course) => {
      const lessons = (course.lessons || []).map((lesson) => `<li>${escapeAttr(lesson.title)}</li>`).join("");
      const students = (course.students || []).length
        ? (course.students || []).map((student) => `<li>${escapeAttr(student.name)} · ${escapeAttr(student.email)}</li>`).join("")
        : `<li>Nadie inscrito todavía.</li>`;
      return `<article class="card course-card">
        <div class="card-head"><h3>${escapeAttr(course.title)}</h3><span class="badge">${(course.students || []).length}</span></div>
        <div class="card-body">
          <h2 class="section-title">Lecciones</h2>
          <ol class="lesson-list">${lessons}</ol>
          <h2 class="section-title">Alumnos</h2>
          <ul class="lesson-list">${students}</ul>
          <div class="inline-form">
            <div class="field"><label>Nombre</label><input id="alumno-name-${course.id}" value="${escapeAttr(state.user ? state.user.name : "")}" /></div>
            <div class="field"><label>Correo</label><input id="alumno-email-${course.id}" type="email" value="${escapeAttr(state.user ? state.user.email : "")}" /></div>
            <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-enroll="${escapeAttr(course.id)}">${icon("plus")} Inscribir</button></div>
          </div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function viewConfiguracion() {
  const sicr = state.sicr3p || { url: null, configured: false, secretStored: false };
  const status = sicr.configured
    ? `<p>SICR3P está en <a href="${escapeAttr(sicr.url)}" target="_blank" rel="noopener noreferrer">${escapeAttr(sicr.url)}</a>. El navegador abre ese sitio. Este panel no reenvía su tráfico.</p>`
    : `<div class="empty">${icon("file")}<div>Configura la URL https de SICR3P. Tiene que ser un sitio de otro host.</div></div>`;
  const secretNote = sicr.secretStored
    ? `<p class="hint">Hay un secreto guardado en el servidor. No vuelve al navegador.</p>`
    : `<p class="hint">Si guardas un secreto, se queda en el servidor.</p>`;
  return `<div class="card">
    <div class="card-head"><h3>SICR3P</h3><span class="pill">${sicr.configured ? "Externo" : "Sin URL"}</span></div>
    <div class="card-body">
      ${status}
      <div class="inline-form">
        <div class="field"><label>URL https</label><input id="sicr-url" placeholder="https://sicr3p.ejemplo.cl" value="${sicr.url ? escapeAttr(sicr.url) : ""}" /></div>
        <div class="field"><label>Secreto</label><input id="sicr-secret" type="password" autocomplete="new-password" placeholder="No se muestra" /></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary" data-save-sicr>${icon("check")} Guardar</button></div>
      </div>
      ${secretNote}
    </div>
  </div>`;
}

function viewActuarial() {
  const classes = state.actuarial || [];
  if (!classes.length) {
    return `<div class="card"><div class="card-body"><div class="empty">${icon("activity")}<div>No hay clases de riesgo.</div></div></div></div>`;
  }
  const rows = classes
    .map(
      (item) => `<div class="row">
        <div><div class="who">${escapeAttr(item.name)}</div><div class="meta">${escapeAttr(item.id)}</div></div>
        <div class="push">
          <input id="rate-${escapeAttr(item.id)}" inputmode="numeric" value="${item.rate}" />
          <button class="btn btn-primary btn-sm" data-save-rate="${escapeAttr(item.id)}">${icon("check")} Guardar tasa</button>
        </div>
      </div>`,
    )
    .join("");
  return `<div class="card">
    <div class="card-head"><h3>Clases de riesgo</h3><span class="pill">Sin crédito</span></div>
    <div class="card-body flush">
      <p class="hint" style="padding:16px 20px 0">La prima de Frosting es trabajadores por esta tasa. Esta vista no es un curso.</p>
      <div class="rowlist">${rows}</div>
    </div>
  </div>`;
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

  const movements = movementFeed(state.overview.payments || [], true);

  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><h3>Libro de pagos</h3><span class="badge">${(state.overview.payments || []).length}</span></div>
      <div class="card-body flush">${movements}</div>
    </div>
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

function pesos(id) {
  const raw = String((document.getElementById(id) || {}).value || "").replace(/\D/g, "");
  return raw ? Number(raw) : 0;
}

async function reloadEmpresas(message) {
  toast(message);
  await refresh();
  route();
}

async function createCompany() {
  try {
    await api("/api/empresas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("emp-name").value,
        color: document.getElementById("emp-color").value,
        ownerEmail: document.getElementById("emp-owner").value,
      }),
    });
    await reloadEmpresas("Empresa creada");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function fundCompany(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/abono`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: pesos(`fund-${companyId}`) }),
    });
    await reloadEmpresas("Prepago cargado");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function createCompanyUser(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/usuarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById(`user-name-${companyId}`).value,
        email: document.getElementById(`user-email-${companyId}`).value,
        role: document.getElementById(`user-role-${companyId}`).value,
        password: document.getElementById(`user-password-${companyId}`).value,
      }),
    });
    await reloadEmpresas("Usuario de la empresa creado");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function activateGift(key) {
  const [companyId, giftId] = String(key || "").split(":");
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/regalos/${encodeURIComponent(giftId)}/activar`, {
      method: "POST",
    });
    await reloadEmpresas("Regalo activado");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function createGift(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/regalos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById(`gift-title-${companyId}`).value,
        note: document.getElementById(`gift-note-${companyId}`).value,
        recipientId: document.getElementById(`gift-who-${companyId}`).value,
      }),
    });
    await reloadEmpresas("Regalo virtual guardado");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function addWorker(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/trabajadores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById(`worker-name-${companyId}`).value,
        email: document.getElementById(`worker-email-${companyId}`).value,
      }),
    });
    await reloadEmpresas("Prepago del trabajador listo");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveLogo(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logo: document.getElementById(`logo-${companyId}`).value }),
    });
    await reloadEmpresas("Logo guardado en las tarjetas");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveCardOptions(key) {
  const [companyId, cardId] = String(key || "").split(":");
  const limitRaw = String((document.getElementById(`limit-${cardId}`) || {}).value || "").replace(/\D/g, "");
  const categories = [...document.querySelectorAll(`[data-cat="${cardId}"]`)]
    .filter((input) => input.checked)
    .map((input) => input.value);
  const period = (document.getElementById(`period-${cardId}`) || {}).value || "siempre";
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/tarjetas/${encodeURIComponent(cardId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spendLimit: limitRaw ? Number(limitRaw) : null,
        categories,
        period,
        periodFrom: period === "rango" ? (document.getElementById(`from-${cardId}`) || {}).value || null : null,
        periodUntil: period === "rango" ? (document.getElementById(`until-${cardId}`) || {}).value || null : null,
        blocked: Boolean((document.getElementById(`block-${cardId}`) || {}).checked),
        alerts: Boolean((document.getElementById(`alerts-${cardId}`) || {}).checked),
      }),
    });
    await reloadEmpresas("Opciones de la tarjeta guardadas");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function quoteFrosting(companyId) {
  const company = state.companies.find((item) => item.id === companyId);
  if (!company) return;
  try {
    const result = await api("/api/frosting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holderName: company.name,
        email: company.card.email,
        companyName: company.name,
        workers: pesos(`frost-workers-${companyId}`),
        riskClassId: document.getElementById(`frost-class-${companyId}`).value,
        gateway: selectedGateway(),
      }),
    });
    await reloadEmpresas(`Prima Frosting ${money(result.policy.premium)}`);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function enrollStudent(courseId) {
  try {
    await api(`/api/clases/${encodeURIComponent(courseId)}/alumnos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById(`alumno-name-${courseId}`).value,
        email: document.getElementById(`alumno-email-${courseId}`).value,
      }),
    });
    toast("Alumno inscrito");
    await refresh();
    route();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveSicr() {
  try {
    const secret = document.getElementById("sicr-secret").value;
    const body = { url: document.getElementById("sicr-url").value };
    if (secret) body.secret = secret;
    await api("/api/configuracion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    toast("Configuración guardada");
    await refresh();
    route();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveRiskRate(classId) {
  try {
    await api("/api/actuarial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId, rate: pesos(`rate-${classId}`) }),
    });
    toast("Tasa guardada");
    await refresh();
    route();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function requestGlobalAccounts(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/cuentas-virtuales`, { method: "POST" });
    await reloadEmpresas("Solicitud pendiente guardada");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function transferPrepaid(companyId) {
  try {
    await api(`/api/empresas/${encodeURIComponent(companyId)}/transferencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workerId: document.getElementById(`who-${companyId}`).value,
        amount: pesos(`amt-${companyId}`),
        direction: document.getElementById(`dir-${companyId}`).value,
      }),
    });
    await reloadEmpresas("Transferencia hecha");
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------------- view wiring ---------------- */
let correoState = { address: "", messages: [], selected: null, letter: null, mode: "empty", query: "" };

function viewCorreo() {
  return `<section class="mail-shell">
    <div class="mail-list">
      <div class="mail-toolbar">
        <div>
          <strong>Bandeja</strong>
          <span class="hint" id="correo-address"></span>
        </div>
        <button class="btn btn-primary btn-sm" id="correo-compose" type="button">${icon("plus")} Escribir</button>
      </div>
      <div class="mail-search"><input id="correo-query" placeholder="Buscar remitente o asunto" /></div>
      <div class="mail-scroll" id="correo-list"><p class="hint mail-pad">Cargando mensajes…</p></div>
    </div>
    <div class="mail-read" id="correo-read"></div>
  </section>`;
}

function mailWhen(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const now = new Date();
  const sameDay = parsed.toLocaleDateString("es-CL", { timeZone: "America/Santiago" }) === now.toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
  if (sameDay) return parsed.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
  return parsed.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" });
}

function mailInitial(name) {
  const letter = String(name || "?").trim().charAt(0).toUpperCase();
  return letter || "?";
}

function filteredCorreo() {
  const query = correoState.query.trim().toLowerCase();
  if (!query) return correoState.messages;
  return correoState.messages.filter((message) =>
    `${message.fromName || ""} ${message.from || ""} ${message.subject || ""} ${message.preview || ""}`.toLowerCase().includes(query),
  );
}

function renderCorreoList() {
  const list = document.getElementById("correo-list");
  if (!list) return;
  const messages = filteredCorreo();
  const unread = correoState.messages.filter((message) => !message.seen).length;
  const address = document.getElementById("correo-address");
  if (address) address.textContent = `${correoState.address}${unread ? ` · ${unread} sin leer` : ""}`;
  if (!correoState.messages.length) {
    list.innerHTML = `<div class="empty">${icon("inbox")}<div>La bandeja está vacía.</div></div>`;
    return;
  }
  if (!messages.length) {
    list.innerHTML = `<div class="empty">${icon("inbox")}<div>Ningún mensaje coincide.</div></div>`;
    return;
  }
  list.innerHTML = messages.map((message) => `<button type="button" class="mail-item${message.seen ? "" : " unread"}${String(correoState.selected) === String(message.uid) ? " active" : ""}" data-correo="${message.uid}">
      <span class="mail-avatar">${escapeAttr(mailInitial(message.fromName || message.from))}</span>
      <span class="mail-copy">
        <span class="mail-who">${escapeAttr(message.fromName || message.from || "Sin remitente")}</span>
        <span class="mail-subject">${escapeAttr(message.subject || "(sin asunto)")}</span>
        <span class="mail-preview">${escapeAttr(message.preview || "")}</span>
      </span>
      <span class="mail-time">${escapeAttr(mailWhen(message.date))}</span>
    </button>`).join("");
  list.querySelectorAll("[data-correo]").forEach((btn) => {
    btn.onclick = () => openCorreo(btn.dataset.correo);
  });
}

function renderCorreoPane() {
  const pane = document.getElementById("correo-read");
  if (!pane) return;
  if (correoState.mode === "compose") {
    const letter = correoState.letter;
    pane.innerHTML = `<form class="mail-compose" id="correo-form">
      <div class="mail-compose-head"><h2>${letter ? "Responder" : "Nuevo mensaje"}</h2><button class="btn btn-ghost btn-sm" type="button" id="correo-cancel">Cerrar</button></div>
      <div class="field"><label>Para</label><input id="correo-to" value="${escapeAttr(letter ? letter.fromEmail || "" : "")}" placeholder="nombre@empresa.cl" /></div>
      <div class="field"><label>Asunto</label><input id="correo-subject" value="${escapeAttr(letter ? `Re: ${letter.subject || ""}` : "")}" /></div>
      <div class="field"><label>Mensaje</label><textarea id="correo-text" rows="10">${letter ? escapeAttr(`\n\n---\n${letter.body || ""}`) : ""}</textarea></div>
      <button class="btn btn-primary" id="correo-send" type="submit">${icon("arrow")} Enviar</button>
    </form>`;
    document.getElementById("correo-cancel").onclick = () => {
      correoState.mode = letter ? "letter" : "empty";
      renderCorreoPane();
    };
    document.getElementById("correo-form").onsubmit = (event) => {
      event.preventDefault();
      sendCorreo();
    };
    return;
  }
  const letter = correoState.letter;
  if (!letter) {
    pane.innerHTML = `<div class="mail-empty">${icon("inbox")}<h2>Elige un mensaje</h2><p>La bandeja queda a la izquierda. Escribir abre un mensaje nuevo.</p></div>`;
    return;
  }
  pane.innerHTML = `<article class="mail-letter">
      <div class="mail-letter-head">
        <span class="mail-avatar">${escapeAttr(mailInitial(letter.fromName || letter.from))}</span>
        <div>
          <h2>${escapeAttr(letter.subject || "(sin asunto)")}</h2>
          <p>${escapeAttr(letter.from || "")}${letter.date ? ` · ${escapeAttr(mailWhen(letter.date) || letter.date)}` : ""}</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" id="correo-reply">Responder</button>
      </div>
      <pre class="correo-body">${escapeAttr(letter.body || "")}</pre>
    </article>`;
  document.getElementById("correo-reply").onclick = () => {
    correoState.mode = "compose";
    renderCorreoPane();
  };
}

async function loadCorreo() {
  const list = document.getElementById("correo-list");
  try {
    const box = await api("/api/correo");
    correoState.address = box.address || "";
    correoState.messages = box.messages || [];
    renderCorreoList();
    renderCorreoPane();
  } catch (error) {
    if (list) list.innerHTML = `<p class="hint mail-pad">${escapeAttr(error.message)}</p>`;
  }
}

async function openCorreo(uid) {
  correoState.selected = uid;
  correoState.mode = "letter";
  correoState.letter = null;
  const pane = document.getElementById("correo-read");
  if (pane) pane.innerHTML = `<p class="hint mail-pad">Abriendo…</p>`;
  renderCorreoList();
  try {
    const letter = await api(`/api/correo/${uid}`);
    correoState.letter = letter;
    correoState.messages = correoState.messages.map((message) =>
      String(message.uid) === String(uid) ? { ...message, seen: true } : message,
    );
    renderCorreoList();
    renderCorreoPane();
  } catch (error) {
    if (pane) pane.innerHTML = `<p class="hint mail-pad">${escapeAttr(error.message)}</p>`;
  }
}

async function sendCorreo() {
  const button = document.getElementById("correo-send");
  button.disabled = true;
  try {
    await api("/api/correo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: document.getElementById("correo-to").value,
        subject: document.getElementById("correo-subject").value,
        text: document.getElementById("correo-text").value,
      }),
    });
    toast("Mensaje enviado");
    correoState.mode = "empty";
    correoState.letter = null;
    await loadCorreo();
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
}

function wireView(r) {
  if (r === "correo") {
    correoState = { address: "", messages: [], selected: null, letter: null, mode: "empty", query: "" };
    loadCorreo();
    document.getElementById("correo-compose").onclick = () => {
      correoState.mode = "compose";
      correoState.letter = null;
      renderCorreoPane();
    };
    document.getElementById("correo-query").oninput = (event) => {
      correoState.query = event.target.value;
      renderCorreoList();
    };
  }
  if (r === "overview") {
    document.querySelectorAll("[data-global-accounts]").forEach((btn) => {
      btn.onclick = () => requestGlobalAccounts(btn.dataset.globalAccounts);
    });
    document.querySelectorAll("[data-confirm-exit]").forEach((btn) => {
      btn.onclick = () => confirmPendingExit(btn.dataset.confirmExit, btn);
    });
    document.querySelectorAll("[data-activate-gift]").forEach((btn) => {
      btn.onclick = () => activateGift(btn.dataset.activateGift);
    });
    document.querySelectorAll("[data-create-user]").forEach((btn) => {
      btn.onclick = () => createCompanyUser(btn.dataset.createUser);
    });
  }
  if (r === "accounts") {
    const open = document.querySelector("[data-open-account]");
    if (open) open.onclick = () => openAccountModal();
    document.querySelectorAll("[data-fund]").forEach((btn) => {
      btn.onclick = () => openFundModal(state.accounts.find((a) => a.id === btn.dataset.fund));
    });
    document.querySelectorAll("[data-withdraw]").forEach((btn) => {
      btn.onclick = () => openWithdrawModal(state.accounts.find((a) => a.id === btn.dataset.withdraw));
    });
  }
  if (r === "cobros") {
    const open = document.querySelector("[data-new-cobro]");
    if (open) open.onclick = () => openCobroModal();
  }
  if (r === "plans") {
    const btn = document.querySelector("[data-credito]");
    if (btn) btn.onclick = () => openSubscribeModal();
  }
  if (r === "policies") {
    document.querySelectorAll("[data-claim]").forEach((btn) => {
      btn.onclick = () => openClaimModal(state.overview.policies.find((p) => p.id === btn.dataset.claim));
    });
  }
  if (r === "connect") {
    const open = document.querySelector("[data-new-connect]");
    if (open) open.onclick = () => openConnectModal();
    document.querySelectorAll("[data-connect-pay]").forEach((btn) => {
      btn.onclick = () => openConnectPayModal(state.connect.find((a) => a.id === btn.dataset.connectPay));
    });
  }
  if (r === "treasury") {
    const open = document.querySelector("[data-new-treasury]");
    if (open) open.onclick = () => openTreasuryModal();
    document.querySelectorAll("[data-treasury-fund]").forEach((btn) => {
      btn.onclick = () => openTreasuryFundModal(state.treasury.find((a) => a.id === btn.dataset.treasuryFund));
    });
  }
  if (r === "cards") {
    const open = document.querySelector("[data-new-card]");
    if (open) open.onclick = () => openCardModal();
    document.querySelectorAll("[data-insure]").forEach((btn) => {
      btn.onclick = () => insureCard(state.cards.find((c) => c.id === btn.dataset.insure));
    });
  }
  if (r === "empresas") {
    const create = document.querySelector("[data-create-company]");
    if (create) create.onclick = () => createCompany();
    document.querySelectorAll("[data-fund-company]").forEach((btn) => {
      btn.onclick = () => fundCompany(btn.dataset.fundCompany);
    });
    document.querySelectorAll("[data-add-worker]").forEach((btn) => {
      btn.onclick = () => addWorker(btn.dataset.addWorker);
    });
    document.querySelectorAll("[data-transfer]").forEach((btn) => {
      btn.onclick = () => transferPrepaid(btn.dataset.transfer);
    });
    document.querySelectorAll("[data-save-card]").forEach((btn) => {
      btn.onclick = () => saveCardOptions(btn.dataset.saveCard);
    });
    document.querySelectorAll("[data-save-logo]").forEach((btn) => {
      btn.onclick = () => saveLogo(btn.dataset.saveLogo);
    });
    document.querySelectorAll("[data-frosting]").forEach((btn) => {
      btn.onclick = () => quoteFrosting(btn.dataset.frosting);
    });
    document.querySelectorAll("[data-create-gift]").forEach((btn) => {
      btn.onclick = () => createGift(btn.dataset.createGift);
    });
    document.querySelectorAll("[data-activate-gift]").forEach((btn) => {
      btn.onclick = () => activateGift(btn.dataset.activateGift);
    });
    document.querySelectorAll("[data-create-user]").forEach((btn) => {
      btn.onclick = () => createCompanyUser(btn.dataset.createUser);
    });
  }
  if (r === "clases") {
    document.querySelectorAll("[data-enroll]").forEach((btn) => {
      btn.onclick = () => enrollStudent(btn.dataset.enroll);
    });
  }
  if (r === "configuracion") {
    const save = document.querySelector("[data-save-sicr]");
    if (save) save.onclick = () => saveSicr();
  }
  if (r === "actuarial") {
    document.querySelectorAll("[data-save-rate]").forEach((btn) => {
      btn.onclick = () => saveRiskRate(btn.dataset.saveRate);
    });
  }
  if (r === "design") {
    const save = document.querySelector("[data-save-design]");
    if (save) save.onclick = () => saveDesign();
  }
  if (r === "apps") {
    const create = document.querySelector("[data-create-app]");
    if (create) create.onclick = () => createApp();
  }
}

/* ---------------- modals ---------------- */
function closeModal() {
  if (window.__instripeCheckout) {
    window.__instripeCheckout.destroy();
    window.__instripeCheckout = null;
  }
  document.getElementById("modal-root").innerHTML = "";
}

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/dahlia/stripe.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar Stripe.js"));
    document.head.appendChild(script);
  });
}

function mountModal(html, options) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="overlay" data-overlay>${html}</div>`;
  if (!options || !options.locked) {
    root.querySelector("[data-overlay]").addEventListener("click", (e) => {
      if (e.target.dataset.overlay !== undefined) closeModal();
    });
  }
}

async function confirmPendingExit(id, btn) {
  btn.disabled = true;
  try {
    await api(`/api/salidas/${encodeURIComponent(id)}/confirmar`, { method: "POST" });
    await refresh();
    route();
    toast("Salida confirmada");
  } catch (err) {
    btn.disabled = false;
    toast(err.message, "error");
  }
}

function openAccountModal() {
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Abrir cuenta</h3><p>Wallet del módulo de cuentas. Todavía no mueve dinero.</p></div>
      <div class="modal-body">
        <div class="field"><label>Nombre</label><input id="a-name" value="Taller Sur" /></div>
        <div class="field"><label>Email</label><input id="a-email" type="email" value="caja@taller.cl" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("plus")} Abrir</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api("/api/cuentas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("a-name").value,
          email: document.getElementById("a-email").value,
        }),
      });
      closeModal();
      await refresh();
      route();
      toast("Cuenta abierta");
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openFundModal(account) {
  if (!account) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Recargar ${account.name}</h3><p>El cobro entra por pagos y acredita esta wallet.</p></div>
      <div class="modal-body">
        <div class="field"><label>Monto</label><input id="f-amount" type="number" value="10000" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("plus")} Recargar</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api(`/api/cuentas/${account.id}/recarga`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(document.getElementById("f-amount").value), gateway: selectedGateway() }),
      });
      if (result.charge.clientSecret && result.charge.publishableKey) {
        await mountEmbeddedCheckout(result, { name: "Recarga" });
        return;
      }
      closeModal();
      await refresh();
      route();
      toast(`Recarga liquidada · saldo ${money(result.account.balance)}`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openWithdrawModal(account) {
  if (!account) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Retirar de ${account.name}</h3><p>Queda pedido hasta que otro usuario de operación lo confirme. Saldo ${money(account.balance)}.</p></div>
      <div class="modal-body">
        <div class="field"><label>Monto</label><input id="w-amount" type="number" placeholder="Ej: 4000" /></div>
        <div class="field"><label>Destino</label><input id="w-dest" value="12.345.678-9" />
          <div class="hint">Con Stripe el destino es una cuenta conectada acct_. Un RUT no se envía.</div></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("zap")} Retirar</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const amount = Number(document.getElementById("w-amount").value);
    if (!amount) return toast("Ingresa un monto", "error");
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api(`/api/cuentas/${account.id}/retiro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          destination: document.getElementById("w-dest").value,
          gateway: selectedGateway(),
        }),
      });
      closeModal();
      await refresh();
      route();
      toast(`Retiro pedido · saldo ${money(result.account.balance)}. Otro usuario de operación tiene que confirmarlo.`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openCobroModal() {
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Nuevo cobro</h3><p>Queda en el libro de pagos, igual que una recarga o una prima.</p></div>
      <div class="modal-body">
        <div class="field"><label>Concepto</label><input id="b-concept" value="Mantención mensual" /></div>
        <div class="field"><label>Pagador</label><input id="b-name" value="Oficina Norte" /></div>
        <div class="field"><label>Email</label><input id="b-email" type="email" value="pago@norte.cl" /></div>
        <div class="field"><label>Monto</label><input id="b-amount" type="number" value="15000" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("check")} Cobrar</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api("/api/cobros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: document.getElementById("b-concept").value,
          payerName: document.getElementById("b-name").value,
          email: document.getElementById("b-email").value,
          amount: Number(document.getElementById("b-amount").value),
          gateway: selectedGateway(),
        }),
      });
      if (result.charge.clientSecret && result.charge.publishableKey) {
        await mountEmbeddedCheckout(result, { name: result.cobro.concept });
        return;
      }
      closeModal();
      await refresh();
      route();
      toast(`Cobro ${result.cobro.id} liquidado en pagos`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openSubscribeModal() {
  const rate = (state.plans[0] && state.plans[0].rateBps) || 60;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Asegurar crédito de tarjeta</h3><p>La prima es el ${rate / 100}% del cupo y se cobra por ${gatewayLabel(selectedGateway())}.</p></div>
      <div class="modal-body">
        <div class="field"><label>Titular</label><input id="m-name" value="Ana Díaz" /></div>
        <div class="field"><label>Email</label><input id="m-email" type="email" value="ana@demo.cl" /></div>
        <div class="field"><label>Tarjeta</label><input id="m-card" value="Visa •••• 4242" /></div>
        <div class="field"><label>Crédito de la tarjeta</label><input id="m-cupo" type="number" value="1500000" />
          <div class="hint" id="m-prima">Prima ${money(Math.round((1500000 * rate) / 10000))}</div></div>
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
  const cupoInput = document.getElementById("m-cupo");
  cupoInput.oninput = () => {
    const prima = Math.round((Number(cupoInput.value) * rate) / 10000);
    document.getElementById("m-prima").textContent = prima > 0 ? `Prima ${money(prima)}` : "Ingresa el crédito de la tarjeta";
  };
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
          holderName: document.getElementById("m-name").value || "Cliente",
          email: document.getElementById("m-email").value || "cliente@demo.cl",
          cardLabel: document.getElementById("m-card").value || "Tarjeta",
          cupo: Number(document.getElementById("m-cupo").value),
          gateway: document.getElementById("m-gateway").value,
        }),
      });
      if (result.charge.clientSecret && result.charge.publishableKey) {
        await mountEmbeddedCheckout(result, { name: "Crédito " + (document.getElementById("m-card").value || "TC") });
        return;
      }
      if (result.charge.mode === "live" && result.charge.redirectUrl) {
        window.location.assign(result.charge.redirectUrl);
        return;
      }
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

async function mountEmbeddedCheckout(result, plan) {
  mountModal(`
    <div class="modal wide">
      <div class="modal-head">
        <h3>Pagar ${plan.name}</h3>
        <p>Pago embebido. El movimiento queda liquidado cuando el pago se confirma.</p>
      </div>
      <div class="modal-body"><div id="embedded-checkout"></div></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cerrar</button>
      </div>
    </div>`);
  document.getElementById("modal-root").querySelector("[data-cancel]").onclick = closeModal;
  await loadStripeJs();
  const stripe = window.Stripe(result.charge.publishableKey);
  const clientSecret = result.charge.clientSecret;
  const checkout = await stripe.createEmbeddedCheckoutPage({
    fetchClientSecret: async () => clientSecret,
  });
  window.__instripeCheckout = checkout;
  checkout.mount("#embedded-checkout");
}

function openClaimModal(policy) {
  if (!policy) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Dispersar siniestro</h3><p>Queda pedido hasta que otro usuario de operación lo confirme · póliza ${policy.id}.</p></div>
      <div class="modal-body">
        <div class="field"><label>Monto del siniestro</label><input id="c-amount" type="number" placeholder="Ej: 20000" />
          <div class="hint">Crédito asegurado: ${money(policy.cupo || policy.coverage)}</div></div>
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
      toast(`Siniestro ${result.claim.id} pedido. Otro usuario de operación tiene que confirmarlo.`);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon("zap")} Dispersar fondos`;
      toast(err.message, "error");
    }
  };
}

function openConnectModal() {
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Cuenta Connect</h3><p>Cuenta conectada Express. Un pago posterior sale por el libro de pagos.</p></div>
      <div class="modal-body">
        <div class="field"><label>Negocio</label><input id="k-name" value="Taller Sur" /></div>
        <div class="field"><label>Email</label><input id="k-email" type="email" value="caja@taller.cl" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("check")} Crear</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: document.getElementById("k-name").value,
          email: document.getElementById("k-email").value,
        }),
      });
      closeModal();
      await refresh();
      route();
      toast(result.account.mode === "live" ? `Connect ${result.account.stripeAccountId} creado` : result.account.mode === "pending" ? "Cuenta creada. Stripe todavía no habilita los pagos." : `Connect en demo${result.account.notice ? ": " + result.account.notice : ""}`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openConnectPayModal(account) {
  if (!account) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Pagar a ${account.businessName}</h3><p>Dispersa desde el dinero de la plataforma.</p></div>
      <div class="modal-body">
        <div class="field"><label>Monto</label><input id="k-amount" type="number" value="5000" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("zap")} Pagar</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/connect/${account.id}/pago`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(document.getElementById("k-amount").value), gateway: selectedGateway() }),
      });
      closeModal();
      await refresh();
      route();
      toast(`Pago a ${account.businessName} pedido. Otro usuario de operación tiene que confirmarlo.`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openTreasuryModal() {
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Cuenta financiera</h3><p>Si Treasury no está activo en Stripe, la cuenta queda en demo y el abono igual entra a pagos.</p></div>
      <div class="modal-body">
        <div class="field"><label>Nombre</label><input id="t-name" value="Caja principal" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("check")} Abrir</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: document.getElementById("t-name").value }),
      });
      closeModal();
      await refresh();
      route();
      toast(result.account.mode === "live" ? "Treasury live" : "Treasury en demo");
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openTreasuryFundModal(account) {
  if (!account) return;
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Abonar ${account.nickname}</h3><p>El abono es un cobro del núcleo de pagos.</p></div>
      <div class="modal-body">
        <div class="field"><label>Monto</label><input id="t-amount" type="number" value="20000" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("check")} Abonar</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api(`/api/treasury/${account.id}/abono`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(document.getElementById("t-amount").value), gateway: "chile" }),
      });
      if (result.charge.clientSecret && result.charge.publishableKey) {
        await mountEmbeddedCheckout(result, { name: "Abono " + account.nickname });
        return;
      }
      closeModal();
      await refresh();
      route();
      toast(`Abono liquidado en pagos`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

function openCardModal() {
  const real = Boolean(state.issuing && state.issuing.stripeConfigured);
  const identity = real
    ? `<div class="field"><label>Nacimiento</label><input id="c-dob" type="date" /></div>
        <div class="field"><label>Dirección</label><input id="c-line" placeholder="Calle y número" /></div>
        <div class="field"><label>Ciudad</label><input id="c-city" /></div>
        <div class="field"><label>País</label><input id="c-country" maxlength="2" placeholder="ES" /></div>
        <div class="field"><label>Código postal</label><input id="c-postal" /></div>`
    : "";
  mountModal(`
    <div class="modal">
      <div class="modal-head"><h3>Emitir tarjeta</h3><p>${real ? "Tarjeta virtual de Stripe. El número no pasa por este servidor. El cupo es el crédito asegurable." : "Sin clave de Stripe esto queda en demo y no es una tarjeta real."}</p></div>
      <div class="modal-body">
        <div class="field"><label>Titular</label><input id="c-name" value="${real ? "" : "Ana Díaz"}" /></div>
        <div class="field"><label>Email</label><input id="c-email" type="email" value="${real ? "" : "ana@demo.cl"}" /></div>
        <div class="field"><label>Teléfono</label><input id="c-phone" placeholder="+56912345678" value="${real ? "" : "+56912345678"}" /></div>
        <div class="field"><label>Cupo</label><input id="c-cupo" type="number" value="1500000" /></div>
        ${identity}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-cancel>Cancelar</button>
        <button class="btn btn-primary" data-confirm>${icon("check")} Emitir</button>
      </div>
    </div>`);
  const root = document.getElementById("modal-root");
  root.querySelector("[data-cancel]").onclick = closeModal;
  root.querySelector("[data-confirm]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const payload = {
        holderName: document.getElementById("c-name").value,
        email: document.getElementById("c-email").value,
        phone: document.getElementById("c-phone").value,
        cupo: Number(document.getElementById("c-cupo").value),
      };
      const dob = document.getElementById("c-dob");
      if (dob && dob.value) {
        const [year, month, day] = dob.value.split("-").map(Number);
        payload.dob = { day, month, year };
        payload.address = {
          line1: document.getElementById("c-line").value,
          city: document.getElementById("c-city").value,
          country: document.getElementById("c-country").value,
          postalCode: document.getElementById("c-postal").value,
        };
      }
      const result = await api("/api/tarjetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeModal();
      await refresh();
      route();
      const card = result.card;
      toast(`${card.brand} •••• ${card.last4} · ${card.mode}`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  };
}

async function insureCard(card) {
  if (!card) return;
  try {
    const result = await api("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holderName: card.holderName,
        email: card.email,
        cardLabel: `${card.brand} •••• ${card.last4}`,
        cupo: card.cupo,
        gateway: "chile",
      }),
    });
    if (result.charge && result.charge.clientSecret && result.charge.publishableKey) {
      await mountEmbeddedCheckout(result, { name: "Crédito " + card.brand });
      return;
    }
    await refresh();
    toast(`Póliza del cupo ${money(card.cupo)} activada`);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveDesign() {
  try {
    const design = await api("/api/diseno", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: document.getElementById("d-name").value,
        buttonColor: document.getElementById("d-button").value,
        backgroundColor: document.getElementById("d-bg").value,
        borderStyle: document.getElementById("d-border").value,
        carrierTitle: document.getElementById("d-title").value,
        carrierBody: document.getElementById("d-body").value,
      }),
    });
    state.design = design.design;
    applyDesign(state.design);
    route();
    toast("Diseño guardado");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function createApp() {
  try {
    const result = await api("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: document.getElementById("app-name").value }),
    });
    state.appManifest = result.manifest;
    route();
    toast(`App ${result.manifest.id} escrita en stripe-app.json`);
  } catch (err) {
    toast(err.message, "error");
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

boot();
