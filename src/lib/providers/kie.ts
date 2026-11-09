// محوّل kie.ai — Jobs API الموحد (المزود الأساسي)
// createTask: POST https://api.kie.ai/api/v1/jobs/createTask
// recordInfo: GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
// انتبه: resultJson نص JSON داخل JSON يحتاج JSON.parse ثانيًا.
import { ProviderError, type ProviderAdapter, type CheckResult, fetchJson, extractErrorMessage, asStringArray } from "./types";

const BASE = process.env.KIE_API_BASE ?? "https://api.kie.ai";

interface KieResponse {
  code?: number;
  msg?: string;
  data?: Record<string, unknown>;
}

function assertKieOk(status: number, body: KieResponse): void {
  // kie يعيد code=200 في الجسم عند النجاح؛ أي خلاف ذلك خطأ
  if (status >= 400 || (body.code !== undefined && body.code !== 200)) {
    const effStatus =
      typeof body.code === "number" && body.code !== 200 ? (body.code >= 400 || body.code < 500 ? body.code : status) : status;
    throw new ProviderError(effStatus || status, extractErrorMessage(body, body.msg ?? `kie.ai HTTP ${status}`));
  }
}

export const kieAdapter: ProviderAdapter = {
  async createTask(key, providerModel, input) {
    const { status, body } = await fetchJson(`${BASE}/api/v1/jobs/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: providerModel, input }),
    });
    assertKieOk(status, body as KieResponse);
    const data = (body as KieResponse).data ?? {};
    const taskId = data.taskId;
    if (typeof taskId !== "string" || !taskId) {
      throw new ProviderError(status, "لم يُعد kie.ai معرّف مهمة صالحًا");
    }
    return { providerTaskId: taskId };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    const { status, body } = await fetchJson(
      `${BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${key.apiKey}` },
        timeoutMs: 30_000,
      }
    );
    assertKieOk(status, body as KieResponse);
    const data = ((body as KieResponse).data ?? {}) as Record<string, unknown>;
    const state = String(data.state ?? "").toLowerCase();

    // انتظار/طابور/توليد → processing مع تقدير تقدم تقريبي
    if (state === "waiting") return { status: "processing", progress: 5 };
    if (state === "queuing") return { status: "processing", progress: 15 };
    if (state === "generating") return { status: "processing", progress: 60 };

    if (state === "success") {
      // resultJson نص JSON داخل JSON: {"resultUrls":["https://..."]}
      let urls: string[] = [];
      const rj = data.resultJson;
      if (typeof rj === "string" && rj) {
        try {
          const parsed = JSON.parse(rj) as Record<string, unknown>;
          urls = asStringArray(parsed.resultUrls);
          if (!urls.length) urls = asStringArray(parsed.urls);
          if (!urls.length && typeof parsed.url === "string") urls = [parsed.url];
        } catch {
          // نتبع الشكل الموثق فقط — لا نخترع حقولًا
        }
      } else if (rj && typeof rj === "object") {
        const parsed = rj as Record<string, unknown>;
        urls = asStringArray(parsed.resultUrls);
      }
      return { status: "completed", urls };
    }

    if (state === "fail" || state === "failed") {
      return {
        status: "failed",
        error: String(data.failMsg ?? "فشل التوليد لدى kie.ai"),
      };
    }

    // حالة غير معروفة → نعاملها كمعالجة جارية حتى تنتهي نافذة الانتظار
    return { status: "processing", progress: 30 };
  },
};
