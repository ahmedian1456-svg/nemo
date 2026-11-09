// تصنيف موحد لأخطاء المزودين — قلب نظام التبديل التسلسلي بين المفاتيح
// القاعدة الذهبية: أخطاء المفتاح/الرصيد لا تُمرَّر للعميل أبدًا.

export type ErrorClass =
  | "disabled" // مفتاح غير صالح → يُعطَّل تلقائيًا وينتقل للتالي
  | "exhausted" // نفاد رصيد → يُعلَّم وينتقل للتالي (يبقى في القاعدة)
  | "provider" // الموديل غير مدعوم لدى هذا المزود → ينتقل للتالي
  | "params" // معطيات الطلب خاطئة → توقف فورًا (تبديل المفاتيح لن يحلها)
  | "temporary"; // 429/5xx/شبكة → ينتقل للتالي والمفتاح يبقى سليمًا

/** خطأ يرميه أي محوّل مزود مع حالة HTTP إن وُجدت */
export class ProviderError extends Error {
  status?: number;
  constructor(status: number | undefined, message: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

// أنماط رسائل نفاد الرصيد (تُفحص قبل 400 لأن بعض المزودين يرسلون النفاد بحالة 400)
const EXHAUSTED_RE =
  /insufficient|quota|balance|credit|out of credits|exhausted|充值/i;
// أنماط رسائل المفتاح المرفوض
const AUTH_RE = /invalid api key|unauthorized|forbidden|authentication|api key not valid|incorrect api key/i;
// أنماط الموديل غير المدعوم
const MODEL_RE = /model not found|unsupported model|unknown model|model does not exist|no such model|not found for this endpoint/i;
// أنماط فشل مهمة جارية بسبب مفتاح/رصيد (تُفحص عند فشل المزود للمهمة في منتصفها)
export const KEY_FAIL_RE =
  /insufficient|balance|credit|quota|402|401|unauthorized|exhausted|充值|invalid api key|forbidden|authentication/i;

/** هل رسالة الفشل تشير لمشكلة مفتاح/رصيد؟ (للتمييز بين الفشل الحقيقي والقابل للاستئناف) */
export function isKeyishFailure(message: string): boolean {
  return KEY_FAIL_RE.test(message ?? "");
}

function isNetworkish(message: string): boolean {
  return /fetch failed|network|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|aborted|abort/i.test(
    message ?? ""
  );
}

/**
 * تصنيف خطأ المزود حسب جدول القواعد:
 * 1) 429 أو 5xx → temporary (قبل فحص الرسائل حتى لا يُعلَّم مفتاح سليم بسبب "quota exceeded" في 429)
 * 2) 402 → exhausted
 * 3) 401/403 → disabled
 * 4) رسالة نفاد رصيد (مهما كانت الحالة، تشمل 400) → exhausted
 * 5) رسالة مصادقة → disabled
 * 6) رسالة موديل غير مدعوم مع 400/404/422 → provider
 * 7) 400/422 → params
 * 8) انقطاع شبكة/مهلة → temporary
 */
export function classifyProviderError(err: unknown): {
  cls: ErrorClass;
  status?: number;
  message: string;
} {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err ?? "خطأ غير معروف");
  const status =
    err instanceof ProviderError ? err.status : undefined;

  if (status === 429 || (status !== undefined && status >= 500)) {
    return { cls: "temporary", status, message };
  }
  if (status === 402) return { cls: "exhausted", status, message };
  if (status === 401 || status === 403) return { cls: "disabled", status, message };

  if (EXHAUSTED_RE.test(message)) return { cls: "exhausted", status, message };
  if (AUTH_RE.test(message)) return { cls: "disabled", status, message };
  if (MODEL_RE.test(message) && (status === 400 || status === 404 || status === 422 || status === undefined)) {
    return { cls: "provider", status, message };
  }
  if (status === 400 || status === 422) return { cls: "params", status, message };
  if (status === undefined && isNetworkish(message)) {
    return { cls: "temporary", status, message };
  }
  // أي شيء آخر يُعامل مؤقتًا: لا نوقف المهمة بسبب مجهول
  return { cls: "temporary", status, message };
}

/** رسائل عربية آمنة للعميل حسب الفئة — لا تذكر المفاتيح أو الرصيد مطلقًا */
export function clientSafeMessage(cls: ErrorClass, raw?: string): string {
  switch (cls) {
    case "params":
      return `معطيات الطلب غير مقبولة: ${truncate(raw ?? "غير معروف", 200)}`;
    case "provider":
      return "الموديل المطلوب غير مدعوم لدى المزودين المتاحين حاليًا.";
    case "exhausted":
    case "disabled":
      return "تعذر إكمال التوليد في هذه اللحظة، تُجرَّب المحاولة تلقائيًا."; // لا تُعرض للعميل عادة
    case "temporary":
    default:
      return "حدث خطأ مؤقت لدى المزود، تُجرَّب المحاولة تلقائيًا.";
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
