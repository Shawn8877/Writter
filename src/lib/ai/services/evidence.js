const compact = (value) => value.replace(/\s+/g, "");
const quotePairs = { '“': '”', '「': '」', '『': '』', '"': '"' };

// Models sometimes wrap an otherwise exact excerpt in quotation marks. Strip
// only that outer wrapper, and only if the entire inner text exists verbatim.
// Never remove interior punctuation, paraphrases, ellipses or word differences.
export function matchedEvidence(source, excerpt) {
  if (!source || !excerpt?.trim()) return null;
  const text = excerpt.trim();
  const haystack = compact(source);
  if (haystack.includes(compact(text))) return text;
  const inner = quotePairs[text[0]] === text.at(-1) ? text.slice(1,-1).trim() : "";
  return inner && haystack.includes(compact(inner)) ? inner : null;
}
