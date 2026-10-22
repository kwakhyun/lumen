"use client";
import { useRef, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Button, Modal } from "./ui";
import { requestJson, useResource } from "./client";

type Eligibility = { eligible: boolean; version: string; acceptedAt: string | null };
type AiAction = () => void | Promise<void>;
export type RequestAiAction = (action: AiAction) => void;

export function useAiEligibility(sample: boolean) {
  const resource = useResource<Eligibility>("/api/eligibility");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checks, setChecks] = useState({ adult: false, korea: false, business: false, understandsDataUse: false });
  const pending = useRef<AiAction | null>(null);
  const request: RequestAiAction = action => {
    if (sample || resource.data?.eligible) { void action(); return; }
    pending.current = action; setError(""); setOpen(true);
  };
  const close = () => { pending.current = null; setOpen(false); };
  async function accept() {
    if (!Object.values(checks).every(Boolean)) return;
    setBusy(true); setError("");
    try {
      const result = await requestJson<Eligibility>("/api/eligibility", "POST", checks);
      if (!result.eligible) throw new Error("이용 조건 동의를 저장하지 못했어요. 다시 시도해 주세요.");
      resource.setData(result); setOpen(false);
      const action = pending.current; pending.current = null;
      if (action) await action();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const notices = [
    ["adult", "만 18세 이상입니다."],
    ["korea", "현재 대한민국에서 이 서비스를 이용합니다."],
    ["business", "브랜드 운영이나 분석 등 업무 목적으로 이용합니다."],
    ["understandsDataUse", "무료 Gemini API의 입력과 응답이 Google의 제품 개선 및 인적 검토에 사용될 수 있음을 이해하며, 개인정보와 민감정보, 기밀정보를 입력하지 않겠습니다."],
  ] as const;
  const banner = !sample && !resource.data?.eligible ? <div className="d-rich-note d-eligibility-note"><Info size={18} /><div><strong>AI 기능을 사용하려면 이용 조건에 동의해 주세요.</strong><p>AI 기능은 한국에서 업무 목적으로 이용하는 만 18세 이상 사용자에게 제공됩니다. 이용 조건에 동의하기 전에도 저장된 데이터 조회와 내보내기는 사용할 수 있습니다.</p>{resource.error && <p role="alert">{resource.error}</p>}</div><Button onClick={() => { pending.current = null; setOpen(true); }}>조건 확인<ArrowRight size={16} /></Button></div> : null;
  const dialog = open ? <Modal title="무료 AI 이용 조건" subtitle="Gemini API의 일반 응답을 수집합니다. 웹 검색이나 실시간 검증은 지원하지 않습니다." onClose={close} dismissDisabled={busy}><div className="d-form"><div className="d-eligibility-checks">{notices.map(([key, label]) => <label className="d-checkbox-label" key={key}><input type="checkbox" disabled={busy} checked={checks[key]} onChange={event => setChecks(values => ({ ...values, [key]: event.target.checked }))} /><span>{label}</span></label>)}</div><p className="d-field-hint"><a href="/privacy" target="_blank" rel="noopener noreferrer">개인정보 처리 안내</a>와 <a href="/terms" target="_blank" rel="noopener noreferrer">이용 안내</a>에서 자세한 내용을 확인할 수 있습니다. 동의 내역은 로그인한 계정에 저장됩니다.</p>{error && <div className="d-error" role="alert">{error}</div>}<div className="d-form-actions"><Button onClick={close} disabled={busy}>나중에</Button><Button variant="primary" onClick={accept} busy={busy} disabled={!Object.values(checks).every(Boolean)}>동의하고 계속<ArrowRight size={16} /></Button></div></div></Modal> : null;
  return { request, banner, dialog };
}
