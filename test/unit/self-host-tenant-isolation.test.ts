import { describe, expect, it } from "vitest";
import { InMemoryKvStore } from "../../packages/kv-store/src/adapters/in-memory";
import {
  resolveTenantKv,
  type RouteServices,
} from "../../packages/http-routes/src/types";

describe("self-host tenant-scoped route services", () => {
  it("uses the request tenant KV factory instead of the default KV", async () => {
    const defaultKv = new InMemoryKvStore();
    const tenantKvs = new Map<string, InMemoryKvStore>();
    const services = {
      kv: defaultKv,
      kvForTenant: (tenantId: string) => {
        let kv = tenantKvs.get(tenantId);
        if (!kv) {
          kv = new InMemoryKvStore();
          tenantKvs.set(tenantId, kv);
        }
        return kv;
      },
    } as Pick<RouteServices, "kv" | "kvForTenant">;

    const tenantKv = resolveTenantKv(services, "tenant-a");
    await tenantKv.put("secret", "a");

    expect(await resolveTenantKv(services, "tenant-a").get("secret")).toBe("a");
    expect(await resolveTenantKv(services, "tenant-b").get("secret")).toBeNull();
    expect(await defaultKv.get("secret")).toBeNull();
  });

  it("falls back to the fixed KV for legacy test fixtures", async () => {
    const kv = new InMemoryKvStore();
    await kv.put("legacy", "value");

    expect(await resolveTenantKv({ kv }, "tenant-a").get("legacy")).toBe("value");
  });
});
