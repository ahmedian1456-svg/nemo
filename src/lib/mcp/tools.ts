// تسجيل أدوات MCP الخمس — الأوصاف بالإنجليزية (يقرؤها العميل)، والنتائج بالعربية
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerResult, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { runGeneration, refreshTask, DEFAULT_WAIT_SECONDS } from "@/lib/generation";
import { runMerge, DEFAULT_MERGE_WAIT_SECONDS } from "@/lib/merge";
import { listRecentTasks, type TaskRow } from "@/lib/turso";
import {
  formatTaskForClient,
  formatNoKeys,
  formatTaskNotFound,
  formatMediaList,
} from "@/lib/format";

type Extra = RequestHandlerExtra<ServerResult, ServerNotification>;

/** مُرسل إشعارات التقدم — يعمل فقط إذا مرر العميل progressToken في _meta */
function makeProgressSender(extra: Extra) {
  return async (progress: number, message: string): Promise<void> => {
    try {
      const token = (extra._meta as { progressToken?: string | number } | undefined)?.progressToken;
      if (token === undefined || token === null) return;
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress, total: 100, message },
      } as ServerNotification);
    } catch {
      // إشعارات التقدم ليست حرجة
    }
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function taskResult(task: TaskRow) {
  return textResult(formatTaskForClient(task));
}

export const SERVER_INFO = { name: "media-generator-mcp", version: "1.2.0" } as const;

export const SERVER_INSTRUCTIONS = `AI media generation server (kie.ai + CometAPI with automatic sequential multi-key failover, plus video merging).
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Never stop or warn the user about keys or balances; just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
Use list_media to recall previously generated media from the database.`;

export function registerMediaTools(server: McpServer): void {
  // 1) generate_image — توليد صورة
  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate an image with gpt-image-2-6/flare-text-to-image (automatic failover across all active keys). " +
        "Returns the ready image URL if completed within the wait window; otherwise returns a task_id — " +
        "call get_task every ~10 seconds until completed, then show the URL and stop.",
      inputSchema: {
        prompt: z.string().min(1).describe("What to draw. Detailed prompts give better results."),
        model: z
          .enum(["gpt-image-2-6/flare-text-to-image", "gpt-image-2.6/flare-text-to-image"])
          .default("gpt-image-2-6/flare-text-to-image"),
        aspect_ratio: z
          .enum(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"])
          .default("auto"),
        resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
        background: z.enum(["auto", "transparent", "opaque"]).default("auto"),
        output_format: z.enum(["png", "jpeg", "webp", "gif"]).default("png"),
        wait_seconds: z.number().int().min(0).max(240).default(90),
      },
    },
    async (args, extra) => {
      const task = await runGeneration({
        type: "image",
        modelName: args.model,
        params: { ...args },
        waitSeconds: args.wait_seconds,
        onProgress: makeProgressSender(extra),
      });
      if (task.kind === "no_keys") return textResult(formatNoKeys(task.model));
      return taskResult(task.task);
    }
  );

  // 2) generate_video — توليد فيديو بصوت متزامن
  server.registerTool(
    "generate_video",
    {
      title: "Generate Video",
      description:
        "Generate a video with grok-imagine-video-1-5-preview (native synced audio — dialogue in the prompt is spoken, optional image-to-video). " +
        "Videos take minutes: short wait with progress, then a task_id — follow with get_task every ~10 seconds.",
      inputSchema: {
        prompt: z
          .string()
          .max(4096)
          .describe("Scene description. Dialogue in the prompt is spoken in the video."),
        image_url: z
          .string()
          .optional()
          .describe("Optional public image URL as the first frame (image-to-video)."),
        model: z
          .enum(["grok-imagine-video-1-5-preview", "grok-imagine-video-1.5-preview"])
          .default("grok-imagine-video-1-5-preview"),
        aspect_ratio: z.enum(["auto", "1:1", "16:9", "9:16", "3:2", "2:3"]).default("auto"),
        resolution: z.enum(["480p", "720p", "1080p"]).default("480p"),
        enable_audio: z.boolean().default(true),
        duration: z.number().int().min(1).max(15).default(8),
        wait_seconds: z.number().int().min(0).max(240).default(25),
      },
    },
    async (args, extra) => {
      const task = await runGeneration({
        type: "video",
        modelName: args.model,
        params: { ...args },
        waitSeconds: args.wait_seconds,
        onProgress: makeProgressSender(extra),
      });
      if (task.kind === "no_keys") return textResult(formatNoKeys(task.model));
      return taskResult(task.task);
    }
  );

  // 3) merge_videos — دمج عدة مقاطع بترتيبها
  server.registerTool(
    "merge_videos",
    {
      title: "Merge Videos",
      description:
        "Merge several clips into one final video in the given order. Pass 'urls' (public direct video links, " +
        "e.g. the URLs returned by generate_video) or 'task_ids' (COMPLETED video generation tasks — their result " +
        "URLs are merged in this order). Merging is usually fast: short wait with progress, then a merge task_id — " +
        "track it with get_task. NOTE: the merged file is stored on the merging service for ~24 hours only — " +
        "tell the user to watch/download it promptly.",
      inputSchema: {
        urls: z
          .array(z.string())
          .min(2)
          .max(10)
          .optional()
          .describe("Public direct video URLs (http/https) in merge order — the first clip starts the final video."),
        task_ids: z
          .array(z.string())
          .min(2)
          .max(10)
          .optional()
          .describe("Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order."),
        wait_seconds: z.number().int().min(0).max(240).default(60),
      },
    },
    async (args, extra) => {
      const outcome = await runMerge({
        urls: args.urls,
        taskIds: args.task_ids,
        waitSeconds: args.wait_seconds ?? DEFAULT_MERGE_WAIT_SECONDS,
        onProgress: makeProgressSender(extra),
      });
      if (outcome.kind === "config_error" || outcome.kind === "validation_error") {
        return textResult(outcome.message);
      }
      return taskResult(outcome.task);
    }
  );

  // 4) get_task — تتبع أي مهمة (توليد أو دمج)
  server.registerTool(
    "get_task",
    {
      title: "Get Task",
      description:
        "Track any task by its id — image/video generation AND merging (reads the database and refreshes live " +
        "from the provider/service while still running). Poll it every ~10 seconds; when status is completed " +
        "you will find the result URLs — show them to the user and stop polling.",
      inputSchema: {
        task_id: z.string().min(1).describe("The task_id returned by generate_image / generate_video / merge_videos."),
      },
    },
    async (args, extra) => {
      const task = await refreshTask(args.task_id.trim());
      if (!task) return textResult(formatTaskNotFound());
      // تحديث حي واحد — مع إشعار تقدم إن وُجد توكن
      if (task.status === "processing" || task.status === "pending") {
        await makeProgressSender(extra)(task.progress, `قيد المعالجة… ${task.progress}%`);
      }
      return taskResult(task);
    }
  );

  // 5) list_media — أحدث الوسائط المخزنة بروابطها
  server.registerTool(
    "list_media",
    {
      title: "List Media",
      description:
        "List the most recent images / videos / merges stored with their result URLs, from the database. " +
        "Use it to recall previously generated media (e.g. the user asks for earlier results or wants to merge " +
        "clips generated earlier). Optional filters: type (image|video|merge), status and limit (1-50, default 10).",
      inputSchema: {
        type: z.enum(["image", "video", "merge"]).optional(),
        status: z.enum(["completed", "processing", "pending", "failed"]).default("completed"),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async (args) => {
      const tasks = await listRecentTasks(args.limit, {
        type: args.type,
        status: args.status,
      });
      const note = [args.type ? `النوع: ${args.type}` : "", args.status !== "completed" ? `الحالة: ${args.status}` : ""]
        .filter(Boolean)
        .join("، ");
      return textResult(formatMediaList(tasks, note));
    }
  );
}

// تصدير قيم افتراضية للتوثيق
export { DEFAULT_WAIT_SECONDS };
