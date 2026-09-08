import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCompactMarkdown } from "../frontend/src/components/crewops/compactMarkdown.js";

function visibleText(markdown: string): string {
  return parseCompactMarkdown(markdown).flatMap(block => {
    const rows = block.type === "paragraph" ? block.lines : block.items;
    return rows.map(row => row.map(node => node.text).join(""));
  }).join("\n");
}

describe("compact natural-language answer Markdown", () => {
  test("renders bold operational labels without visible Markdown markers", () => {
    const input = "**Impact**: Flight DX412 delayed.\n\n**Recommendation**: Use recovery option C-2210.";
    const blocks = parseCompactMarkdown(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(blocks[1]?.type).toBe("paragraph");
    if (blocks[0]?.type !== "paragraph" || blocks[1]?.type !== "paragraph") throw new Error("Expected paragraphs");
    expect(blocks[0].lines[0]?.[0]).toEqual({ type: "strong", text: "Impact" });
    expect(blocks[1].lines[0]?.[0]).toEqual({ type: "strong", text: "Recommendation" });
    expect(visibleText(input)).toContain("Impact: Flight DX412 delayed.");
    expect(visibleText(input)).toContain("Recommendation: Use recovery option C-2210.");
    expect(visibleText(input)).not.toContain("**");
  });

  test("supports compact lists, emphasis, inline code and explicit line breaks", () => {
    const blocks = parseCompactMarkdown("*why* and `RULE-FDP-01`\nnext line\n\n- one\n- two\n\n1. first\n2. second");
    expect(blocks.map(block => block.type)).toEqual(["paragraph", "unordered-list", "ordered-list"]);
    expect(blocks[0]).toMatchObject({ lines: [[{ type: "emphasis", text: "why" }, { type: "text", text: " and " }, { type: "code", text: "RULE-FDP-01" }], [{ type: "text", text: "next line" }]] });
  });

  test("keeps raw HTML as escaped React text and enables no raw-HTML path", () => {
    const raw = '<img src=x onerror="globalThis.pwned=true"> **Impact**';
    expect(parseCompactMarkdown(raw)[0]).toMatchObject({ lines: [[{ type: "text", text: '<img src=x onerror="globalThis.pwned=true"> ' }, { type: "strong", text: "Impact" }]] });
    const componentSource = readFileSync(new URL("../frontend/src/components/crewops/CompactMarkdown.tsx", import.meta.url), "utf8");
    expect(componentSource).not.toMatch(/dangerouslySetInnerHTML|rehype-raw|rehypeRaw/);
  });
});
