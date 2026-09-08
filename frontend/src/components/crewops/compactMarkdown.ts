export type InlineMarkdown = {
  type: "text" | "strong" | "emphasis" | "code";
  text: string;
};

export type MarkdownBlock =
  | { type: "paragraph"; lines: InlineMarkdown[][] }
  | { type: "unordered-list" | "ordered-list"; items: InlineMarkdown[][] };

const inlinePattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

export function parseInlineMarkdown(value: string): InlineMarkdown[] {
  const result: InlineMarkdown[] = [];
  let cursor = 0;
  for (const match of value.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push({ type: "text", text: value.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      result.push({ type: "strong", text: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      result.push({ type: "code", text: token.slice(1, -1) });
    } else {
      result.push({ type: "emphasis", text: token.slice(1, -1) });
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) result.push({ type: "text", text: value.slice(cursor) });
  return result;
}

export function parseCompactMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index]?.trim()) {
      index += 1;
      continue;
    }
    const unordered = lines[index]?.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = lines[index]?.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const type = unordered ? "unordered-list" : "ordered-list";
      const items: InlineMarkdown[][] = [];
      while (index < lines.length) {
        const item = type === "unordered-list"
          ? lines[index]?.match(/^\s*[-+*]\s+(.+)$/)
          : lines[index]?.match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(parseInlineMarkdown(item[1] ?? ""));
        index += 1;
      }
      blocks.push({ type, items });
      continue;
    }
    const paragraph: InlineMarkdown[][] = [];
    while (index < lines.length && lines[index]?.trim()) {
      if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index] ?? "") && paragraph.length) break;
      paragraph.push(parseInlineMarkdown(lines[index] ?? ""));
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }
  return blocks;
}
