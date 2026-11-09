// سجل الموديلات — الوحيد المسموح للاستدعاء من عملاء MCP
// الصيغ البديلة بالنقاط تُوحَّد (gpt-image-2.6/... → gpt-image-2-6/...)
// الأسماء قابلة للتجاوز بمتغيرات البيئة.

export type ProviderId = "kie" | "cometapi";
export type TaskProviderId = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string; // الاسم كما يراه عميل MCP
  aliases: string[]; // صيغ بديلة نقبلها ونوحدّها
  type: MediaType;
  providers: ProviderId[]; // من يستطيع خدمته — تُجرَّب مفاتيحهم كلها بالترتيب
  providerModel: Record<ProviderId, string>; // اسم الموديل كما يُرسل لكل مزود
}

const KIE_IMAGE_MODEL =
  process.env.KIE_IMAGE_MODEL ?? "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO_MODEL =
  process.env.KIE_VIDEO_MODEL ?? "grok-imagine-video-1-5-preview";
const COMETAPI_IMAGE_MODEL =
  process.env.COMETAPI_IMAGE_MODEL ?? "gpt-image-2.6-flare-text-to-image";
const COMETAPI_VIDEO_MODEL =
  process.env.COMETAPI_VIDEO_MODEL ?? "grok-imagine-video-1-5-preview";

export const MODELS: ModelDef[] = [
  {
    canonical: "gpt-image-2-6/flare-text-to-image",
    aliases: ["gpt-image-2.6/flare-text-to-image", "gpt-image-2-6-flare-text-to-image"],
    type: "image",
    providers: ["kie", "cometapi"],
    providerModel: {
      kie: KIE_IMAGE_MODEL,
      cometapi: COMETAPI_IMAGE_MODEL,
    },
  },
  {
    canonical: "grok-imagine-video-1-5-preview",
    aliases: ["grok-imagine-video-1.5-preview"],
    type: "video",
    providers: ["kie", "cometapi"],
    providerModel: {
      kie: KIE_VIDEO_MODEL,
      cometapi: COMETAPI_VIDEO_MODEL,
    },
  },
];

/** توحيد الاسم: تقليم + تحويل لحروف صغيرة + تحويل النقاط داخل أرقام الإصدار إلى شرطات */
export function normalizeModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, "$1-$2"); // 2.6 → 2-6 و 1.5 → 1-5
}

/** البحث عن موديل بالاسم الأصلي أو الصيغ البديلة */
export function findModel(name: string): ModelDef | null {
  if (!name) return null;
  const exact = name.trim().toLowerCase();
  for (const m of MODELS) {
    if (m.canonical === exact || m.aliases.includes(exact)) return m;
  }
  const norm = normalizeModelName(exact);
  for (const m of MODELS) {
    if (normalizeModelName(m.canonical) === norm) return m;
    if (m.aliases.some((a) => normalizeModelName(a) === norm)) return m;
  }
  return null;
}

/** أسماء الموديلات المعروضة في الأداة (canonical + aliases) */
export function modelEnumValues(): string[] {
  return MODELS.flatMap((m) => [m.canonical, ...m.aliases]);
}
