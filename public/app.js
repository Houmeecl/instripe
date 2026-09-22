async function loadProducts() {
  const badge = document.getElementById("mode-badge");
  const container = document.getElementById("products");

  try {
    const health = await fetch("/health").then((r) => r.json());
    if (health.stripeConfigured) {
      badge.textContent = "live";
      badge.classList.add("live");
    } else {
      badge.textContent = "demo mode";
      badge.classList.add("demo");
    }

    const data = await fetch("/api/products").then((r) => r.json());
    container.innerHTML = "";
    for (const product of data.products) {
      container.appendChild(renderProduct(product));
    }
  } catch (err) {
    container.innerHTML = `<p class="loading">Failed to load products: ${err}</p>`;
  }
}

function renderProduct(product) {
  const card = document.createElement("div");
  card.className = "product";

  const title = document.createElement("h2");
  title.textContent = product.name;

  const desc = document.createElement("p");
  desc.className = "desc";
  desc.textContent = product.description;

  const price = document.createElement("div");
  price.className = "price";
  price.textContent = product.displayAmount;

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Buy now";
  btn.dataset.testid = `buy-${product.id}`;
  btn.addEventListener("click", () => checkout(product.id, btn));

  card.append(title, desc, price, btn);
  return card;
}

async function checkout(productId, btn) {
  btn.disabled = true;
  btn.textContent = "Redirecting…";
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    if (!res.ok) {
      throw new Error(`Checkout failed (${res.status})`);
    }
    const session = await res.json();
    window.location.assign(session.url);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Buy now";
    alert(err.message);
  }
}

loadProducts();
