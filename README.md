# 🎨 MCP Media Generator — خادم MCP لتوليد الوسائط + لوحة إدارة عربية

خادم **MCP** (Model Context Protocol) يجمع ثلاث قدرات في أداة واحدة عبر نقل **Streamable HTTP**:

1. **توليد صور** من وصف نصي — الموديل المدمج: `gpt-image-2-6/flare-text-to-image`
2. **توليد فيديو بصوت متزامن أصلي** (حوار/مؤثرات/موسيقى) — الموديل المدمج: `grok-imagine-video-1-5-preview`
3. **دمج عدة مقاطع فيديو** في مقطع واحد عالي الجودة وبالترتيب المطلوب (MP4 — H.264 + AAC — حتى 1080p)

مع **واجهة ويب عربية RTL** لإدارة مفاتيح API ومتابعة المهام حيًا وإعدادات الربط الجاهزة للنسخ.

> يعمل مع أي عميل MCP: ChatGPT Connectors · Claude Desktop/Web · Cursor · Windsurf · Cline · GPT Agents SDK

---

## ⭐ القواعد الجوهرية

| القاعدة | التنفيذ |
|---|---|
| **لا تُنزَّل أي وسائط على السيرفر** | نرسل الروابط للمزودين ونخزّن **روابط النتائج فقط** في Turso |
| **ترتيب تسلسلي صارم للمفاتيح** | أول مفتاح أُضيف يُجرَّب أولًا (`ORDER BY created_at ASC`) — ليس round-robin |
| **تبديل تلقائي فوري بلا توقف** | نفس المهمة بنفس `task_id` تُستأنف على المفتاح التالي — العميل لا يرى شيئًا |
| **العميل لا يرى أخطاء المفاتيح/الرصيد أبدًا** | تصنيف الأخطاء + تعقيم كل الرسائل الخارجة |
| **المهمة لا تُفشل لمجرد نفاد المفاتيح** | تبقى `processing` وتُعاد تلقائيًا مع كل `get_task` (تهدئة 45 ثانية) |

---

## 🧱 التقنيات

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**
- **`@modelcontextprotocol/sdk`** — `McpServer` + `StreamableHTTPServerTransport` الرسميان (وضع عديم الجلسة المناسب لـ serverless)
- **`@libsql/client`** مع قاعدة **Turso** عبر HTTP — بلا ملفات SQLite محلية
- كل الـ route handlers بـ `runtime = "nodejs"`، و`/mcp` و`/api/health` بـ `dynamic = "force-dynamic"`

## 📁 البنية

```
src/
├─ app/
│  ├─ mcp/route.ts          ← خادم MCP (POST/GET/DELETE/OPTIONS + حماية Bearer اختيارية)
│  ├─ api/
│  │  ├─ keys/route.ts      ← GET (مفاتيح مقنّعة) · POST (إضافة + رفض التكرار)
│  │  ├─ keys/[id]/route.ts ← PATCH (تعطيل/تنشيط) · DELETE
│  │  ├─ tasks/route.ts     ← أحدث المهام (للوحة الحية)
│  │  ├─ stats/route.ts     ← إحصاءات + جهوزية
│  │  └─ health/route.ts    ← فحص صحة (DB/مفاتيح/دمج/حماية)
│  ├─ page.tsx              ← لوحة الإدارة (الصفحة الوحيدة)
│  └─ layout.tsx            ← عربي RTL + خط Cairo
├─ components/              ← اللوحة: dashboard · keys-panel · tasks-panel · connect-panel
└─ lib/
   ├─ turso.ts              ← المخطط (CREATE TABLE IF NOT EXISTS) + عمليات المهام والمفاتيح
   ├─ errors.ts             ← تصنيف الأخطاء الموحد (disabled/exhausted/provider/params/temporary)
   ├─ models.ts             ← سجل الموديلات + توحيد الصيغ البديلة (نقاط↔شرطات)
   ├─ providers/            ← محوّلات المزودين: kie.ts · cometapi.ts
   ├─ generation.ts         ← runGeneration + refreshTask (التبديل التسلسلي)
   ├─ merge.ts              ← runMerge + refreshMergeTask (process مرة واحدة فقط)
   ├─ merger.ts             ← عميل Video Merger API v2 (تحليل دفاعي للحالة)
   └─ format.ts             ← صياغة عربية + maskKey + تعقيم الرسائل
```

---

## 🔑 الأدوات الخمس على `/mcp`

| الأداة | الوظيفة |
|---|---|
| `generate_image` | توليد صورة — تعيد الرابط جاهزًا إن اكتملت خلال نافذة الانتظار وإلا `task_id` |
| `generate_video` | توليد فيديو بصوت متزامن (+ image-to-video اختياري) — `task_id` والمتابعة بـ `get_task` |
| `merge_videos` | دمج 2–10 مقاطع بترتيبها عبر `urls` مباشرة أو `task_ids` لمهام مكتملة |
| `get_task` | تتبع أي مهمة (توليد أو دمج) — يحدّث حيًا من المزود |
| `list_media` | أحدث الوسائط المخزنة بروابطها (للاستذكار أو الدمج اللاحق) |

نتائج الاستدعاء تُصاغ **بالعربية** مع روابط النتائج و`task_id`.

## 🛡️ تصنيف الأخطاء والتبديل

| الفئة | الشرط | الإجراء |
|---|---|---|
| `disabled` | HTTP 401/403 أو رسالة مصادقة | تعطيل المفتاح تلقائيًا → المفتاح التالي |
| `exhausted` | HTTP 402 أو رسالة نفاد رصيد (تُفحص **قبل** 400) | تعليم المفتاح مستنزفًا (يبقى في القاعدة) → التالي |
| `provider` | `model not found` مع 400/404/422 | الانتقال للمزود/المفتاح التالي |
| `params` | 400/422 | **توقف فورًا** — تبديل المفاتيح لن يحل خطأ معطيات |
| `temporary` | 429، 5xx، شبكة، timeout | الانتقال للتالي والمفتاح يبقى سليمًا |

فشل في منتصف المهمة برسالة تطابق مشكلات مفتاح/رصيد → إعادة إنشاء **نفس المهمة بنفس `task_id`** على المفتاح التالي تلقائيًا.

---

## 🚀 التشغيل محليًا

```bash
bun install                       # أو npm install / pnpm install
cp .env.example .env.local        # ثم املأ TURSO_DATABASE_URL و TURSO_AUTH_TOKEN
bun run seed                      # (اختياري) إدخال أول مفتاح kie تلقائيًا: KIE_SEED_KEY=...
bun run dev                       # http://localhost:3000
```

افتح اللوحة على `/` وأضف مفاتيحك من قسم **المفاتيح**، أو أضفها من قاعدة Turso مباشرة.

## ▲ النشر على Vercel

1. ارفع المستودع إلى GitHub (أو استخدم هذا المستودع مباشرة)
2. Vercel → **Add New → Project** → اختر المستودع (Framework: Next.js يُكتشف تلقائيًا)
3. أضف **Environment Variables** (للبيئتين Production وPreview):
   - `TURSO_DATABASE_URL` — `libsql://...`
   - `TURSO_AUTH_TOKEN` — التوكن
   - `MERGER_API_BASE` — عنوان خدمة الدمج (اختياري، يُفعّل `merge_videos`)
   - `MCP_ACCESS_TOKEN` — اختياري لحماية `/mcp`
4. **Deploy** — بعد الاكتمال افتح `https://<مشروعك>.vercel.app` للوحة، وعنوان الربط هو `https://<مشروعك>.vercel.app/mcp`

> ملاحظة: دالة `/mcp` مضبوطة على `maxDuration = 300` ثانية لاستيعاب نوافذ الانتظار — تعمل على الخطط الحديثة (Fluid compute). إن كانت خطتك أقدم فخفّض القيمة في `src/app/mcp/route.ts`.

## 🔌 الربط من أي عميل

| العميل | الخطوات |
|---|---|
| **ChatGPT** | Settings ← Connectors ← Create ← MCP Server URL = `https://<host>/mcp` |
| **Claude** | Settings ← Connectors ← Add custom connector ← العنوان (Remote MCP) |
| **Cursor / Windsurf / Cline** | mcp.json: `{ "mcpServers": { "media-generator": { "url": "https://<host>/mcp" } } }` |

لو فعّلت `MCP_ACCESS_TOKEN` أرفق الترويسة `Authorization: Bearer <token>` حيث يدعم العميل ذلك.

## 🧪 اختبار سريع

```bash
curl -s https://<host>/api/health
curl -s -X POST https://<host>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## 🗄️ قاعدة البيانات (Turso)

جدولان فقط — يُنشآن تلقائيًا عند أول وصول بلا أدوات migrations:

- **tasks** — المهام: الحالة، التقدم، الروابط، سجل المحاولات (`attempts_json`)، المعطيات الأصلية (`params_json`) لإعادة الإنشاء عند التبديل
- **api_keys** — المفاتيح: الحالة (active/exhausted/disabled)، العدّادات (usage/success/fail)، آخر خطأ

القيد الأهم في القراءة: `WHERE status != 'disabled' ORDER BY created_at ASC, id ASC` — هذا هو **الترتيب التسلسلي الصارم**.

## 🎞️ خدمة الدمج (Video Merger API v2)

- بلا مفاتيح — العنوان من `MERGER_API_BASE`
- الحدود: **10 مقاطع** كحد أقصى · 200MB لكل مصدر · 150MB للناتج · 600 ثانية مجموع المدد · **حذف تلقائي بعد 24 ساعة**
- لا معاملات resolution/fps — الناتج ثابت (MP4, H.264+AAC, ≤1080p, CRF 18)
- أي خطأ HTTP معلن من الخدمة = **فشل نهائي فوري**؛ أخطاء شبكتنا = مؤقتة ويستمر الاستعلام حتى انتهاء النافذة
- أثناء انتهاء صلاحية مهمة (404): «مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)»

## 🔐 ملاحظات أمان

- المفاتيح **لا تُعاد كاملة في أي استجابة** — إخفاء دائم: أول 7 + `••••••••` + آخر 4
- `MCP_ACCESS_TOKEN` يحمي `/mcp` لكنه لا يحمي لوحة الإدارة — فعّل حماية النشر في Vercel (Deployment Protection) أو أضف طبقة مصادقة خاصة بك قبل النشر العام
- ملفات `.env*` مستثناة من Git — لا تضع قيمًا حقيقية في `.env.example`
