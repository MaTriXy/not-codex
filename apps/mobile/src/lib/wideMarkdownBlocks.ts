/**
 * Detects markdown rendered as a standalone wide block: fenced code and GFM tables.
 * Android needs a fixed-width user bubble for these blocks so its intrinsic-width pass
 * does not position surrounding paragraphs on top of one another.
 */
const FENCED_CODE_BLOCK = /^ {0,3}(?:```|~~~)/m;

function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) {
    return false;
  }
  return /^[|\-: \t]+$/.test(trimmed);
}

export function hasWideMarkdownBlock(text: string): boolean {
  if (FENCED_CODE_BLOCK.test(text)) {
    return true;
  }
  if (!text.includes("|")) {
    return false;
  }
  return text.split("\n").some(isTableDelimiterRow);
}
