/**
 * Minimal declarations for optional provider adapters retained for source
 * compatibility. The self-host runtime does not load a Cloudflare Worker.
 */
type KVNamespace = {
  get(...args: any[]): Promise<any>;
  put(...args: any[]): Promise<void>;
  delete(...args: any[]): Promise<void>;
  list(...args: any[]): Promise<any>;
};
type D1Database = any;
type D1PreparedStatement = {
  bind(...args: any[]): D1PreparedStatement;
  all<T = unknown>(): Promise<T>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<any>;
};
type SendEmail = any;
type DurableObjectNamespace = any;
type R2Bucket = any;
type R2PutOptions = Record<string, unknown>;
type R2HTTPMetadata = Record<string, unknown>;
type R2Object = any;
type R2ObjectBody = any;
type Queue<T = unknown> = any;
type Fetcher = any;
type Ai = any;
type AnalyticsEngineDataset = any;
type RateLimit = any;
type SqlStorage = any;
type RequestInfo = string | URL | Request;
