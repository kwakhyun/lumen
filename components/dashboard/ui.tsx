"use client";

import { cloneElement, useEffect, useRef, useId, useState, type ReactElement, type ReactNode } from "react";
import { csvCell } from "@/lib/metrics";
import { ArrowDownToLine, ArrowRight, Loader2, X, Inbox } from "lucide-react";

export function Button({ children, className = "", variant = "default", busy = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "quiet" | "danger"; busy?: boolean }) {
  return <button type="button" {...props} disabled={props.disabled || busy} className={`d-button d-button-${variant} ${className}`}>{busy ? <Loader2 size={15} className="d-spin" /> : null}{children}</button>;
}
export function Panel({ children, className = "", title, subtitle, action }: { children: ReactNode; className?: string; title?: string; subtitle?: string; action?: ReactNode }) {
  return <section className={`d-panel ${className}`}>{title ? <header className="d-panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header> : null}{children}</section>;
}
export function Empty({ title, text, action, icon }: { title: string; text: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="d-empty"><span className="d-empty-icon">{icon || <Inbox size={24} strokeWidth={1.4} />}</span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Modal({ title, subtitle, children, onClose, wide = false, dismissDisabled = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; dismissDisabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const dismissDisabledRef = useRef(dismissDisabled);
  useEffect(() => { closeRef.current = onClose; dismissDisabledRef.current = dismissDisabled; }, [onClose, dismissDisabled]);
  useEffect(() => {
    const active = document.activeElement as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = ref.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex="0"]') || []).filter(element => !element.matches(':disabled') && !element.closest('[inert], [hidden]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    (dialog?.querySelector<HTMLElement>("[data-autofocus]") || focusables()[0] || dialog)?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!dismissDisabledRef.current) closeRef.current(); }
      if (event.key === "Tab") {
        const items = focusables(); const first = items[0]; const last = items.at(-1);
        if (!items.length) { event.preventDefault(); dialog?.focus({ preventScroll: true }); }
        else if (!dialog?.contains(document.activeElement) || document.activeElement === dialog) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = previous; if (active?.isConnected) active.focus({ preventScroll: true }); };
  }, []);
  return <div className="d-modal-backdrop" onMouseDown={event => { if (!dismissDisabled && event.currentTarget === event.target) onClose(); }}><div ref={ref} tabIndex={-1} className={`d-modal ${wide ? "d-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header className="d-modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="d-icon-button" onClick={onClose} disabled={dismissDisabled} aria-label="닫기"><X size={20} /></button></header>{children}</div></div>;
}
type FieldControl = ReactElement<{ id?: string; "aria-describedby"?: string }, "input" | "select" | "textarea">;

/** One native control per field. Keep its own ID, ref, handlers and description IDs. */
export function Field({ label, children, hint }: { label: string; children: FieldControl; hint?: string }) {
  const generatedId = useId();
  const controlId = children.props.id || `field-${generatedId}`;
  const hintId = `field-hint-${generatedId}`;
  const descriptionIds = [children.props["aria-describedby"], hint ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="d-field">
    <label htmlFor={controlId}>{label}</label>
    {cloneElement(children, { id: controlId, "aria-describedby": descriptionIds })}
    {hint && <small id={hintId}>{hint}</small>}
  </div>;
}
export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "green" | "gray" | "amber" | "purple" | "blue" }) { return <span className={`d-badge d-badge-${tone}`}>{children}</span>; }
export function Skeleton() { return <div className="d-loading" aria-label="데이터 불러오는 중"><div className="d-skeleton d-skeleton-title" /><div className="d-grid-4">{[1, 2, 3, 4].map(n => <div key={n} className="d-skeleton d-skeleton-card" />)}</div><div className="d-skeleton d-skeleton-chart" /></div>; }
export function downloadFile(filename: string, text: string, type = "text/plain;charset=utf-8") { const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function csvFile(filename: string, rows: (string | number | null | undefined)[][]) { downloadFile(filename, "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8"); }
export function ExportButton({ onClick }: { onClick: () => void }) { return <Button onClick={onClick}><ArrowDownToLine size={14} />내보내기</Button>; }
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button type="button" className="d-text-link" onClick={onClick}>{children}<ArrowRight size={14} /></button>; }
export function dateLabel(value: string) { return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); }
export function numberLabel(value: number) { return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value); }
export const colors = ["var(--lumen-chart-1)", "var(--lumen-chart-2)", "var(--lumen-chart-3)", "var(--lumen-chart-4)", "var(--lumen-chart-5)", "var(--lumen-muted)"];
export function TrendChart({ data, label = "가시성", suffix = "%" }: { data: { date: string; value: number }[]; label?: string; suffix?: string }) {
  const gradientId = useId().replaceAll(":", "");
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const measure = () => setWidth(Math.max(280, Math.round(plot.getBoundingClientRect().width)));
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    const frame = requestAnimationFrame(measure);
    observer.observe(plot);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const height = 244, pad = 12, floor = 206;
  const max = suffix === "%" ? 100 : Math.max(4, ...data.map(d => d.value));
  const points = data.map((d, i) => ({ ...d, x: 48 + (i / Math.max(data.length - 1, 1)) * (width - 66), y: floor - d.value / max * (floor - pad) }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const labelCount = Math.min(data.length, width < 480 ? 3 : 6);
  const labelIndices = new Set(Array.from({ length: labelCount }, (_, i) => Math.round(i * (data.length - 1) / Math.max(1, labelCount - 1))));
  const axisLabel = (value: number) => suffix === "%" ? `${Math.round(value)}%` : new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return <div className="d-chart">
    <div className="d-chart-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`${label} 추이, ${data.length}일`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--lumen-accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--lumen-accent)" stopOpacity=".01" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map(p => <g key={p}><line x1="48" x2={width - 18} y1={floor - p * (floor - pad)} y2={floor - p * (floor - pad)} stroke="var(--lumen-border)" strokeDasharray="3 4" /><text x="0" y={floor - p * (floor - pad) + 4} fill="var(--lumen-muted)" fontSize="12">{axisLabel(p * max)}</text></g>)}
        {points.length > 0 && <><path d={`${line} L${points.at(-1)!.x},${floor} L${points[0].x},${floor} Z`} fill={`url(#${gradientId})`} /><path d={line} fill="none" stroke="var(--lumen-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{points.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="3" fill="var(--lumen-accent)"><title>{`${dateLabel(p.date)}: ${numberLabel(p.value)}${suffix}`}</title></circle>{labelIndices.has(i) && <text x={p.x} y="236" fill="var(--lumen-muted)" fontSize="12" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{dateLabel(p.date)}</text>}</g>)}</>}
      </svg>
    </div>
    <details className="d-chart-data"><summary>차트 데이터 보기</summary><table className="d-table"><thead><tr><th>날짜</th><th>{label}</th></tr></thead><tbody>{data.map((point, i) => <tr key={`${point.date}-${i}`}><td>{dateLabel(point.date)}</td><td>{numberLabel(point.value)}{suffix}</td></tr>)}</tbody></table></details>
  </div>;
}
