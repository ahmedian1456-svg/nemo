// عميل خدمة دمج الفيديو — Video Merger API v2
// بلا مفاتيح أو توثيق. المخرجات: MP4 (H.264 + AAC) حتى 1080p بجودة CRF 18.
// القيود: 10 مقاطع كحد أقصى، 200MB لكل مصدر، 150MB للناتج، 600ث مجموع المدد، حذف تلقائي بعد 24 ساعة.
// لا توجد معاملات resolution/fps — الناتج ثابت.
import { ProviderError, fetchJson, extractErrorMessage } from "@/lib/providers/types";

export function mergerBase(): string {
  return (process.env.MERGER_API_BASE ?? "https://xxxxxxxx").replace(/\/+$/, "");
}

export function mergerConfigured(): boolean {
  const b = mergerBase();
  return /^https?:\/\//.test(b) && !b.includes("xxxxxxxx");
}

export interface MergerJobCreated {
  jobId: string;
  statusUrl?: string;
  expiresAt?: string;
}

export interface MergerStatus {
  status: "queued" | "processing" | "done" | "failed";
  progress: number; // 0..100
  videoUrl?: string;
  downloadUrl?: string;
  /** الرابط النهائي المفضل: videoUrl ثم downloadUrl ثم مبني من jobId */
  resultUrl: string;
  error?: string;
  expiresAt?: string;
  size?: number;
  duration?: number;
  resolution?: string;
}

const DONE_RE = /^(done|completed|complete|success|succeeded|finished)$/i;
const FAIL_RE = /^(error|failed|failure|cancelled|canceled)$/i;

/** تحليل دفاعي لاستجابة الحالة (7.2) */
export function parseMergerStatus(body: unknown, jobId: string): MergerStatus {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawStatus = typeof b.status === "string" ? b.status.trim() : "";
  const rawError = typeof b.error === "string" ? b.error : undefined;

  // انتبه: قد يرد الجسم فيه error بدون حقل status → failed فورًا
  let status: MergerStatus["status"];
  if (DONE_RE.test(rawStatus)) status = "done";
  else if (FAIL_RE.test(rawStatus)) status = "failed";
  else if (!rawStatus && rawError) status = "failed";
  else if (rawStatus === "queued") status = "queued";
  else status = "processing";

  // progress أحيانًا يأتي كسرًا 0..1 → اضربه في 100
  const rawProgress = Number(b.progress ?? 0);
  let progress = Number.isFinite(rawProgress) && rawProgress > 0 ? rawProgress : 0;
  if (progress <= 1) progress *= 100;
  if (status === "done") progress = 100;

  const base = mergerBase();
  // رابط النتيجة: فضّل videoUrl ثم downloadUrl، وإلا اضبطه من jobId
  const videoUrl = typeof b.videoUrl === "string" && b.videoUrl ? b.videoUrl : undefined;
  const downloadUrl = typeof b.downloadUrl === "string" && b.downloadUrl ? b.downloadUrl : undefined;

  return {
    status,
    progress: Math.min(100, Math.round(progress)),
    videoUrl,
    downloadUrl,
    resultUrl: videoUrl ?? downloadUrl ?? `${base}/api/jobs/${jobId}/video`,
    error: rawError,
    expiresAt: typeof b.expiresAt === "string" ? b.expiresAt : undefined,
    size: typeof b.size === "number" ? b.size : undefined,
    duration: typeof b.duration === "number" ? b.duration : undefined,
    resolution: typeof b.resolution === "string" ? b.resolution : undefined,
  };
}

/** POST /api/jobs — إنشاء مهمة دمج */
export async function mergerCreateJob(videos: string[]): Promise<MergerJobCreated> {
  const { status, body } = await fetchJson(`${mergerBase()}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videos }),
    timeoutMs: 30_000,
  });
  if (status >= 400) {
    throw new ProviderError(status, extractErrorMessage(body, `merger HTTP ${status}`));
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const jobId = typeof b.jobId === "string" ? b.jobId : typeof b.id === "string" ? b.id : null;
  if (!jobId) throw new ProviderError(status, "خدمة الدمج لم تعيد jobId");
  return {
    jobId,
    statusUrl: typeof b.statusUrl === "string" ? b.statusUrl : undefined,
    expiresAt: typeof b.expiresAt === "string" ? b.expiresAt : undefined,
  };
}

/** POST /api/jobs/{id}/process — يستغرق ~10–15 ثانية (blocking)، يُستدعى مرة واحدة فقط */
export async function mergerProcess(jobId: string): Promise<{ done: boolean; result?: MergerStatus; error?: string }> {
  try {
    const { status, body } = await fetchJson(`${mergerBase()}/api/jobs/${encodeURIComponent(jobId)}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      timeoutMs: 120_000,
    });
    if (status >= 400) {
      // فشل حتمي: مصدر يرفض التحميل مثلًا — تكرار المحاولة يعطي النتيجة نفسها
      return { done: false, error: extractErrorMessage(body, `merger process HTTP ${status}`) };
    }
    return { done: true, result: parseMergerStatus(body, jobId) };
  } catch (e) {
    // خطأ شبكتنا نحن (timeout/fetch) → مؤقت؛ قد تكون الخدمة أنهت المعالجة فعلًا
    return { done: false, error: e instanceof Error ? e.message : String(e), result: undefined };
  }
}

/** GET /api/jobs/{id} — استعلام حالة */
export async function mergerGetJob(jobId: string): Promise<{ ok: boolean; notFound?: boolean; status?: MergerStatus; error?: string }> {
  try {
    const { status, body } = await fetchJson(`${mergerBase()}/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      timeoutMs: 20_000,
    });
    if (status === 404) return { ok: false, notFound: true };
    if (status >= 400) return { ok: false, error: extractErrorMessage(body, `merger HTTP ${status}`) };
    return { ok: true, status: parseMergerStatus(body, jobId) };
  } catch (e) {
    // خطأ شبكتنا — مؤقت، استمر بالاستعلام
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** DELETE /api/jobs/{id} — تنظيف اختياري */
export async function mergerDeleteJob(jobId: string): Promise<void> {
  try {
    await fetchJson(`${mergerBase()}/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", timeoutMs: 15_000 });
  } catch {
    // التنظيف اختياري — تجاهل الأخطاء
  }
}

/** GET /api/config — حدود الخدمة (لفحص الجهوزية) */
export async function mergerConfig(): Promise<Record<string, unknown> | null> {
  try {
    const { status, body } = await fetchJson(`${mergerBase()}/api/config`, { method: "GET", timeoutMs: 8_000 });
    return status < 400 && body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
