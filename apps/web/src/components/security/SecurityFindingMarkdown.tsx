import type { ReactNode } from "react";

const MAX_MARKDOWN_CHARS = 16_000;

/**
 * NOT an HTML sanitizer. The tag and attribute stripping below is defense in
 * depth for a renderer that only ever emits React text nodes; regexes cannot
 * safely neutralize malformed markup. The output of this function must never be
 * passed to `dangerouslySetInnerHTML` or to a Markdown renderer with raw HTML
 * enabled — `renderSecurityFindingMarkdown` and `SecurityFindingMarkdown` are
 * the only supported consumers, and both render text.
 */
export function sanitizeSecurityFindingMarkdown(value: string): string {
  let withoutControls = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0 && codePoint <= 8) || (codePoint >= 11 && codePoint <= 12)) continue;
    if (codePoint >= 14 && codePoint <= 31) continue;
    if (codePoint === 127 || (codePoint >= 128 && codePoint <= 159)) continue;
    // Zero-width and bidirectional-override code points can make a rendered path
    // read as a different file than the one the finding references.
    if (codePoint >= 0x200b && codePoint <= 0x200f) continue;
    if (codePoint >= 0x202a && codePoint <= 0x202e) continue;
    if (codePoint >= 0x2066 && codePoint <= 0x2069) continue;
    if (codePoint === 0xfeff || codePoint === 0x061c) continue;
    withoutControls += character;
  }
  return withoutControls
    .replace(/<\/?(?:script|style|iframe|img|object|embed|form|input|video|audio|svg)[^>]*>/gi, "")
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\[[^\]]+\]\((?:javascript:|file:)[^)]+\)/gi, (match) =>
      match.replace(/\]\([^)]*\)/, "]"),
    )
    .replace(/<!--(?:.|\n|\r)*?-->/g, "")
    .slice(0, MAX_MARKDOWN_CHARS);
}

/**
 * The allowlisted block subset. Anything not recognised stays a paragraph, so an
 * unexpected construct degrades to inert text rather than to a new capability.
 * There is deliberately no link, image, heading-anchor, or raw-HTML block: the
 * source is attacker-controlled upstream content.
 */
export type SecurityFindingBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: ReadonlyArray<string> };

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const FENCE = /^\s{0,3}(?:```|~~~)/;

export function parseSecurityFindingBlocks(sanitized: string): ReadonlyArray<SecurityFindingBlock> {
  const lines = sanitized.split(/\r\n|\r|\n/);
  const blocks: SecurityFindingBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const items: string[] = [(bullet?.[1] ?? ordered?.[1] ?? "").trim()];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        const match = isOrdered ? ORDERED.exec(next) : BULLET.exec(next);
        if (match === null) break;
        items.push((match[1] ?? "").trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Returns inert structured text instead of raw HTML or file actions. */
export function renderSecurityFindingMarkdown(value: string): {
  readonly kind: "inert-blocks";
  readonly text: string;
  readonly blocks: ReadonlyArray<SecurityFindingBlock>;
} {
  const text = sanitizeSecurityFindingMarkdown(value);
  return { kind: "inert-blocks", text, blocks: parseSecurityFindingBlocks(text) };
}

/** Content-derived React keys, disambiguated when the same content repeats. */
function makeKeyFactory(): (content: string) => string {
  const seen = new Map<string, number>();
  return (content) => {
    const occurrence = (seen.get(content) ?? 0) + 1;
    seen.set(content, occurrence);
    return `${content}#${occurrence}`;
  };
}

/** Splits on inline code spans; every segment is emitted as a React text node. */
function inlineSegments(text: string): ReactNode {
  const parts = text.split("`");
  if (parts.length < 3) return text;
  const keyFor = makeKeyFactory();
  const nodes: ReactNode[] = [];
  let isCode = false;
  for (const part of parts) {
    nodes.push(
      isCode ? (
        <code
          key={keyFor(`code:${part}`)}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {part}
        </code>
      ) : (
        <span key={keyFor(`text:${part}`)}>{part}</span>
      ),
    );
    isCode = !isCode;
  }
  return nodes;
}

function listItems(items: ReadonlyArray<string>): ReactNode[] {
  const keyFor = makeKeyFactory();
  return items.map((item) => (
    <li key={keyFor(item)} className="break-words">
      {inlineSegments(item)}
    </li>
  ));
}

export function SecurityFindingMarkdown({ value }: { readonly value: string }): ReactNode {
  const blocks = parseSecurityFindingBlocks(sanitizeSecurityFindingMarkdown(value));
  const keyFor = makeKeyFactory();
  return (
    <div className="space-y-2">
      {blocks.map((block) => {
        if (block.kind === "code") {
          return (
            <pre
              key={keyFor(`code:${block.text}`)}
              className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words"
            >
              {block.text}
            </pre>
          );
        }
        if (block.kind === "list") {
          const key = keyFor(`list:${block.ordered ? "1" : "0"}:${block.items.join("")}`);
          return block.ordered ? (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {listItems(block.items)}
            </ol>
          ) : (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {listItems(block.items)}
            </ul>
          );
        }
        return (
          <p key={keyFor(`p:${block.text}`)} className="whitespace-pre-wrap break-words">
            {inlineSegments(block.text)}
          </p>
        );
      })}
    </div>
  );
}
