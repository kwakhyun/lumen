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

export default function MarkdownContent({ children, className = "" }: { children: string; className?: string }) {
  // No rehype-raw or HTML injection: raw HTML remains escaped text.
  return <div className={`d-markdown ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={components}>{children}</ReactMarkdown></div>;
}
