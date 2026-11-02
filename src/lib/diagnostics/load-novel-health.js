import "server-only";
import { summarizeNovelHealth } from "./novel-health.js";

// Session-scoped client and explicit owner query; no service-role credentials.
export async function loadNovelHealth(supabase, novelId, userId) {
  const novel = await supabase.from("novels").select("id,title").eq("id", novelId).eq("user_id", userId).maybeSingle();
  if (novel.error) throw new Error("无法读取作品健康指标。");
  if (!novel.data) return null;
  const fields = {
    chapters: "id,sort_order,word_count", characters: "id", timeline_events: "id",
    memory_items: "id,content,status,memory_type",
    chapter_reviews: "id,chapter_id,status,overall_score,result_json,created_at",
    ai_generation_logs: "id,chapter_id,generation_type,status,input_tokens,output_tokens,latency_ms",
  };
  const entries = await Promise.all(Object.entries(fields).map(async ([table, select]) => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const result = await supabase.from(table).select(select).eq("novel_id", novelId).order("id").range(offset, offset + 499);
      if (result.error) throw new Error("无法读取作品健康指标。");
      rows.push(...result.data);
      if (result.data.length < 500) break;
    }
    return [table, rows];
  }));
  return { novel: novel.data, ...summarizeNovelHealth(Object.fromEntries(entries)) };
}
