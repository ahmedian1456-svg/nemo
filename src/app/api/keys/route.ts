// GET  /api/keys  — قائمة المفاتيح مع إخفاء المفاتيح دائمًا (maskKey)
// POST /api/keys  — إضافة مفتاح جديد {provider, api_key, label?} مع رفض التكرار لنفس المزود
import { NextResponse } from "next/server";
import { listKeys, insertKey, findDuplicateKey } from "@/lib/turso";
import { maskKey } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const keys = await listKeys();
    return NextResponse.json({
      keys: keys.map((k) => ({
        id: k.id,
        provider: k.provider,
        label: k.label,
        maskedKey: maskKey(k.apiKey), // المفتاح الكامل لا يُعاد في أي استجابة
        status: k.status,
        usageCount: k.usageCount,
        successCount: k.successCount,
        failCount: k.failCount,
        lastUsedAt: k.lastUsedAt,
        lastCheckedAt: k.lastCheckedAt,
        lastError: k.lastError,
        createdAt: k.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذر جلب المفاتيح: ${e instanceof Error ? e.message : "خطأ غير معروف"}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { provider?: string; api_key?: string; label?: string }
      | null;
    const provider = body?.provider;
    const apiKey = body?.api_key?.trim();
    const label = body?.label?.trim() ?? "";

    if (!provider || !["kie", "cometapi"].includes(provider)) {
      return NextResponse.json({ error: "المزود غير صالح — المسموح: kie أو cometapi" }, { status: 400 });
    }
    if (!apiKey || apiKey.length < 8) {
      return NextResponse.json({ error: "المفتاح قصير جدًا أو فارغ" }, { status: 400 });
    }

    const dup = await findDuplicateKey(provider, apiKey);
    if (dup) {
      return NextResponse.json(
        { error: "هذا المفتاح مضاف مسبقًا لنفس المزود — لا يمكن تكراره" },
        { status: 409 }
      );
    }

    const row = await insertKey({
      id: crypto.randomUUID(),
      provider: provider as "kie" | "cometapi",
      label,
      apiKey,
    });
    return NextResponse.json(
      {
        key: {
          id: row.id,
          provider: row.provider,
          label: row.label,
          maskedKey: maskKey(row.apiKey),
          status: row.status,
          createdAt: row.createdAt,
        },
        message: "تمت إضافة المفتاح — سيُجرَّب أولًا ضمن الترتيب التسلسلي (حسب وقت الإضافة)",
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `تعذرت إضافة المفتاح: ${e instanceof Error ? e.message : "خطأ غير معروف"}` },
      { status: 500 }
    );
  }
}
