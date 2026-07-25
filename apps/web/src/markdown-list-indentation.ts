interface MarkdownPoint {
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;
}

interface MarkdownPosition {
  readonly start?: MarkdownPoint;
  readonly end?: MarkdownPoint;
}

interface MarkdownAstNode {
  readonly type: string;
  readonly value?: unknown;
  checked?: boolean | null;
  position?: MarkdownPosition;
  children?: MarkdownAstNode[];
}

interface MarkdownFile {
  readonly value?: unknown;
}

interface MarkdownParser {
  parse(markdown: string): unknown;
}

interface RecoveredMarkdown {
  readonly blocks: MarkdownAstNode[];
  readonly source: string;
  readonly taskChecked?: boolean;
}

interface SourceLine {
  readonly value: string;
  readonly startOffset: number;
}

const INLINE_PARSE_PREFIX = "notcodex-markdown-inline-prefix:";

function isSameLineOverIndentedCode(
  node: MarkdownAstNode,
  parent: MarkdownAstNode | undefined,
  markdown: string,
): boolean {
  if (
    node.type !== "code" ||
    parent?.type !== "listItem" ||
    typeof node.value !== "string" ||
    !/^[\t ]/.test(node.value)
  ) {
    return false;
  }

  const nodeStart = node.position?.start;
  const parentStart = parent.position?.start;
  if (
    nodeStart?.line === undefined ||
    nodeStart.offset === undefined ||
    parentStart?.line === undefined ||
    nodeStart.line !== parentStart.line
  ) {
    return false;
  }

  const sourceCharacter = markdown[nodeStart.offset];
  return sourceCharacter !== "`" && sourceCharacter !== "~";
}

function parseRecoveredMarkdown(value: string, parser: MarkdownParser): RecoveredMarkdown {
  // A text prefix forces block-looking input into a paragraph while preserving
  // the processor's configured inline extensions (for example, GFM syntax).
  // Later root children are kept as blocks so blank-line-separated content is
  // never discarded.
  const source = `${INLINE_PARSE_PREFIX}${value}`;
  const document = parser.parse(source) as MarkdownAstNode;
  const blocks = document.children;
  const paragraph = blocks?.[0];
  const children = paragraph?.type === "paragraph" ? paragraph.children : undefined;
  const first = children?.[0];
  if (
    !blocks ||
    !children ||
    first?.type !== "text" ||
    typeof first.value !== "string" ||
    !first.value.startsWith(INLINE_PARSE_PREFIX)
  ) {
    return { blocks: [{ type: "text", value }], source };
  }

  const firstValue = first.value.slice(INLINE_PARSE_PREFIX.length);
  return {
    blocks: [
      {
        ...paragraph,
        type: "paragraph",
        children: [...(firstValue ? [{ ...first, value: firstValue }] : []), ...children.slice(1)],
      },
      ...blocks.slice(1),
    ],
    source,
  };
}

function blocksFromIndentedCode(node: MarkdownAstNode, parser: MarkdownParser): RecoveredMarkdown {
  const value = typeof node.value === "string" ? node.value.trim() : "";
  const taskMarker = /^\[([ xX])\](?=[\t \r\n]|$)/.exec(value);
  const recoveredValue = taskMarker
    ? value.slice(taskMarker[0].length).replace(/^[\t ]+/, "")
    : value;
  const recovered = parseRecoveredMarkdown(recoveredValue, parser);
  const first = recovered.blocks[0];
  return {
    ...recovered,
    ...(taskMarker ? { taskChecked: taskMarker[1]?.toLowerCase() === "x" } : {}),
    blocks:
      first && node.position
        ? [{ ...first, position: node.position }, ...recovered.blocks.slice(1)]
        : recovered.blocks,
  };
}

function indexSourceLines(source: string): SourceLine[] {
  const lines = source.split("\n");
  let startOffset = 0;
  return lines.map((value) => {
    const line = { value, startOffset };
    startOffset += value.length + 1;
    return line;
  });
}

function sourceLineAt(lines: readonly SourceLine[], lineNumber: number): SourceLine | null {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) {
    return null;
  }
  return lines[lineNumber - 1] ?? null;
}

function remapRecoveredPoint(input: {
  point: MarkdownPoint;
  recoveredLines: readonly SourceLine[];
  parentLines: readonly SourceLine[];
  parentStartLine: number;
}): MarkdownPoint | undefined {
  const recoveredLineNumber = input.point.line;
  const recoveredColumn = input.point.column;
  if (recoveredLineNumber === undefined || recoveredColumn === undefined) {
    return undefined;
  }
  const recoveredLine = sourceLineAt(input.recoveredLines, recoveredLineNumber);
  const parentLineNumber = input.parentStartLine + recoveredLineNumber - 1;
  const parentLine = sourceLineAt(input.parentLines, parentLineNumber);
  if (!recoveredLine || !parentLine) {
    return undefined;
  }

  const recoveredValue = recoveredLine.value.replace(/\r$/, "");
  const parentValue = parentLine.value.replace(/\r$/, "");
  const recoveredIndentation = recoveredValue.length - recoveredValue.trimStart().length;
  const parentIndentation = parentValue.length - parentValue.trimStart().length;
  if (recoveredValue.trimStart() !== parentValue.trimStart()) {
    return undefined;
  }
  const parentColumn = recoveredColumn + parentIndentation - recoveredIndentation;
  if (parentColumn < 1) {
    return undefined;
  }
  return {
    line: parentLineNumber,
    column: parentColumn,
    offset: parentLine.startOffset + parentColumn - 1,
  };
}

function remapRecoveredListItemPositions(input: {
  blocks: MarkdownAstNode[];
  recoveredLines: readonly SourceLine[];
  parentLines: readonly SourceLine[];
  parentPosition: MarkdownPosition | undefined;
}): void {
  const parentStartLine = input.parentPosition?.start?.line;
  const visit = (node: MarkdownAstNode) => {
    const recoveredStart = node.position?.start;
    const recoveredEnd = node.position?.end;
    const remappedStart =
      node.type === "listItem" && recoveredStart && parentStartLine !== undefined
        ? remapRecoveredPoint({
            point: recoveredStart,
            recoveredLines: input.recoveredLines,
            parentLines: input.parentLines,
            parentStartLine,
          })
        : undefined;
    const remappedEnd =
      node.type === "listItem" && recoveredEnd && parentStartLine !== undefined
        ? remapRecoveredPoint({
            point: recoveredEnd,
            recoveredLines: input.recoveredLines,
            parentLines: input.parentLines,
            parentStartLine,
          })
        : undefined;
    if (remappedStart && remappedEnd) {
      node.position = { start: remappedStart, end: remappedEnd };
    } else {
      delete node.position;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  for (const block of input.blocks) {
    visit(block);
  }
}

/**
 * CommonMark treats four or more spaces after a list marker as an indented
 * code block. In chat output, excessive spacing is commonly accidental
 * alignment such as `-       text`, which otherwise produces a full code card
 * for every bullet. Only normalize blocks that retain excess indentation and
 * start on the marker's own line; explicit fences and conventional indented
 * blocks remain code.
 */
function attachListItemIndentationNormalizer(this: MarkdownParser) {
  return (tree: MarkdownAstNode, file: MarkdownFile) => {
    if (typeof file.value !== "string") {
      return;
    }
    const markdown = file.value;
    const indexedSources = new Map<string, readonly SourceLine[]>();
    const sourceLinesFor = (source: string): readonly SourceLine[] => {
      const cached = indexedSources.get(source);
      if (cached) {
        return cached;
      }
      const indexed = indexSourceLines(source);
      indexedSources.set(source, indexed);
      return indexed;
    };

    const visit = (node: MarkdownAstNode, source: string) => {
      if (!node.children) {
        return;
      }
      node.children = node.children.flatMap((child) => {
        if (isSameLineOverIndentedCode(child, node, source)) {
          const recovered = blocksFromIndentedCode(child, this);
          if (recovered.taskChecked !== undefined) {
            node.checked = recovered.taskChecked;
          }
          for (const block of recovered.blocks) {
            visit(block, recovered.source);
          }
          remapRecoveredListItemPositions({
            blocks: recovered.blocks,
            recoveredLines: sourceLinesFor(recovered.source),
            parentLines: sourceLinesFor(source),
            parentPosition: child.position,
          });
          return recovered.blocks;
        }
        visit(child, source);
        return [child];
      });
    };

    visit(tree, markdown);
  };
}

export const remarkNormalizeListItemIndentation = attachListItemIndentationNormalizer;
