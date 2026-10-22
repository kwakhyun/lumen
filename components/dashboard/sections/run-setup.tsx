"use client";
import { useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { DEMO_MODELS, type SiteState } from "@/lib/product-types";
import type { UsageStatus } from "@/lib/usage";
import { Button, Modal } from "../ui";
import { modelLabel, useResource } from "../client";

export default function RunSetup({ state, busy, error, defaultModel, preferredPromptId, onClose, onRun }: { state: SiteState; busy: boolean; error: string; defaultModel: string; preferredPromptId?: string; onClose: () => void; onRun: (promptIds: string[], models: string[]) => Promise<void> }) {
  const demo = state.site.mode === "demo";
  const availableModels = demo ? [...DEMO_MODELS] : state.providers.filter(provider => provider.configured && provider.available).map(provider => provider.model);
  const active = state.prompts.filter(prompt => prompt.active);
  const [models, setModels] = useState(defaultModel !== "all" && availableModels.includes(defaultModel) ? [defaultModel] : availableModels.slice(0, 1));
  const [promptIds, setPromptIds] = useState(() => preferredPromptId && active.some(prompt => prompt.id === preferredPromptId) ? [preferredPromptId] : active.slice(0, demo ? 12 : 1).map(prompt => prompt.id));
  // Only selections still available in the current workspace can reach the API.
  const selectedModels = models.filter(model => availableModels.includes(model));
  const selectedPromptIds = promptIds.filter(id => active.some(prompt => prompt.id === id)).slice(0, 20);
  const usage = useResource<UsageStatus>("/api/usage");
  const units = selectedModels.length * selectedPromptIds.length;
  const available = usage.data?.available ?? 0;
  const usageUnavailable = !demo && (usage.loading || Boolean(usage.error) || !usage.data);
  const canRun = !busy && units > 0 && !usageUnavailable && (demo || units <= available);
  const workspaceQuery = `?site=${encodeURIComponent(state.site.id)}`;

  return <Modal title={demo ? "샘플 답변 수집" : "답변 수집 설정"} subtitle={demo ? "생성된 샘플 데이터로 수집 과정을 체험할 수 있습니다. 실제 AI 사용량은 차감하지 않습니다." : "먼저 질문 하나로 시작해 보세요. Gemini API의 일반 응답을 수집하며 웹 검색이나 실시간 검증은 지원하지 않습니다."} onClose={onClose} dismissDisabled={busy} wide>
    <div className="d-form">
      <div className="d-form-row">
        <fieldset className="d-fieldset" disabled={busy}>
          <legend>AI 모델</legend>
          <div className="d-check-list">{availableModels.length ? availableModels.map(model => <label key={model}>
            <input type="checkbox" checked={selectedModels.includes(model)} onChange={event => setModels(value => event.target.checked ? [...new Set([...value, model])] : value.filter(item => item !== model))} />
            <span>{modelLabel(model)}<small>{demo ? "샘플 응답" : model === "gemini-3.8-flash" ? "웹 검색과 인용 출처 미지원" : "웹 검색 답변"}</small></span>
          </label>) : <div><p className="d-muted">현재 수집에 사용할 수 있는 AI 모델이 없어요.</p><a className="d-text-link" href={`/dashboard/connections${workspaceQuery}`}>모델 연결 상태 확인<ArrowRight size={16} /></a></div>}</div>
        </fieldset>
        <fieldset className="d-fieldset" disabled={busy}>
          <legend>수집할 질문 (활성 질문 {active.length}개)</legend>
          <div className="d-check-list d-check-list-scroll">{active.length ? active.map(prompt => <label key={prompt.id}>
            <input type="checkbox" checked={selectedPromptIds.includes(prompt.id)} disabled={!selectedPromptIds.includes(prompt.id) && selectedPromptIds.length >= 20} onChange={event => setPromptIds(value => event.target.checked ? [...new Set([...value, prompt.id])] : value.filter(id => id !== prompt.id))} />
            <span>{prompt.text}</span>
          </label>) : <div><p className="d-muted">수집할 질문이 없어요. 질문을 추가하거나 기존 질문의 추적을 켜 주세요.</p><a className="d-text-link" href={`/dashboard/prompts${workspaceQuery}`}>질문 관리로 이동<ArrowRight size={16} /></a></div>}</div>
        </fieldset>
      </div>
      <div className="d-rich-note"><Info size={18} /><span>{selectedPromptIds.length}개 질문 × {selectedModels.length}개 모델 = <strong>{units}개 답변</strong>. {demo ? "샘플 수집은 AI 사용량에 포함되지 않습니다." : usage.loading ? "남은 사용량을 확인하고 있어요." : usage.error ? "사용량을 확인한 뒤 수집을 시작할 수 있습니다." : usage.data ? `지금 ${available}회 사용할 수 있으며, 시작하면 ${units}회가 차감됩니다. 실패한 요청도 차감된 사용량은 복원되지 않습니다.` : "남은 사용량을 확인해 주세요."}</span></div>
      {!demo && !usageUnavailable && units > available && <div className="d-error" style={{ marginTop: 16 }} role="alert">{available === 0 ? "지금 사용할 수 있는 무료 요청이 없어요. 사용량 화면에서 내 한도와 서비스 공용 한도, 초기화 시간을 확인하세요." : `남은 사용량을 ${units - available}회 초과했어요. 질문이나 모델 수를 줄여 주세요.`}</div>}
      {!demo && !busy && <a className="d-text-link" href={`/dashboard/usage${workspaceQuery}`}>무료 사용량과 초기화 시간 확인<ArrowRight size={16} /></a>}
      {!demo && usage.error && <div className="d-error" style={{ marginTop: 16, flexWrap: "wrap" }} role="alert"><p style={{ flex: "1 1 180px", minWidth: 0 }}>{usage.error}</p><Button onClick={() => void usage.refresh()} disabled={busy} busy={usage.loading}>사용량 다시 확인</Button></div>}
      {error && <div className="d-error" style={{ marginTop: 16 }} role="alert">{error}</div>}
      {!units && active.length > 0 && availableModels.length > 0 && <p className="d-muted" role="status">AI 모델과 질문을 하나 이상 선택하세요.</p>}
      <div className="d-form-actions"><Button onClick={onClose} disabled={busy}>취소</Button><Button variant="primary" busy={busy} disabled={!canRun} onClick={() => { if (canRun) void onRun(selectedPromptIds, selectedModels); }}>수집 시작<ArrowRight size={16} /></Button></div>
    </div>
  </Modal>;
}
