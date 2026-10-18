"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { csvCell } from "@/lib/metrics";
import { ArrowDownToLine, ArrowRight, Loader2, X, Inbox } from "lucide-react";

export function Button({ children, className = "", variant = "default", busy = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "quiet" | "danger"; busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} className={`d-button d-button-${variant} ${className}`}>{busy ? <Loader2 size={15} className="d-spin" /> : null}{children}</button>;
}
export function Panel({ children, className = "", title, subtitle, action }: { children: ReactNode; className?: string; title?: string; subtitle?: string; action?: ReactNode }) {
  return <section className={`d-panel ${className}`}>{title ? <header className="d-panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header> : null}{children}</section>;
}
export function Empty({ title, text, action, icon }: { title: string; text: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="d-empty"><span className="d-empty-icon">{icon || <Inbox size={24} strokeWidth={1.4} />}</span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const active = document.activeElement as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = ref.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]') || []).filter(e => !e.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") { const items = focusables(); const first = items[0]; const last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = previous; active?.focus(); };
  }, []);
  return <div className="d-modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}><div ref={ref} className={`d-modal ${wide ? "d-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header className="d-modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="d-icon-button" onClick={onClose} aria-label="닫기"><X size={20} /></button></header>{children}</div></div>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="d-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "green" | "gray" | "amber" | "purple" }) { return <span className={`d-badge d-badge-${tone}`}>{children}</span>; }
export function Skeleton() { return <div className="d-loading" aria-label="데이터 불러오는 중"><div className="d-skeleton d-skeleton-title" /><div className="d-grid-4">{[1, 2, 3, 4].map(n => <div key={n} className="d-skeleton d-skeleton-card" />)}</div><div className="d-skeleton d-skeleton-chart" /></div>; }
export function downloadFile(filename: string, text: string, type = "text/plain;charset=utf-8") { const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function csvFile(filename: string, rows: (string | number | null | undefined)[][]) { downloadFile(filename, "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8"); }
export function ExportButton({ onClick }: { onClick: () => void }) { return <Button onClick={onClick}><ArrowDownToLine size={14} />내보내기</Button>; }
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="d-text-link" onClick={onClick}>{children}<ArrowRight size={14} /></button>; }
export function dateLabel(value: string) { return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); }
export function numberLabel(value: number) { return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value); }
export const colors = ["#157c70", "#a7c9ba", "#8e91ba", "#c6a87b", "#8db1c5", "#b7bcbd"];
export function TrendChart({ data, label = "가시성", suffix = "%" }: { data: { date: string; value: number }[]; label?: string; suffix?: string }) {
  const width = 760, height = 214, pad = 12, floor = 180; const max = suffix === "%" ? 100 : Math.max(1, ...data.map(d => d.value));
  const points = data.map((d, i) => ({ ...d, x: 40 + (i / Math.max(data.length - 1, 1)) * (width - 60), y: floor - d.value / max * (floor - pad) }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return <div className="d-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} 추이, ${data.length}일`}><defs><linearGradient id="lumen-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#157c70" stopOpacity=".18" /><stop offset="100%" stopColor="#157c70" stopOpacity=".01" /></linearGradient></defs>{[0, .25, .5, .75, 1].map(p => <g key={p}><line x1="40" x2={width - 20} y1={floor - p * (floor - pad)} y2={floor - p * (floor - pad)} stroke="#ebeeed" strokeDasharray="3 4" /><text x="0" y={floor - p * (floor - pad) + 4} fill="#96a09d" fontSize="10">{Math.round(p * max)}{suffix}</text></g>)}{points.length > 0 && <><path d={`${line} L${points.at(-1)!.x},${floor} L${points[0].x},${floor} Z`} fill="url(#lumen-chart-fill)" /><path d={line} fill="none" stroke="#157c70" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{points.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="3" fill="#157c70"><title>{dateLabel(p.date)}: {numberLabel(p.value)}{suffix}</title></circle>{(i === 0 || i === points.length - 1 || i % Math.max(1, Math.ceil(points.length / 6)) === 0) && <text x={p.x} y="207" fill="#96a09d" fontSize="10" textAnchor="middle">{dateLabel(p.date)}</text>}</g>)}</>}</svg></div>;
}
