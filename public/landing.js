const sponsorshipLink = document.getElementById("sponsorship-link");
const sponsorshipEmail = document.getElementById("sponsorship-email");
const sponsorshipStatus = document.getElementById("sponsorship-status");
const contactForm = document.getElementById("sponsorship-form");
const contactFormStatus = document.getElementById("contact-form-status");

if (sponsorshipLink && sponsorshipEmail && sponsorshipStatus) {
  fetch("/api/public-contact")
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el correo de contacto");
      if (typeof data.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        throw new Error("El correo de contacto configurado no es válido");
      }

      sponsorshipLink.href = `mailto:${data.email}?subject=${encodeURIComponent("Patrocinio y alianzas | Proveedor Regional")}`;
      sponsorshipEmail.textContent = data.email;
      sponsorshipLink.hidden = false;
      sponsorshipStatus.hidden = true;
    })
    .catch(() => {
      sponsorshipStatus.textContent = "No se pudo cargar el correo de contacto. Revisa PUBLIC_CONTACT_EMAIL.";
    });
}

if (contactForm && contactFormStatus) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!contactForm.reportValidity()) return;

    const submit = contactForm.querySelector('button[type="submit"]');
    const field = (name) => contactForm.elements.namedItem(name).value;
    const payload = {
      name: field("name"),
      email: field("email"),
      organization: field("organization"),
      topic: field("topic"),
      message: field("message"),
      consent: contactForm.elements.namedItem("consent").checked,
      website: field("website"),
    };
    contactFormStatus.textContent = "Enviando tu consulta…";
    contactFormStatus.dataset.state = "";
    submit.disabled = true;

    try {
      const response = await fetch("/api/public-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo enviar la consulta.");
      contactForm.reset();
      contactFormStatus.textContent = "Gracias. Recibimos tu consulta y responderemos al correo que indicaste.";
      contactFormStatus.dataset.state = "success";
    } catch (error) {
      contactFormStatus.textContent = error.message || "No se pudo enviar la consulta. Inténtalo nuevamente.";
      contactFormStatus.dataset.state = "error";
    } finally {
      submit.disabled = false;
    }
  });
}
