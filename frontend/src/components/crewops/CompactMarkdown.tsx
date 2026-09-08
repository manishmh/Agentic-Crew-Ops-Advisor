import { Fragment } from "react";
import type { InlineMarkdown } from "./compactMarkdown";
import { parseCompactMarkdown } from "./compactMarkdown";

function InlineContent({ nodes }: { nodes: InlineMarkdown[] }) {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    if (node.type === "strong") return <strong key={key}>{node.text}</strong>;
    if (node.type === "emphasis") return <em key={key}>{node.text}</em>;
    if (node.type === "code") return <code key={key}>{node.text}</code>;
    return <Fragment key={key}>{node.text}</Fragment>;
  });
}

/** A deliberately small Markdown subset. Model HTML is always rendered as text. */
export function CompactMarkdown({ source }: { source: string }) {
  return (
    <div className="analysis-summary compact-markdown" data-testid="natural-language-answer">
      {parseCompactMarkdown(source).map((block, blockIndex) => {
        if (block.type === "paragraph") {
          return <p key={blockIndex}>{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}><InlineContent nodes={line} />{lineIndex < block.lines.length - 1 && <br />}</Fragment>)}</p>;
        }
        const List = block.type === "ordered-list" ? "ol" : "ul";
        return <List key={blockIndex}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent nodes={item} /></li>)}</List>;
      })}
    </div>
  );
}
