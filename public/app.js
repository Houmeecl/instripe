const state = { currency: "clp", gateways: [], defaultGateway: "chile" };

function selectedGateway() {
  const sel = document.getElementById("gateway");
  return sel.value || state.defaultGateway;
}

function toast(message, isError) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

async function boot() {
  const health = await api("/health");
  state.currency = health.currency;
  state.defaultGateway = health.defaultGateway;

  const gw = await api("/api/gateways");
  state.gateways = gw.gateways;
  const sel = document.getElementById("gateway");
  sel.innerHTML = "";
  for (const g of gw.gateways) {
    const opt = document.createElement("option");
    opt.value = g.name;
    opt.textContent = g.label + (g.configured ? " (live)" : " (demo)");
    if (g.name === gw.defaultGateway) opt.selected = true;
    sel.appendChild(opt);
  }
  updateModeBadge();
  sel.addEventListener("change", updateModeBadge);

  await loadPlans();
  await refresh();
}

function updateModeBadge() {
  const badge = document.getElementById("mode-badge");
  const g = state.gateways.find((x) => x.name === selectedGateway());
  const live = g && g.configured;
  badge.textContent = live ? "modo live" : "modo demo";
  badge.classList.toggle("live", Boolean(live));
}

async function loadPlans() {
  const data = await api("/api/plans");
  const container = document.getElementById("plans");
  container.innerHTML = "";
  for (const plan of data.plans) {
    container.appendChild(renderPlan(plan));
  }
}

function renderPlan(plan) {
  const card = document.createElement("div");
  card.className = "plan";
  card.innerHTML = `
    <h3>${plan.name}</h3>
    <p class="desc">${plan.description}</p>
    <div class="premium">${plan.displayPremium}<span style="font-size:13px;color:var(--muted)"> /mes</span></div>
    <div class="coverage">Cobertura hasta ${plan.displayCoverage}</div>
  `;
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Contratar";
  btn.dataset.testid = `subscribe-${plan.id}`;
  btn.addEventListener("click", () => subscribe(plan, btn));
  card.appendChild(btn);
  return card;
}

let holderSeq = 1;
async function subscribe(plan, btn) {
  btn.disabled = true;
  btn.textContent = "Procesando…";
  try {
    const holderName = `Cliente Demo ${holderSeq}`;
    const email = `cliente${holderSeq}@demo.cl`;
    holderSeq += 1;
    const result = await api("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: plan.id, holderName, email, gateway: selectedGateway() }),
    });
    toast(`Póliza ${result.policy.id} activada · prima cobrada vía ${result.charge.gateway} (${result.charge.mode})`);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Contratar";
  }
}

async function refresh() {
  const data = await api("/api/overview");
  document.getElementById("float-balance").textContent = data.float.displayBalance;
  document.getElementById("policy-count").textContent = String(data.policies.length);
  document.getElementById("claim-count").textContent = String(data.claims.length);
  renderPolicies(data.policies);
  renderClaims(data.claims);
}

function renderPolicies(policies) {
  const container = document.getElementById("policies");
  if (!policies.length) {
    container.innerHTML = '<p class="muted">Aún no hay pólizas. Contrata un plan para comenzar.</p>';
    return;
  }
  container.innerHTML = "";
  for (const policy of policies) {
    const row = document.createElement("div");
    row.className = "policy";
    row.innerHTML = `
      <div>
        <div class="who">${policy.holderName}</div>
        <div class="meta">${policy.id} · plan ${policy.planId}</div>
      </div>
      <span class="pill">${policy.status}</span>
    `;
    const push = document.createElement("div");
    push.className = "push";
    const amount = document.createElement("input");
    amount.type = "number";
    amount.placeholder = "Monto siniestro";
    amount.dataset.testid = `claim-amount-${policy.id}`;
    const beneficiary = document.createElement("input");
    beneficiary.type = "text";
    beneficiary.placeholder = "Beneficiario / RUT";
    beneficiary.value = "12.345.678-9";
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = "Dispersar siniestro";
    btn.dataset.testid = `claim-submit-${policy.id}`;
    btn.addEventListener("click", () => fileClaim(policy, amount, beneficiary, btn));
    push.append(amount, beneficiary, btn);
    row.appendChild(push);
    container.appendChild(row);
  }
}

async function fileClaim(policy, amountInput, beneficiaryInput, btn) {
  const amount = Number(amountInput.value);
  if (!amount) {
    toast("Ingresa un monto de siniestro", true);
    return;
  }
  btn.disabled = true;
  btn.textContent = "Dispersando…";
  try {
    const result = await api("/api/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyId: policy.id,
        amount,
        beneficiary: beneficiaryInput.value || "beneficiario-demo",
        gateway: selectedGateway(),
      }),
    });
    toast(`Fondos dispersados: ${result.claim.id} vía ${result.payout.gateway} (${result.payout.status})`);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Dispersar siniestro";
  }
}

function renderClaims(claims) {
  const list = document.getElementById("claims");
  if (!claims.length) {
    list.innerHTML = '<li class="muted">Sin siniestros todavía.</li>';
    return;
  }
  list.innerHTML = "";
  for (const claim of [...claims].reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="amt">${fmt(claim.amount)}</span>
      <span>→ ${claim.beneficiary}</span>
      <code>${claim.id} · ${claim.status}</code>
    `;
    list.appendChild(li);
  }
}

function fmt(amount) {
  const zeroDecimal = ["clp", "jpy", "krw"].includes(state.currency);
  const value = zeroDecimal ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(state.currency === "clp" ? "es-CL" : "en-US", {
      style: "currency",
      currency: state.currency.toUpperCase(),
      minimumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value);
  } catch {
    return `${value} ${state.currency.toUpperCase()}`;
  }
}

boot().catch((err) => toast("Error al iniciar: " + err.message, true));
