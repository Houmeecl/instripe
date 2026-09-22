import { createApp } from "./app.js";
import { loadConfig, isStripeConfigured } from "./config.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  const mode = isStripeConfigured(config) ? "live Stripe" : "demo (no STRIPE_SECRET_KEY)";
  console.log(`instripe listening on http://localhost:${config.port} [${mode}]`);
});
