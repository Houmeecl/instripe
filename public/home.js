const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const menu = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#navigation");
const mobile = window.matchMedia("(max-width: 700px)");

function setMenu(open) {
  menu.setAttribute("aria-expanded", String(open));
  navigation.dataset.collapsed = String(mobile.matches && !open);
}
menu.hidden = false;
setMenu(false);
menu.addEventListener("click", () =>
  setMenu(menu.getAttribute("aria-expanded") !== "true"),
);
navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    mobile.matches &&
    menu.getAttribute("aria-expanded") === "true"
  ) {
    setMenu(false);
    menu.focus();
  }
});
mobile.addEventListener("change", () => setMenu(false));

const motionToggle = document.querySelector("#motion-toggle");
motionToggle.hidden = false;
function setMotion(paused) {
  document.documentElement.classList.toggle("motion-paused", paused);
  motionToggle.setAttribute("aria-pressed", String(paused));
  motionToggle.textContent = paused
    ? "Movimiento pausado"
    : "Pausar movimiento";
}
setMotion(reducedMotion.matches);
motionToggle.addEventListener("click", () =>
  setMotion(motionToggle.getAttribute("aria-pressed") !== "true"),
);
reducedMotion.addEventListener("change", () =>
  setMotion(reducedMotion.matches),
);

if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const observer = new window.IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );
  document.documentElement.classList.add("reveal-ready");
  document
    .querySelectorAll(".reveal")
    .forEach((element) => observer.observe(element));
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", () => {
      const target = document.getElementById(link.hash.slice(1));
      target
        ?.querySelectorAll(".reveal")
        .forEach((element) => element.classList.add("is-visible"));
    });
  });
}

const communes = {
  antofagasta: [
    "Antofagasta",
    "Puerto, servicios y comercio. Una ciudad que conecta el desierto con el océano.",
    "puerto.jpg",
    "Costa de Antofagasta",
    "Fotografía de Antofagasta.",
  ],
  calama: [
    "Calama",
    "Oasis del Loa y capital minera. Capacidades locales al servicio de una región productiva.",
    "salar.jpg",
    "Ferrocarril en el salar de Carcote, Región de Antofagasta",
    "Paisaje regional de referencia: salar de Carcote; no corresponde a la ciudad de Calama.",
  ],
  mejillones: [
    "Mejillones",
    "Actividad portuaria, industria y logística. Un punto de encuentro entre empresas y territorio.",
    "mejillones.jpg",
    "Puerto Angamos, Mejillones",
    "Fotografía de Puerto Angamos, Mejillones.",
  ],
  tocopilla: [
    "Tocopilla",
    "Energía, industria y borde costero. Identidad portuaria y empresas con vocación local.",
    "faro.jpg",
    "Faro y costa de Antofagasta",
    "Paisaje regional de referencia: costa de Antofagasta; no corresponde a Tocopilla.",
  ],
  "maria-elena": [
    "María Elena",
    "Pampa salitrera y patrimonio vivo. Oficios y servicios con raíces en el desierto.",
    "salar.jpg",
    "Ferrocarril en el salar de Carcote, Región de Antofagasta",
    "Paisaje regional de referencia: salar de Carcote; no corresponde a María Elena.",
  ],
  "san-pedro": [
    "San Pedro de Atacama",
    "Turismo, cultura e identidad. Empresas que crecen en conexión con su entorno.",
    "san-pedro.jpg",
    "Calle Caracoles, San Pedro de Atacama",
    "Fotografía de San Pedro de Atacama.",
  ],
  "sierra-gorda": [
    "Sierra Gorda",
    "Operaciones mineras y encadenamientos. Capacidades que pueden fortalecerse desde el territorio.",
    "salar.jpg",
    "Ferrocarril en el salar de Carcote, Región de Antofagasta",
    "Paisaje regional de referencia: salar de Carcote; no corresponde a Sierra Gorda.",
  ],
  taltal: [
    "Taltal",
    "Caletas, oficios y memoria salitrera. Un territorio costero con identidad propia.",
    "puerto.jpg",
    "Costa de Antofagasta",
    "Paisaje regional de referencia: costa de Antofagasta; no corresponde a Taltal.",
  ],
  ollague: [
    "Ollagüe",
    "Altiplano, frontera y comunidad. Desarrollo que reconoce las particularidades de su territorio.",
    "miscanti.jpg",
    "Laguna Miscanti, Región de Antofagasta",
    "Paisaje regional de referencia: laguna Miscanti; no corresponde a Ollagüe.",
  ],
};

const image = document.querySelector("#territory-image");
document.querySelectorAll("[data-commune]").forEach((button, index) => {
  button.addEventListener("click", () => {
    const [name, description, photo, alt, note] =
      communes[button.dataset.commune];
    document
      .querySelectorAll("[data-commune]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    document.querySelector("#territory-index").textContent =
      String(index + 1).padStart(2, "0") + " / 09";
    document.querySelector("#territory-name").textContent = name;
    document.querySelector("#territory-description").textContent = description;
    document.querySelector("#territory-note").textContent = note;
    image.src = "/fotos/" + photo;
    image.alt = alt;
    if (
      !reducedMotion.matches &&
      !document.documentElement.classList.contains("motion-paused") &&
      typeof image.animate === "function"
    ) {
      image.getAnimations().forEach((animation) => animation.cancel());
      image.animate(
        [
          { opacity: 0.5, transform: "scale(1.025)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 500, easing: "ease-out" },
      );
    }
  });
});
