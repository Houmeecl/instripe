import { createApp } from "./app.js";
import { loadConfig, isStripeConfigured, isChileConfigured } from "./config.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  const stripe = isStripeConfigured(config) ? "live" : "demo";
  const chile = isChileConfigured(config) ? "live" : "demo";
  console.log(
    `instripe BaaS listening on http://localhost:${config.port} ` +
      `[currency=${config.currency}, default=${config.defaultGateway}, stripe=${stripe}, chile=${chile}]`,
  );
});
