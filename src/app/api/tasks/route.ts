// GET /api/tasks — أحدث المهام (مع فلاتر النوع والحالة) للوحة الإدارة
import { NextResponse } from "next/server";
import { listRecentTasks } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 30) || 30));
    const type = url.searchParams.get("type") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;

    const tasks = await listRecentTasks(limit, { type, status });
    return NextResponse.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        type: t.type,
        provider: t.provider,
        model: t.model,
        prompt: t.prompt,
        status: t.status,
        progress: t.progress,
        resultUrls: t.resultUrls,
        errorMessage: t.errorMessage, // داخلي — للوحة الإدارة فقط
        attemptsCount: t.attempts.length,
        attempts: t.attempts.slice(-8), // آخر المحاولات للعرض التفصيلي
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذر جلب المهام: ${e instanceof Error ? e.message : "خطأ غير معروف"}` },
      { status: 500 }
    );
  }
}
