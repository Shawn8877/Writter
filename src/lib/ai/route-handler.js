import "server-only";
import { getApiAuth } from "@/lib/auth/server";
import { readJson, RepositoryError } from "@/lib/server/supabase-repository";
import { AiError, aiErrorResponse } from "./errors.js";

export function createBuilderHandler(workflow, maxBytes, dependencies = {}) {
  return async function POST(request) {
    const requestId = crypto.randomUUID();
    try {
      const auth = await (dependencies.authenticate || getApiAuth)();
      if (auth.error) return auth.error;
      const body = await (dependencies.read || readJson)(request, maxBytes);
      const result = await workflow(auth.supabase, body);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const safe = error instanceof RepositoryError ? new AiError(error.code, error.message, error.status) : error;
      return aiErrorResponse(safe, requestId);
    }
  };
}
