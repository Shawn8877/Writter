// Durable rows retain their complete audit trail. Model inputs need current
// facts; repeating old evidence inside every summary causes rapid growth.
export function currentCharacterContext(character) {
  const state = character.current_state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return character;
  const { recentChanges: _history, ...currentState } = state;
  return { ...character, current_state: currentState };
}

export function summaryContext(summary) {
  if (Array.isArray(summary)) return summary.map(summaryContext);
  if (!summary || typeof summary !== "object") return summary;
  return Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "evidence").map(([key,value]) => [key,summaryContext(value)]));
}

export function currentMemoryContext({ id, memory_type, title, content, importance, status, chapter_id }) {
  return { id, memory_type, title, content, importance, status, chapter_id };
}
