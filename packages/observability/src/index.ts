// Logger, metrics and tracing used by the Node self-host.

export type {
  Logger,
  LogBindings,
  LogLevel,
  LoggerSpec,
  MetricsRecorder,
  Tracer,
  Span,
  SpanAttributes,
  SpanOptions,
  RecordableEvent,
} from "./types";

export {
  NoopLogger,
  NoopMetricsRecorder,
  NoopTracer,
  getLogger,
  setRootLogger,
} from "./root";

export { errFields } from "./errors";

export { requestMetrics, tracerMiddleware } from "./middleware";
export type { RequestMetricsOptions, TracerMiddlewareOptions } from "./middleware";
