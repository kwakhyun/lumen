import { useId } from 'react';

/**
 * Lumen mark: an open ring (what AI answers cover) with a spark breaking through the gap
 * (the brand becoming visible). Drawn on a 32-unit grid so it stays legible at 16px.
 */
export function LumenMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  // Several marks can share a page, so each one gets its own gradient id.
  const fill = useId();
  return <svg className={className} width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
    <defs><linearGradient id={fill} x1="3" y1="29" x2="29" y2="3" gradientUnits="userSpaceOnUse"><stop stopColor="#4b47e5" /><stop offset=".55" stopColor="#8b5cf6" /><stop offset="1" stopColor="#e0489f" /></linearGradient></defs>
    <rect width="32" height="32" rx="9" fill={`url(#${fill})`} />
    <circle cx="15" cy="17" r="7.6" fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeDasharray="34 13.75" transform="rotate(6 15 17)" />
    <path d="M22 4.8c.45 3.1 2.1 4.75 5.2 5.2-3.1.45-4.75 2.1-5.2 5.2-.45-3.1-2.1-4.75-5.2-5.2 3.1-.45 4.75-2.1 5.2-5.2Z" fill="#fff" />
  </svg>;
}

/** Mark plus lowercase wordmark. The wordmark inherits color and font from its container. */
export function LumenLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <span className={`lumen-logo ${className}`}><LumenMark size={size} /><span className="lumen-wordmark">lumen</span></span>;
}
