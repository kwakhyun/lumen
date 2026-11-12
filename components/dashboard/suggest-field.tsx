"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SuggestField as FieldKind } from "@/lib/suggest";
import { requestJson } from "./client";

type Shared = {
  /** Workspace the suggestion is written for. Without it the field behaves like a plain one. */
  siteId?: string;
  field: FieldKind;
  /** Controlled value. Leave out, with `defaultValue`, for a field read through its form. */
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  /** Text from a neighbouring field that the suggestion should fit, read when asking. */
  getContext?: () => string;
};
type InputProps = Shared & { as?: "input" } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange">;
type AreaProps = Shared & { as: "textarea" } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange">;

const MIRRORED = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "textAlign"] as const;
const TYPING_PAUSE_MS = 450, LONGEST_TYPED = 300;

/**
 * A text field with an inline suggestion: faint text continues what has been typed, and Tab
 * (or the small Tab button, for touch) takes it. Escape puts it away. The suggestion is drawn
 * by a mirror element that copies the field's own text metrics, so it lines up in any form.
 */
export default function SuggestField(props: InputProps | AreaProps) {
  const { siteId, field, value, onValueChange, defaultValue = "", getContext, as = "input", onKeyDown, onFocus, onBlur, placeholder, className, ...rest } = props as AreaProps;
  const [inner, setInner] = useState(defaultValue);
  const typed = value ?? inner;
  const [offer, setOffer] = useState<{ text: string; more: string } | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const control = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, string>());
  const latest = useRef(0);
  const hintId = useId();
  const more = focused && offer?.text === typed && dismissed !== typed ? offer.more : "";

  const change = (next: string) => { if (value === undefined) setInner(next); onValueChange?.(next); };
  const accept = () => { if (more) { change(typed + more); control.current?.focus(); } };

  // Ask once typing pauses. Stale replies are dropped, and each text is only asked for once.
  useEffect(() => {
    if (!siteId || !focused || typed.length > LONGEST_TYPED) return;
    const known = cache.current.get(typed);
    const ticket = ++latest.current;
    const timer = window.setTimeout(async () => {
      let reply = known;
      if (reply === undefined) {
        try { reply = (await requestJson<{ suggestion: string }>(`/api/sites/${siteId}/suggest`, "POST", { field, text: typed, context: getContext?.().slice(0, 300) || undefined })).suggestion || ""; }
        catch { reply = ""; }
        cache.current.set(typed, reply);
      }
      if (ticket === latest.current) setOffer({ text: typed, more: reply });
    }, known === undefined ? TYPING_PAUSE_MS : 0);
    return () => window.clearTimeout(timer);
    // getContext is read at request time on purpose; a new function identity must not re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, field, typed, focused]);

  // The mirror takes the field's text metrics so the suggestion sits exactly after the caret text.
  useLayoutEffect(() => {
    const source = control.current, target = ghost.current;
    if (!source || !target) return;
    const copy = () => { const style = getComputedStyle(source); for (const key of MIRRORED) target.style[key] = style[key]; target.style.borderStyle = "solid"; target.style.borderColor = "transparent"; };
    copy();
    window.addEventListener("resize", copy);
    return () => window.removeEventListener("resize", copy);
  }, [as]);

  const shared = {
    ...rest,
    ref: control,
    className,
    value: typed,
    placeholder: more && !typed ? "" : placeholder,
    "aria-describedby": [rest["aria-describedby"], more ? hintId : ""].filter(Boolean).join(" ") || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDismissed(null); change(event.target.value); },
    onFocus: (event: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => { setFocused(true); onFocus?.(event); },
    onBlur: (event: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => { setFocused(false); onBlur?.(event); },
    onScroll: (event: React.UIEvent<HTMLElement>) => { if (ghost.current) ghost.current.scrollTop = event.currentTarget.scrollTop; },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      if (more && !event.nativeEvent.isComposing) {
        if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); accept(); return; }
        if (event.key === "Escape") { event.stopPropagation(); setDismissed(typed); return; }
      }
      onKeyDown?.(event);
    },
  };

  return <span className="d-suggest" data-multiline={as === "textarea" ? "" : undefined}>
    {as === "textarea" ? <textarea {...shared} /> : <input {...(shared as unknown as React.InputHTMLAttributes<HTMLInputElement>)} ref={control} />}
    <span className="d-suggest-ghost" ref={ghost} aria-hidden="true"><span className="d-suggest-typed">{typed}</span><span className="d-suggest-more">{more}</span></span>
    {more && <>
      <button type="button" tabIndex={-1} className="d-suggest-hint" aria-label="추천 문구 입력" onMouseDown={event => { event.preventDefault(); accept(); }}>Tab</button>
      <span id={hintId} className="d-sr-only">추천 문구: {more}. Tab 키로 입력하고 Esc 키로 닫을 수 있어요.</span>
    </>}
  </span>;
}
