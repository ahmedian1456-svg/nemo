// محوّل CometAPI — مزود ثانٍ متوافق مع OpenAI
// الصور: POST {base}/v1/images/generations (متزامن — يعيد الرابط فورًا)
// الفيديو: POST {base}/v1/videos ثم GET {base}/v1/videos/{task_id} (غير متزامن)
// ملاحظة: اتبع توثيق api.cometapi.com الحالي عند تغيّر الأشكال.
import { ProviderError, type ProviderAdapter, type CheckResult, fetchJson, extractErrorMessage, asStringArray } from "./types";

const BASE = process.env.COMETAPI_API_BASE ?? "https://api.cometapi.com";

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function assertHttpOk(status: number, body: unknown): void {
  if (status >= 400) {
    throw new ProviderError(status, extractErrorMessage(body, `CometAPI HTTP ${status}`));
  }
}

export const cometApiAdapter: ProviderAdapter = {
  async createImageSync(key, providerModel, input) {
    const prompt = String(input.prompt ?? "");
    const body: Record<string, unknown> = {
      model: providerModel,
      prompt,
      n: 1,
      response_format: "url", // نفضّل رابطًا — لا ننزّل أي وسائط على سيرفرنا
    };
    // تحويل تقريبي للدقة إلى مقاسات OpenAI-المتوافقة
    const resolution = String(input.resolution ?? "1K");
    if (resolution === "4K") body.size = "4096x4096";
    else if (resolution === "2K") body.size = "2048x2048";
    else body.size = "1024x1024";
    if (input.background === "transparent") body.background = "transparent";
    if (typeof input.output_format === "string") body.output_format = input.output_format;

    const { status, body: resBody } = await fetchJson(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: authHeaders(key.apiKey),
      body: JSON.stringify(body),
      timeoutMs: 120_000, // التوليد المتزامن قد يستغرق وقتًا
    });
    assertHttpOk(status, resBody);

    const b = resBody as Record<string, unknown>;
    const dataArr = Array.isArray(b.data) ? (b.data as Record<string, unknown>[]) : [];
    const urls: string[] = [];
    for (const item of dataArr) {
      if (typeof item.url === "string" && item.url) urls.push(item.url);
      else if (typeof item.b64_json === "string" && item.b64_json) {
        // بديل نادر: لا ننزّل شيئًا — نمرر data URI كما هو (يُعرض مباشرة في المتصفح)
        urls.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
    if (!urls.length) {
      // بعض التطبيقات تعيد task_id حتى للصور — نعامله كخطأ مؤقت ليتولى المنسّق التدفق غير المتزامن
      const tid = typeof b.task_id === "string" ? b.task_id : typeof b.id === "string" ? b.id : null;
      if (tid) throw new ProviderError(undefined, `async_image_task:${tid}`);
      throw new ProviderError(status, extractErrorMessage(b, "CometAPI لم يعيد روابط صور"));
    }
    return { urls };
  },

  async createTask(key, providerModel, input) {
    // نقطة المهام غير المتزامنة بنمط create/check الموحد
    const body: Record<string, unknown> = {
      model: providerModel,
      prompt: String(input.prompt ?? ""),
    };
    if (Array.isArray(input.image_urls) && input.image_urls.length) {
      body.image_url = input.image_urls[0];
    }
    if (typeof input.aspect_ratio === "string" && input.aspect_ratio !== "auto") {
      body.aspect_ratio = input.aspect_ratio;
    }
    if (typeof input.resolution === "string") body.resolution = input.resolution;
    if (typeof input.duration === "number") body.duration = input.duration;
    if (typeof input.enable_audio === "boolean") body.enable_audio = input.enable_audio;

    const { status, body: resBody } = await fetchJson(`${BASE}/v1/videos`, {
      method: "POST",
      headers: authHeaders(key.apiKey),
      body: JSON.stringify(body),
    });
    assertHttpOk(status, resBody);

    const b = resBody as Record<string, unknown>;
    const taskId =
      (typeof b.task_id === "string" && b.task_id) ||
      (typeof b.id === "string" && b.id) ||
      ((b.data && typeof (b.data as Record<string, unknown>).task_id === "string")
        ? (b.data as Record<string, unknown>).task_id as string
        : null);
    if (!taskId) throw new ProviderError(status, "CometAPI لم يعيد معرّف مهمة فيديو");
    return { providerTaskId: taskId };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    const { status, body } = await fetchJson(`${BASE}/v1/videos/${encodeURIComponent(providerTaskId)}`, {
      method: "GET",
      headers: authHeaders(key.apiKey),
      timeoutMs: 30_000,
    });
    assertHttpOk(status, body);

    // جسم دفاعي: status قد يكون في الجذر أو داخل data، والروابط بأسماء متعددة
    const b = body as Record<string, unknown>;
    const d = (b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : b) as Record<string, unknown>;
    const st = String(d.status ?? b.status ?? "").toLowerCase();

    const collectUrls = (): string[] => {
      const out = [
        ...asStringArray(d.video_url),
        ...asStringArray(d.videoUrl),
        ...asStringArray(d.url),
        ...asStringArray(d.output),
        ...asStringArray(b.video_url),
        ...asStringArray(b.output),
      ];
      if (typeof d.content === "string" && d.content.startsWith("http")) out.push(d.content);
      return [...new Set(out.filter((u) => /^https?:\/\//.test(u)))];
    };

    if (["completed", "complete", "success", "succeeded", "done", "finished"].includes(st)) {
      return { status: "completed", urls: collectUrls() };
    }
    if (["failed", "fail", "error", "cancelled", "canceled"].includes(st)) {
      return { status: "failed", error: extractErrorMessage(d, extractErrorMessage(b, "فشل التوليد لدى CometAPI")) };
    }
    const rawProgress = Number(d.progress ?? b.progress ?? 0);
    const progress = Number.isFinite(rawProgress) ? (rawProgress <= 1 ? rawProgress * 100 : rawProgress) : undefined;
    return { status: "processing", progress: progress && progress > 5 ? progress : 40 };
  },
};
