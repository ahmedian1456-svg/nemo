// واجهة موحدة لمحوّلات المزودين — كل خطأ يُرمى كـ ProviderError ليُصنَّف لاحقًا
import type { ProviderId } from "@/lib/models";
import { ProviderError } from "@/lib/errors";

export interface KeyRef {
  id: string;
  provider: ProviderId;
  label: string;
  apiKey: string;
}

export interface CreateTaskResult {
  providerTaskId: string;
}

export interface CheckResult {
  status: "processing" | "completed" | "failed";
  urls?: string[];
  error?: string;
  progress?: number; // 0..100
}

export interface ProviderAdapter {
  /** مهمة غير متزامنة (فيديو وبعض الصور): تعيد معرّف المهمة لدى المزود */
  createTask(key: KeyRef, providerModel: string, input: Record<string, unknown>): Promise<CreateTaskResult>;
  /** صور متزامنة إن كان المزود يدعمها (CometAPI تعيد النتيجة فورًا) */
  createImageSync?(key: KeyRef, providerModel: string, input: Record<string, unknown>): Promise<{ urls: string[] }>;
  /** استعلام حالة مهمة جارية */
  checkTask(key: KeyRef, providerTaskId: string): Promise<CheckResult>;
}

export { ProviderError };

/** fetch مع مهلة افتراضية ورمي ProviderError عند فشل HTTP */
export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ status: number; body: unknown }> {
  const { timeoutMs = 60_000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  } catch (e) {
    // أخطاء الشبكة/المهلة تُرمى كما هي — المصنّف يعاملها temporary
    if (e instanceof Error && e.name === "AbortError") {
      throw new ProviderError(undefined, `timeout: الطلب تجاوز ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** استخراج رسالة خطأ من جسم JSON متغير الشكل */
export function extractErrorMessage(body: unknown, fallback = "خطأ غير معروف من المزود"): string {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  for (const k of ["error", "message", "msg", "failMsg", "detail"]) {
    const v = b[k];
    if (typeof v === "string" && v) return v;
    if (v && typeof v === "object") {
      const nested = v as Record<string, unknown>;
      if (typeof nested.message === "string" && nested.message) return nested.message;
    }
  }
  if (typeof b.raw === "string" && b.raw) return b.raw.slice(0, 300);
  return fallback;
}

export function asStringArray(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && !!x);
  return [];
}
