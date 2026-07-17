/** Environment variables used by the Node self-host.
 *
 * The application reads from `process.env` at its composition root. This
 * interface is a small reference for deployment tooling and tests; it
 * intentionally contains no Cloudflare bindings or hosted-only services.
 */
export interface Env {
  DATABASE_URL?: string;
  DATABASE_PATH?: string;
  DATA_DIR?: string;
  AUTH_DATABASE_PATH?: string;
  AUTH_DISABLED?: string;
  BETTER_AUTH_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_NAME?: string;
  API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  CONSOLE_DIR?: string;
  PORT?: string;
  HOST?: string;
  SANDBOX_PROVIDER?: "subprocess";
  WORKER_MAX_ACTIVE?: string;
  USER_MAX_ACTIVE?: string;
  TURN_TIMEOUT_MS?: string;
  METRICS_BIND_TOKEN?: string;
  INTERNAL_MODEL_CARD_TOKEN?: string;
  LOG_LEVEL?: string;
  NODE_ENV?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_AUTO_INSTRUMENTATIONS?: string;
}
