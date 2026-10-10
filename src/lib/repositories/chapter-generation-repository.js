// Only same-origin application endpoints are used by the browser.
export async function generateChapter(body, onStage) {
  const response = await fetch("/api/ai/chapters/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || "暂时无法生成，请稍后重试。"); }
  if (!response.body) throw new Error("未收到生成结果，请稍后检查网络。");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let size = 0; let preview;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "生成失败，请稍后重试。");
    if (event.type === "stage") onStage(event.stage);
    if (event.type === "preview") preview = event.preview;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 600000) throw new Error("生成结果过大，请调整单章目标字数。");
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    }
    consume(buffer + decoder.decode());
    if (!preview?.content || !preview.generationId) throw new Error("连接中断，未收到完整预览。请稍后重试；不会自动再次调用 AI。");
    return preview;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function confirmChapter(generationId) {
  const response = await fetch("/api/ai/chapters/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存失败，预览已保留，请重试。");
  return result;
}
