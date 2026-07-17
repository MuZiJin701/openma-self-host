// Blob store port for the Node self-host. Production uses the local
// filesystem; the in-memory adapter is retained for tests and development.

/**
 * What can be PUT to a blob.
 *  - string: text content (UTF-8)
 *  - ArrayBuffer / ArrayBufferView: raw binary
 *  - ReadableStream<Uint8Array>: streaming upload
 */
export type BlobBody =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>;

/**
 * Per-blob HTTP-level metadata that survives across PUT/GET.
 */
export interface BlobHttpMetadata {
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
}

export interface BlobMetadata {
  /** Storage etag used as a CAS primitive. */
  etag: string;
  /** Object size in bytes. */
  size: number;
  httpMetadata?: BlobHttpMetadata;
  customMetadata?: Record<string, string>;
}

/**
 * GET result. Body is the canonical access — helpers mirror Response/R2Object
 * for ergonomics. Reading body twice throws (single-consumption stream).
 */
export interface BlobObject extends BlobMetadata {
  /** Stream the object body. Single consumption. */
  body: ReadableStream<Uint8Array>;
  /** Convenience: drain body and decode as UTF-8. */
  text(): Promise<string>;
  /** Convenience: drain body into ArrayBuffer. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Convenience: drain body into Uint8Array. */
  bytes(): Promise<Uint8Array>;
}

/**
 * Conditional PUT semantics for create-only and compare-and-swap writes.
 *  - ifNoneMatch "*": create-only (PUT only if no object exists at key)
 *  - ifMatch <etag>: CAS (PUT only if existing object's etag matches)
 *
 * On failure, `put()` returns `null` (not an error).
 */
export type BlobPrecondition =
  | { type: "ifNoneMatch"; value: "*" }
  | { type: "ifMatch"; etag: string };

export interface BlobPutOptions {
  httpMetadata?: BlobHttpMetadata;
  customMetadata?: Record<string, string>;
  precondition?: BlobPrecondition;
}

/**
 * The port. Implementations:
 *   - LocalFsBlobStore — production self-host storage
 *   - InMemoryBlobStore — tests and development
 */
export interface BlobStore {
  /** HEAD an object — returns metadata or null if not found. */
  head(key: string): Promise<BlobMetadata | null>;

  /** GET an object — returns body+metadata or null if not found. */
  get(key: string): Promise<BlobObject | null>;

  /**
   * PUT an object. Returns the new metadata on success, null when a
   * precondition fails. Throws on transport / 5xx errors.
   */
  put(
    key: string,
    body: BlobBody,
    opts?: BlobPutOptions,
  ): Promise<BlobMetadata | null>;

  /** DELETE an object. Idempotent — no-op if missing. */
  delete(key: string): Promise<void>;
}
