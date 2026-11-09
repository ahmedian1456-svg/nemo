// خادم MCP على /mcp — نقل Streamable HTTP حسب مواصفة MCP عبر الـ SDK الرسمي
// POST: رسائل JSON-RPC (initialize / tools/list / tools/call / notifications / ping)
// GET: غير مدعوم عمدًا (بلا SSE مستقل) → 405 حسب المواصفة
// DELETE: إنهاء جلسة → 200
// الحماية: إذا ضُبط MCP_ACCESS_TOKEN يُطلب Authorization: Bearer <token>
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { after } from "next/server";
import { SERVER_INFO, SERVER_INSTRUCTIONS, registerMediaTools } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// نافذة الانتظار قد تمتد لدقائق (حتى 240ث) — الحد الأقصى الآمن لخطط Vercel الحديثة
export const maxDuration = 300;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function authOk(request: Request): boolean {
  const required = process.env.MCP_ACCESS_TOKEN;
  if (!required) return true;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

function jsonError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
}

/** إنشاء خادم + نقل عديمي الجلسة لكل طلب (النمط المعتمد للنشر على serverless) */
async function createServerAndTransport() {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  registerMediaTools(server);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // وضع عديم الجلسة — مناسب لبيئات serverless مثل Vercel
    enableJsonResponse: false,
  });
  await server.connect(transport);
  return { server, transport };
}

export async function POST(request: Request): Promise<Response> {
  if (!authOk(request)) {
    return jsonError(401, -32001, "Unauthorized: مطلوب ترويسة Authorization: Bearer <MCP_ACCESS_TOKEN>");
  }

  // تحقق مبكر من صحة JSON — خطأ تحليل → -32700 حسب المواصفة
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return jsonError(400, -32700, "Parse error: invalid JSON body");
  }

  const { server, transport } = await createServerAndTransport();
  try {
    const response = await transport.handleRequest(request, { parsedBody });
    // تنظيف بعد انتهاء إرسال الرد (التنفيذ يتم بالكامل داخل handleRequest)
    after(async () => {
      try {
        await transport.close();
        await server.close();
      } catch {
        /* التنظيف غير حرج */
      }
    });
    // أضف ترويسات CORS دون استهلاك جسم الرد (قد يكون SSE متدفقًا)
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (e) {
    try {
      await transport.close();
      await server.close();
    } catch {
      /* تجاهل */
    }
    const msg = e instanceof Error ? e.message : "internal error";
    return jsonError(500, -32603, `Internal error: ${msg}`);
  }
}

export async function GET(): Promise<Response> {
  // بلا SSE مستقل عديم الجلسة — المواصفة تسمح بالرد 405
  return jsonError(405, -32000, "Method Not Allowed: this server does not offer a standalone GET SSE stream");
}

export async function DELETE(): Promise<Response> {
  // وضع عديم الجلسة: لا جلسة تُنهى — نرد نجاحًا وفقًا للمواصفة
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
