"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Only explicit web URLs may be opened from provider-authored text. */
export function safeMarkdownUrl(value: string): string {
  const candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate) || /[\u0000-\u001f\u007f]/.test(candidate)) return "";
  try {
    const url = new URL(candidate);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

const components: Components = {
  a: ({ href, children, title }) => {
    const safe = safeMarkdownUrl(href || "");
    return safe ? <a href={safe} title={title} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a> : <span>{children}</span>;
  },
  // A generated response must not load remote images or tracking pixels.
  img: ({ alt }) => alt ? <span className="d-markdown-image-alt">[이미지: {alt}]</span> : null,
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  table: ({ children }) => <div className="d-markdown-table"><table>{children}</table></div>,
};

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } };
export type BrandHighlight = { own: string[]; others: string[] };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks tracked brand names in prose. Links and code are left as written. */
function remarkBrandMarks(terms: BrandHighlight) {
  const own = new Set(terms.own.map(term => term.toLowerCase()));
  const names = [...new Set([...terms.own, ...terms.others].map(term => term.trim()).filter(term => term.length > 1))].sort((a, b) => b.length - a.length);
  const pattern = names.length ? new RegExp(`(${names.map(escapeRegExp).join("|")})`, "gi") : null;
  const walk = (node: MdNode) => {
    if (!node.children || !pattern || node.type === "link" || node.type === "code") return;
    node.children = node.children.flatMap(child => {
      if (child.type !== "text" || typeof child.value !== "string") { walk(child); return [child]; }
      return child.value.split(pattern).filter(Boolean).map((part): MdNode => names.some(name => name.toLowerCase() === part.toLowerCase())
        ? { type: "strong", data: { hName: "mark", hProperties: { className: ["d-mention", ...(own.has(part.toLowerCase()) ? ["d-mention-own"] : [])] } }, children: [{ type: "text", value: part }] }
        : { type: "text", value: part });
    });
  };
  return () => (tree: MdNode) => { walk(tree); };
}

export default function MarkdownContent({ children, className = "", highlight }: { children: string; className?: string; highlight?: BrandHighlight }) {
  // No rehype-raw or HTML injection: raw HTML remains escaped text.
  return <div className={`d-markdown ${className}`}><ReactMarkdown remarkPlugins={highlight ? [remarkGfm, remarkBrandMarks(highlight)] : [remarkGfm]} urlTransform={safeMarkdownUrl} components={components}>{children}</ReactMarkdown></div>;
}
