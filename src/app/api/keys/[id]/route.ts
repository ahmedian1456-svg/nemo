// PATCH  /api/keys/{id} — تعطيل/تنشيط يدوي (active | disabled | exhausted→active بعد الشحن)
// DELETE /api/keys/{id} — حذف نهائي
import { NextResponse } from "next/server";
import { getKey, setKeyStatus, deleteKey } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status;
    if (!status || !["active", "disabled", "exhausted"].includes(status)) {
      return NextResponse.json(
        { error: "الحالة غير صالحة — المسموح: active أو disabled أو exhausted" },
        { status: 400 }
      );
    }
    const existing = await getKey(id);
    if (!existing) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });

    const updated = await setKeyStatus(id, status as "active" | "disabled" | "exhausted");
    return NextResponse.json({
      key: { id: updated!.id, status: updated!.status },
      message: status === "active" ? "تم تنشيط المفتاح" : "تم تعطيل المفتاح",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذر تحديث المفتاح: ${e instanceof Error ? e.message : "خطأ غير معروف"}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const ok = await deleteKey(id);
    if (!ok) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });
    return NextResponse.json({ ok: true, message: "تم حذف المفتاح" });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذر حذف المفتاح: ${e instanceof Error ? e.message : "خطأ غير معروف"}` },
      { status: 500 }
    );
  }
}
