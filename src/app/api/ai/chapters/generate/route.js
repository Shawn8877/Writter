import { getApiAuth } from "@/lib/auth/server";
import { readJson, RepositoryError } from "@/lib/server/supabase-repository";
import { AiError, aiErrorResponse } from "@/lib/ai/errors";
import { generateChapterPreview, validateChapterRequest } from "@/lib/ai/services/chapter-workflow";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request) {
  const requestId = crypto.randomUUID();
  let auth; let body;
  try {
    auth = await getApiAuth(); if (auth.error) return auth.error;
    body = validateChapterRequest(await readJson(request, 4096));
  } catch (error) { return aiErrorResponse(error instanceof RepositoryError ? new AiError(error.code, error.message, error.status) : error, requestId); }
  let disconnected = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => { if (!disconnected) { try { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); } catch { disconnected = true; } } };
      try { const preview = await generateChapterPreview(auth.supabase, body, emit); emit({ type: "preview", preview }); }
      catch (error) { const response = aiErrorResponse(error, requestId); emit({ type: "error", ...(await response.json()) }); }
      finally { if (!disconnected) controller.close(); }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
