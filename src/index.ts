import { existsSync, readFileSync } from "node:fs";
import { createApp } from "./app.js";
import { loadConfig, isStripeConfigured, isChileConfigured } from "./config.js";

loadDotEnv();

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

/** Load `.env` without overriding variables already set in the process. */
function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
