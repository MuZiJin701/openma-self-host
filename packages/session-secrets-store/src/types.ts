// Public types for the session-secrets store. Intentionally tiny: this store
// just shuttles opaque per-session environment values between the create-
// resource HTTP path and the session runtime at warmup.
// warmup. No structured row, no metadata, no parsing.

/**
 * The raw secret payload bytes — `env.value` (a raw env var value, was
 * `env_secret.value` before the rename). Adapters store and return it as-is;
 * the storage layer never
 * inspects or transforms the value.
 */
export type SecretValue = string;
