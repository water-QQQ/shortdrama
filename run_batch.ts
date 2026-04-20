/**
 * 短剧批量提交：对 scenes[] 每项调用 POST /api/v1/claw/tasks/aigc（与 agnes-aigc 单条一致）。
 */
type JsonRecord = Record<string, unknown>;

type SceneInput = JsonRecord;

type SceneResult = {
  index: number;
  task_id: string | null;
  status: string;
  message: string;
  error?: string;
  raw: unknown;
};

type BatchResult = {
  skill: string;
  status: string;
  message: string;
  scenes: SceneResult[];
};

const SKILL_NAME = "agnes-short-drama";

function getEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getApiKey(): string {
  const value = process.env.AGNES_API_KEY?.trim();
  if (!value) {
    throw new Error("Missing required environment variable: AGNES_API_KEY");
  }
  return value;
}

function parseJson(input: string): JsonRecord {
  try {
    return JSON.parse(input) as JsonRecord;
  } catch (error) {
    throw new Error(`Invalid JSON input: ${(error as Error).message}`);
  }
}

function parseJsonSafe(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

async function readInput(): Promise<JsonRecord> {
  const arg = process.argv[2]?.trim();
  if (arg) {
    return parseJson(arg);
  }

  if (process.stdin.isTTY) {
    throw new Error("Expected a JSON payload in argv[2] or stdin");
  }

  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
  }
  return parseJson(chunks.join("").trim());
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function formatSeconds(seconds: unknown): string | undefined {
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return `${seconds}s`;
  }
  return undefined;
}

function extractErrorMessage(status: number, body: unknown, fallbackText?: string): string {
  const record = body && typeof body === "object" ? (body as JsonRecord) : undefined;
  const detailRaw = record?.detail;
  if (detailRaw && typeof detailRaw === "object" && !Array.isArray(detailRaw)) {
    const d = detailRaw as JsonRecord;
    const code = firstString(d.code);
    const subUrl = firstString(d.subscription_url);
    const userMsg = firstString(d.message);
    if (code === "insufficient_credits" || subUrl || userMsg) {
      if (userMsg) {
        return userMsg;
      }
      if (subUrl) {
        return `当前积分不足，暂无法完成本次操作。请前往 Agnes 订阅或充值后再试。\n\n${subUrl}`;
      }
    }
  }
  if (typeof detailRaw === "string" && detailRaw.trim()) {
    return detailRaw.trim();
  }
  const detail = firstString(record?.error, record?.message);
  if (detail) {
    return detail;
  }
  const text = fallbackText?.trim();
  if (text) {
    return text;
  }
  if (status === 401 || status === 403) {
    return "Agnes authentication failed. Check the configured Agnes API key for this OpenClaw instance.";
  }
  if (status === 402) {
    return "Agnes rejected the request because the instance quota is insufficient.";
  }
  if (status >= 500) {
    return "Agnes returned a server-side error while handling the AIGC task.";
  }
  return `Agnes request failed with status ${status}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(`Agnes service could not be reached: ${(error as Error).message}`);
  }
  const text = await response.text();
  const parsed = text ? parseJsonSafe(text) : undefined;
  const body = parsed ?? (text ? { message: text } : {});
  return { status: response.status, body, text };
}

async function pollStatus(baseUrl: string, apiKey: string, taskId: string): Promise<unknown> {
  const timeoutMs = Number(process.env.AGNES_POLL_TIMEOUT_MS ?? "0");
  const intervalMs = Number(process.env.AGNES_POLL_INTERVAL_MS ?? "1000");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, body } = await fetchJson(`${baseUrl}/api/v1/claw/tasks/${taskId}`, {
      method: "GET",
      headers: buildHeaders(apiKey),
    });
    if (status >= 400) {
      return body;
    }
    const task = body as JsonRecord;
    if (task.status === "completed" || task.status === "failed") {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function buildPayload(scene: SceneInput): JsonRecord {
  const contentType = firstString(scene.content_type, scene.contentType) ?? "video";
  if (contentType !== "video") {
    throw new Error("short-drama batch only supports content_type 'video' per scene");
  }
  const prompt = asString(scene.prompt);
  if (!prompt) {
    throw new Error("each scene requires prompt");
  }

  const payload: JsonRecord = {
    content_type: "video",
    prompt,
    save_to_dialogue: true,
  };

  const images = asStringArray(scene.images) ?? asStringArray(scene.image_urls) ?? asStringArray(scene.reference_images);
  const model = firstString(scene.model, scene.model_name);
  const ratio = asString(scene.ratio);
  const seed = asNumber(scene.seed);
  const duration = asNumber(scene.duration);
  const fps = asNumber(scene.fps);
  const enableTranslation = asBoolean(scene.enable_translation);
  const inputTaskId = asString(scene.task_id);

  if (images) payload.images = images;
  if (model) payload.model = model;
  if (ratio) payload.ratio = ratio;
  if (seed !== undefined) payload.seed = seed;
  if (duration !== undefined) payload.duration = duration;
  if (fps !== undefined) payload.fps = fps;
  if (enableTranslation !== undefined) payload.enable_translation = enableTranslation;
  if (inputTaskId) payload.task_id = inputTaskId;

  return payload;
}

async function submitOne(
  baseUrl: string,
  apiKey: string,
  scene: SceneInput,
  index: number
): Promise<SceneResult> {
  let payload: JsonRecord;
  try {
    payload = buildPayload(scene);
  } catch (error) {
    return {
      index,
      task_id: null,
      status: "failed",
      message: "Invalid scene payload.",
      error: (error as Error).message,
      raw: null,
    };
  }

  const { status, body, text } = await fetchJson(`${baseUrl}/api/v1/claw/tasks/aigc`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (status >= 400) {
    const detail = extractErrorMessage(status, body, text);
    return {
      index,
      task_id: null,
      status: "failed",
      message: "Agnes AIGC request failed.",
      error: detail,
      raw: body,
    };
  }

  const accepted = body as JsonRecord;
  const acceptedTaskId = asString(accepted.task_id);
  if (!acceptedTaskId) {
    return {
      index,
      task_id: null,
      status: "failed",
      message: "Agnes response missing task_id",
      error: "Agnes response missing task_id",
      raw: body,
    };
  }

  const polled = await pollStatus(baseUrl, apiKey, acceptedTaskId);
  const estimatedTime = formatSeconds(accepted.estimated_seconds);

  if (polled && (polled as JsonRecord).status === "completed") {
    return {
      index,
      task_id: acceptedTaskId,
      status: "completed",
      message: estimatedTime ? `Completed (${estimatedTime} est.)` : "Completed.",
      raw: polled,
    };
  }

  if (polled && (polled as JsonRecord).status === "failed") {
    const task = polled as JsonRecord;
    return {
      index,
      task_id: acceptedTaskId,
      status: "failed",
      message: "Agnes AIGC task failed.",
      error: asString(task.error_message) ?? "Unknown Agnes AIGC error",
      raw: task,
    };
  }

  return {
    index,
    task_id: acceptedTaskId,
    status: "pending",
    message: estimatedTime ? `Accepted (${estimatedTime} est.)` : "Task accepted.",
    raw: accepted,
  };
}

function aggregateStatus(scenes: SceneResult[]): string {
  if (scenes.length === 0) {
    return "failed";
  }
  const failed = scenes.filter((s) => s.status === "failed").length;
  const completed = scenes.filter((s) => s.status === "completed").length;
  const pending = scenes.filter((s) => s.status === "pending").length;

  if (failed === scenes.length) {
    return "failed";
  }
  if (completed === scenes.length) {
    return "completed";
  }
  if (failed > 0 && (completed > 0 || pending > 0)) {
    return "partial";
  }
  if (pending > 0) {
    return "pending";
  }
  return "failed";
}

async function main(): Promise<void> {
  const baseUrl = getEnv("AGNES_BASE_URL").replace(/\/+$/, "");
  const apiKey = getApiKey();
  const input = await readInput();

  const rawScenes = input.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    throw new Error("scenes must be a non-empty array");
  }

  const sequential = asBoolean(input.sequential) === true;
  const scenes: SceneResult[] = [];

  if (sequential) {
    for (let i = 0; i < rawScenes.length; i++) {
      const row = rawScenes[i] as SceneInput;
      const one = await submitOne(baseUrl, apiKey, row, i);
      scenes.push(one);
    }
  } else {
    const tasks = rawScenes.map((row, i) => submitOne(baseUrl, apiKey, row as SceneInput, i));
    const settled = await Promise.all(tasks);
    scenes.push(...settled);
  }

  const overall = aggregateStatus(scenes);
  const failedN = scenes.filter((s) => s.status === "failed").length;
  const okN = scenes.filter((s) => s.status === "completed").length;
  const pendN = scenes.filter((s) => s.status === "pending").length;

  let message = `Submitted ${scenes.length} scene(s): ${okN} completed, ${pendN} pending, ${failedN} failed.`;
  if (overall === "completed") {
    message = `All ${scenes.length} scene(s) completed.`;
  } else if (overall === "failed") {
    message = "All scenes failed or invalid.";
  } else if (overall === "partial") {
    message = `Partial success: ${okN} completed, ${failedN} failed, ${pendN} pending.`;
  }

  const result: BatchResult = {
    skill: SKILL_NAME,
    status: overall,
    message,
    scenes,
  };

  console.log(JSON.stringify(result));
}

main().catch((error: Error) => {
  console.log(
    JSON.stringify({
      skill: SKILL_NAME,
      status: "failed",
      message: "agnes-short-drama batch execution failed.",
      error: error.message,
      scenes: [],
    })
  );
  process.exitCode = 1;
});
