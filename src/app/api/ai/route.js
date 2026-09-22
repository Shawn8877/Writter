import { generateStory } from "@/lib/server/ai-service";
import { getApiAuth } from "@/lib/auth/server";

// UI buttons intentionally do not call this endpoint in phase 2.
export async function POST(request) {
  const { error } = await getApiAuth();
  if (error) return error;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { code: "INVALID_REQUEST", message: "请求内容必须是 JSON。" },
      { status: 400 },
    );
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.action !== "string"
  )
    return Response.json(
      { code: "INVALID_REQUEST", message: "缺少创作操作。" },
      { status: 400 },
    );
  const result = await generateStory(payload);
  return Response.json(result, {
    status: result.code === "INVALID_ACTION" ? 400 : 501,
  });
}
