// فهرس المحوّلات — الوصول الموحد حسب المزود
import type { ProviderId } from "@/lib/models";
import type { ProviderAdapter } from "./types";
import { kieAdapter } from "./kie";
import { cometApiAdapter } from "./cometapi";

const adapters: Record<ProviderId, ProviderAdapter> = {
  kie: kieAdapter,
  cometapi: cometApiAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return adapters[provider];
}

export * from "./types";
