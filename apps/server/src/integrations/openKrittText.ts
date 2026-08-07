/**
 * Zero-width, bidirectional-override, and byte-order-mark code points. These are
 * not control characters, but they let untrusted Open Kritt finding text render a
 * path or type as something other than what it references, so they are stripped
 * on the same boundary.
 */
function isInvisibleOrDirectionalOverride(codePoint: number): boolean {
  if (codePoint >= 0x200b && codePoint <= 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  return codePoint === 0xfeff || codePoint === 0x061c;
}

/** Remove control characters before untrusted Open Kritt text crosses a boundary. */
export function stripOpenKrittControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0 && codePoint <= 8) || (codePoint >= 11 && codePoint <= 12)) continue;
    if (codePoint >= 14 && codePoint <= 31) continue;
    if (codePoint === 127 || (codePoint >= 128 && codePoint <= 159)) continue;
    if (isInvisibleOrDirectionalOverride(codePoint)) continue;
    result += character;
  }
  return result;
}
