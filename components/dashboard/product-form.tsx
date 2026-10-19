"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { normalizeDomain } from "@/lib/metrics";
import type { Competitor, Persona, Prompt, Site, Task } from "@/lib/product-types";
import { intentNames } from "./prompt-evidence";
import { Button, Field, Modal } from "./ui";

export type FormKind = "site" | "prompt" | "competitor" | "content" | "report" | "task" | "persona";
export type EditItem = Site | Prompt | Competitor | Task | Persona;

export default function ProductForm({ kind, edit, busy, onClose, onSubmit, demo }: { kind: FormKind; edit: EditItem | null; busy: boolean; onClose: () => void; onSubmit: (values: Record<string, unknown>) => Promise<void>; demo?: boolean }) {
  const titles = { site: "브랜드 워크스페이스", prompt: "추적할 질문", competitor: "경쟁 브랜드", content: "콘텐츠 초안", report: "분석 리포트", task: "개선 작업", persona: "고객 페르소나" }; const initial = (key: string, fallback = "") => String((edit as unknown as Record<string, unknown>)?.[key] ?? fallback); const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const element = event.currentTarget;
    const data = Object.fromEntries(new FormData(element));
    const values: Record<string, unknown> = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    const issues: Record<string, string> = {};
    if (kind === "site" || kind === "competitor") {
      if (String(values.name).length < 2) issues.name = "브랜드 이름을 두 글자 이상 입력해 주세요.";
      const domain = normalizeDomain(String(values.domain));
      if (!domain) issues.domain = "example.com처럼 공개 웹사이트의 주소를 입력해 주세요.";
      else values.domain = domain;
    }
    if (kind === "prompt") {
      if (String(values.text).length < 5) issues.text = "질문을 다섯 글자 이상 입력해 주세요.";
      values.active = data.active === "on";
      if (!values.topic) values.topic = "일반";
    }
    setError(""); setFieldErrors(issues);
    const firstIssue = Object.keys(issues)[0];
    if (firstIssue) { (element.elements.namedItem(firstIssue) as HTMLElement | null)?.focus(); return; }
    try { await onSubmit(values); } catch (cause) { setError((cause as Error).message); }
  }
  return <Modal title={kind === "site" && !edit ? "브랜드 등록" : `${titles[kind]} ${edit ? "편집" : kind === "content" || kind === "report" ? "만들기" : "추가"}`} subtitle={kind === "site" ? "브랜드별로 질문과 답변을 모을 공간을 만듭니다. 이름과 웹사이트만 입력하면 됩니다." : kind === "prompt" ? "고객이 AI에 물을 만한 질문을 적어 주세요. 저장만으로 AI가 호출되지는 않습니다." : kind === "content" || kind === "report" ? demo ? "샘플 데이터로 예시 문서를 생성합니다." : "수집된 답변을 참고해 작성합니다. 생성에 잠시 시간이 걸릴 수 있어요." : undefined} onClose={onClose} dismissDisabled={busy}><form className="d-form" onSubmit={submit}><fieldset className="d-form-fields" disabled={busy}>
    {!demo && <p className="d-field-hint">공개된 업무 정보만 입력하세요. 개인정보와 민감정보, 기밀정보는 입력하지 마세요. AI 기능을 사용할 때 관련 입력이 무료 Gemini API로 전달될 수 있습니다.</p>}
    {kind === "site" && <>
      <Field label="브랜드 이름 (필수)" hint={fieldErrors.name}><input data-autofocus name="name" required minLength={2} maxLength={100} placeholder="예: 루멘" defaultValue={initial("name")} aria-invalid={Boolean(fieldErrors.name)} /></Field>
      <Field label="웹사이트 주소 (필수)" hint={fieldErrors.domain || "예: example.com 또는 https://example.com/product. 입력한 주소에서 도메인만 저장해요."}><input name="domain" required maxLength={253} placeholder="예: example.com" defaultValue={initial("domain")} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(fieldErrors.domain)} /></Field>
      <details className="d-form-optional" open={edit ? true : undefined}><summary>추가 정보 (선택)</summary><p className="d-field-hint">나중에 브랜드 설정에서 수정할 수 있어요. 기본 분석 언어는 한국어, 대상 국가는 대한민국입니다.</p>
        <Field label="제품 설명 (선택)"><textarea name="description" maxLength={2000} placeholder="제품이 해결하는 문제와 주요 고객을 설명해 주세요." defaultValue={initial("description")} /></Field>
        <Field label="제품 분야 (선택)"><input name="industry" maxLength={100} placeholder="예: 프로젝트 관리 소프트웨어" defaultValue={initial("industry")} /></Field>
        <div className="d-form-row"><Field label="답변 언어"><select name="language" defaultValue={({ ko: "한국어", en: "English", ja: "日本語" } as Record<string, string>)[initial("language")] || initial("language", "한국어")}><option value="한국어">한국어</option><option value="English">English</option><option value="日本語">日本語</option></select></Field><Field label="대상 국가"><select name="country" defaultValue={initial("country", "KR")}><option value="KR">대한민국</option><option value="US">미국</option><option value="JP">일본</option><option value="GB">영국</option></select></Field></div>
      </details>
    </>}
    {kind === "prompt" && <>
      <Field label="고객의 질문 (필수)" hint={fieldErrors.text || "브랜드를 먼저 지정하지 않고 물으면 어떤 브랜드가 자연스럽게 추천되는지 살펴볼 수 있어요."}><textarea data-autofocus name="text" required minLength={5} maxLength={1000} placeholder="예: 작은 디자인 팀에 적합한 프로젝트 관리 도구를 추천해 주세요." defaultValue={initial("text")} aria-invalid={Boolean(fieldErrors.text)} /></Field>
      <details className="d-form-optional" open={edit ? true : undefined}><summary>분류와 수집 설정 (선택)</summary><div className="d-form-row"><Field label="주제 (선택)"><input name="topic" maxLength={80} placeholder="예: 팀 협업" defaultValue={initial("topic")} /></Field><Field label="질문 의도"><select name="intent" defaultValue={initial("intent", "comparison")}>{Object.entries(intentNames).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></Field></div><label className="d-checkbox-label"><input name="active" type="checkbox" defaultChecked={edit ? (edit as Prompt).active : true} />답변 수집에 사용</label><p className="d-field-hint">수집할 때 선택할 수 있도록 질문을 활성화합니다. 자동 수집 일정은 별도로 설정해야 해요.</p></details>
    </>}
    {kind === "competitor" && <><Field label="브랜드 이름"><input name="name" required minLength={2} maxLength={100} placeholder="비교할 브랜드 이름" defaultValue={initial("name")} /></Field><Field label="웹사이트 도메인"><input name="domain" required maxLength={200} placeholder="예: example.com" defaultValue={initial("domain")} autoCapitalize="none" /></Field></>}
    {(kind === "content" || kind === "report") && <><Field label={kind === "content" ? "작성할 주제" : "리포트의 초점"}><textarea name="topic" required minLength={3} maxLength={500} placeholder={kind === "content" ? "예: 디자인 팀이 협업 도구를 선택할 때 확인할 5가지 기준" : "예: 브랜드 언급 현황, 경쟁사 비교와 개선할 콘텐츠"} /></Field><Field label="문서 형식"><select name="format" defaultValue={kind === "report" ? "report" : "article"}>{kind === "content" ? <><option value="article">블로그 아티클</option><option value="faq">질문과 답변 (FAQ)</option><option value="comparison">비교 가이드</option><option value="how-to">활용 가이드</option><option value="listicle">목록형 콘텐츠</option></> : <><option value="report">성과 분석 리포트</option></>}</select></Field></>}
    {kind === "task" && <><Field label="작업 이름"><input name="title" required minLength={3} maxLength={200} placeholder="예: 제품 비교 페이지에 실제 사용 사례 추가" defaultValue={initial("title")} /></Field><Field label="작업 설명"><textarea name="description" maxLength={2000} placeholder="왜 필요한지, 무엇을 완료하면 되는지 기록하세요." defaultValue={initial("description")} /></Field><div className="d-form-row"><Field label="우선순위"><select name="priority" defaultValue={initial("priority", "medium")}><option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option></select></Field><Field label="상태"><select name="status" defaultValue={initial("status", "todo")}><option value="todo">시작 전</option><option value="in_progress">진행 중</option><option value="done">완료</option></select></Field></div></>}
    {kind === "persona" && <><Field label="페르소나 이름"><input name="name" required minLength={2} maxLength={100} placeholder="예: 10인 규모 디자인 팀 리더" defaultValue={initial("name")} /></Field><Field label="고객의 상황과 필요"><textarea name="description" required maxLength={1000} placeholder="현재 겪고 있는 문제와 제품 선택 시 중요하게 생각하는 기준" defaultValue={initial("description")} /></Field><Field label="질문에 추가할 배경 설명" hint="이 설명을 질문 앞에 붙여 고객의 상황을 전달합니다."><textarea name="promptPrefix" required maxLength={500} placeholder="저는 10명으로 구성된 디자인 팀의 리더이고, 프로젝트 현황을 한눈에 관리할 도구를 찾고 있습니다." defaultValue={initial("promptPrefix")} /></Field></>}
    </fieldset>{Object.values(fieldErrors).length > 0 && <p className="d-screen-reader" role="alert">{Object.values(fieldErrors)[0]}</p>}
    {error && <div className="d-error" role="alert" style={{ marginTop: 15 }}>{error}</div>}<div className="d-form-actions"><Button type="button" onClick={onClose} disabled={busy}>취소</Button><Button type="submit" variant="primary" busy={busy}>{kind === "content" || kind === "report" ? "생성하기" : edit ? "저장하기" : kind === "site" ? "브랜드 등록하기" : kind === "prompt" ? "질문 저장하기" : "추가하기"}{!busy && <ArrowRight size={12} />}</Button></div>
  </form></Modal>;
}
