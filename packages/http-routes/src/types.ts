// Bundle of services and lifecycle hooks handed to every mount factory.
// Each runtime (CF / Node) constructs its own bundle and passes it in.
// New routes get all of these via `services` — no implicit env / fetch
// access leaks into route code.
//
// `services` accepts either a fixed `RouteServices` (Node — services bundle
// is built once at process start) or a `(c) => RouteServices` callback
// (CF — services are per-request because of multi-user DB resolution).

import type { Context } from "hono";
import type { AgentService } from "@open-managed-agents/agents-store";
import type { SessionService } from "@open-managed-agents/sessions-store";
import type { SqlClient } from "@open-managed-agents/sql-client";
import type { KvStore } from "@open-managed-agents/kv-store";
import type {
  Logger,
  MetricsRecorder,
  Tracer,
} from "@open-managed-agents/observability";

export interface BackgroundRunner {
  /** Fire-and-forget on Node (with logged error handler), waitUntil on CF. */
  run(p: Promise<unknown>): void;
}

/** Per-session event log + SSE fanout — handed to session routes so they
 *  can append + publish without knowing the backend. CF wraps the DO's
 *  storage; Node wraps SqlEventLog + InProcess/PgEventStreamHub. */
export interface EventStreamHub {
  publish(sessionId: string, event: unknown): void;
  /** Subscribe to live events for sessionId. Return an unsubscribe. The
   *  writer is invoked once per event in seq order. The `closed` flag
   *  is set by the hub to mark dropped writers; SSE handlers should
   *  set it themselves on transport error so the next publish skips. */
  attach(
    sessionId: string,
    writer: { closed: boolean; write(ev: unknown): void; close(): void },
  ): () => void;
}

export interface SessionRegistryLike {
  /** Route an inbound user.message to the harness for this session. */
  enqueueUserMessage?(sessionId: string, userId: string, agentId: string, ev: unknown): void;
  /** Trigger user.interrupt — abort the in-flight harness AbortController. */
  interrupt?(sessionId: string): void;
}

/**
 * Subset of services HTTP routes care about. Runtime-agnostic intentionally —
 * no driver-specific database or storage types leak here. Optional fields use
 * `null` rather than absent so `if (services.x)` always works.
 */
export interface RouteServices {
  sql: SqlClient;
  agents: AgentService;
  sessions: SessionService;
  kv: KvStore;
  /** Node may create a user-scoped SQL KV adapter per request. Legacy
   * fixtures can omit this and continue using the fixed `kv` instance. */
  kvForUser?: (userId: string) => KvStore;
  /** Per-session event log writer. Bound to a sessionId at the call site. */
  newEventLog: (sessionId: string) => {
    appendAsync(ev: unknown): Promise<void>;
    getEventsAsync(afterSeq?: number): Promise<unknown[]>;
  };
  hub: EventStreamHub;
  sessionRegistry?: SessionRegistryLike;
  background: BackgroundRunner;
  /** Outputs root for /v1/sessions/:id/outputs[/:filename]. Null disables
   *  the routes (CF returns from R2 via blobStore instead — wire it via
   *  outputsBlob). */
  outputsRoot?: string | null;
  /** Structured logger. Routes pull `services.logger.child({...})` to
   *  get a per-request handle; bootstrap-time top-level logger is fine
   *  for handlers that don't need extra binding. Optional so legacy
   *  test fixtures that build an ad-hoc RouteServices still compile. */
  logger?: Logger;
  /** Counter / histogram / gauge / event recorder. Optional for the
   *  same reason — middleware/route code falls back to a noop when
   *  unset. */
  metrics?: MetricsRecorder;
  /** OTel-flavored span source. Optional; CF wires a noop, Node wires
   *  the real OTel SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set. */
  tracer?: Tracer;
}

/** Per-request services accessor. The Node server passes a callback that resolves
 *  RouteServices off `c.var.services` + `c.var.userDb`; Node passes a
 *  static bundle that the helper turns into a no-arg thunk. Use
 *  `resolveServices` in handlers, never read `deps.services` directly. */
export type RouteServicesArg = RouteServices | ((c: Context) => RouteServices);

export function resolveServices(
  arg: RouteServicesArg,
  c: Context,
): RouteServices {
  return typeof arg === "function" ? arg(c) : arg;
}

/** Resolve the KV namespace for an authenticated user. The fallback keeps
 * old route fixtures working while Node moves away from a process-global
 * `default` user adapter. */
export function resolveUserKv(
  services: Pick<RouteServices, "kv" | "kvForUser">,
  userId: string,
): KvStore {
  return services.kvForUser?.(userId) ?? services.kv;
}
