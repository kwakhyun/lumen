"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Bot, Cable, CalendarDays, Check, CheckCircle2, Compass, Copy, FileText, FlaskConical, Gauge, Globe2, House, Info, Link2, LogIn, LogOut, Menu, MessageCircle, MessagesSquare, Moon, PanelTop, Pencil, Play, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, Trash2, TrendingUp, Users, Workflow, X } from "lucide-react";
import { dashboardHref, filterDashboardAnswers, type DashboardScope } from "@/lib/dashboard-scope";
import { summarizePromptEvidence } from "@/lib/prompt-opportunities";
import { computeMetrics, measuredCitations } from "@/lib/metrics";
import { topicBrandMatrix } from "@/lib/agents/suggestions";
import type { AgentDefinition, AgentRun } from "@/lib/agents/types";
import Sources from "./sections/sources";
import Overview from "./sections/overview";
import Home from "./sections/home";
import Agents, { AgentLauncher, AgentRunDialog } from "./sections/agents";
import { useAgents } from "./agents-client";
import ProductForm, { type FormKind, type EditItem } from "./product-form";
import FirstAnswerGuide, { FirstAnswerSteps, needsFirstAnswer } from "./first-answer-guide";
import Experiments from "./sections/experiments";
import Impact from "./sections/impact";
import Prompts from "./sections/prompts";
import RunHistory from "./sections/run-history";
import PromptDetail from "./prompt-detail";
import Usage from "./sections/usage";
import RunSetup from "./sections/run-setup";
import GA4 from "./sections/ga4";
import Operations from "./sections/operations";
import Security from "./sections/security";
import Connections from "./sections/connections";
import DesignSystem from "./design-system";
import { hasOnlyUngroundedAnswers, providerLabel } from "./measurement";
import { useAiEligibility } from "./eligibility";
import Assistant from "./sections/assistant";
import Rehearsal from "./sections/rehearsal";
import { savedAnalysisLabel } from "./analysis-scope";
import MarkdownContent from "./markdown";
import { LumenMark } from "@/components/lumen-mark";
import { modelLabel as modelName, requestJson as api, shortDateTime, useResource } from "./client";
import { DEMO_MODELS, type Answer, type Bootstrap, type Competitor, type Document as SavedDocument, type Metrics, type Persona, type Prompt, type Run, type Site, type SiteState, type Task } from "@/lib/product-types";
import { Badge, Button, Empty, ExportButton, Modal, Panel, Skeleton, TrendChart, colors, csvFile, dateLabel, downloadFile, numberLabel } from "./ui";

type NavItem = { id: string; title: string; icon: typeof Activity };
const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "", items: [{ id: "overview", title: "홈", icon: House }, { id: "agents", title: "에이전트", icon: Sparkles }] },
  { label: "분석", items: [{ id: "visibility", title: "가시성", icon: Activity }, { id: "prompts", title: "질문과 답변", icon: Search }, { id: "competitors", title: "경쟁사", icon: Users }, { id: "sources", title: "인용 출처", icon: Link2 }, { id: "models", title: "모델별 결과", icon: Bot }] },
  { label: "실행", items: [{ id: "actions", title: "개선 작업", icon: FlaskConical }, { id: "content", title: "콘텐츠와 리포트", icon: FileText }, { id: "rehearsal", title: "콘텐츠 리허설", icon: Clapperboard }, { id: "impact", title: "전후 검증", icon: TrendingUp }] },
  { label: "설정", items: [{ id: "automations", title: "자동 수집", icon: Workflow }, { id: "connections", title: "연결", icon: Cable }, { id: "security", title: "웹사이트 점검", icon: Globe2 }, { id: "settings", title: "브랜드 설정", icon: Settings2 }] },
];
/** Pages reached from a tab or a card rather than the sidebar. */
const secondaryPages: NavItem[] = [
  { id: "personas", title: "고객 페르소나", icon: Compass }, { id: "reports", title: "리포트", icon: BarChart3 }, { id: "traffic", title: "웹사이트 유입", icon: TrendingUp },
  { id: "operations", title: "운영 현황", icon: ShieldCheck }, { id: "usage", title: "사용량", icon: Gauge },
];
const navItems = [...navGroups.flatMap(group => group.items), ...secondaryPages];
const sectionGroup = (section: string) => ({ personas: "prompts", reports: "content", traffic: "connections", operations: "automations", assistant: "overview" } as Record<string, string>)[section] || section;
const contextualTabs: Record<string, { id: string; title: string }[]> = {
  prompts: [{ id: "prompts", title: "질문과 답변" }, { id: "personas", title: "고객 페르소나" }],
  content: [{ id: "content", title: "콘텐츠" }, { id: "reports", title: "리포트" }],
  connections: [{ id: "connections", title: "연결 상태" }, { id: "traffic", title: "웹사이트 유입" }],
  automations: [{ id: "automations", title: "수집 일정" }, { id: "operations", title: "운영 현황" }],
};
const pageMeta: Record<string, { title: string; description: string }> = {
  overview: { title: "홈", description: "" },
  agents: { title: "에이전트", description: "반복되는 분석과 초안 작업을 맡기고, 결과와 제안을 검토하세요." },
  visibility: { title: "가시성", description: "AI 답변에서 우리 브랜드가 얼마나 자주, 어떤 순서로 언급되는지 확인하세요." },
  prompts: { title: "질문과 답변", description: "추적할 질문을 관리하고, 질문별 답변과 브랜드 언급을 확인하세요." },
  personas: { title: "고객 페르소나", description: "고객의 상황과 관심사를 정리하고, 그 관점의 질문을 만드세요." },
  competitors: { title: "경쟁사", description: "같은 답변에서 우리 브랜드와 경쟁사가 얼마나 자주 언급되는지 비교하세요." },
  sources: { title: "인용 출처", description: "AI 답변이 근거로 삼은 웹페이지를 자사, 경쟁사, 제3자로 나누어 확인하세요." },
  models: { title: "모델별 결과", description: "AI 모델별 답변 수와 브랜드 언급률, 인용률을 비교하세요." },
  actions: { title: "개선 작업", description: "개선할 일을 기록하고, 같은 조건으로 수집한 답변을 전후 비교하세요." },
  content: { title: "콘텐츠", description: "수집한 답변과 브랜드 정보를 바탕으로 만든 콘텐츠 초안이에요." },
  reports: { title: "리포트", description: "수집 결과와 개선할 내용을 정리한 리포트예요." },
  rehearsal: { title: "콘텐츠 리허설", description: "게시하기 전에, AI가 이 초안을 읽으면 같은 질문의 답변이 어떻게 달라지는지 미리 확인하세요." },
  impact: { title: "전후 검증", description: "실제 AI 검색에서 확인한 답변과 방문, 구매 자료를 기록해 콘텐츠 변경 전후를 비교하세요." },
  automations: { title: "자동 수집", description: "답변을 수집할 질문과 주기를 정하고 예약된 수집의 진행 상태를 확인하세요." },
  operations: { title: "운영 현황", description: "자동 수집이 제때 실행됐는지, 오류와 지연이 있었는지 확인하세요." },
  connections: { title: "연결", description: "사용할 수 있는 AI 모델과 GA4 연결 상태를 확인하세요." },
  traffic: { title: "웹사이트 유입", description: "웹사이트 방문 중 AI 서비스에서 들어온 방문을 확인하세요." },
  security: { title: "웹사이트 점검", description: "공개 웹 설정을 확인하고 개선 전후를 비교하세요." },
  usage: { title: "사용량", description: "내 계정과 서비스 전체의 AI 호출 사용량을 확인하세요." },
  settings: { title: "브랜드 설정", description: "브랜드 정보와 워크스페이스를 관리하세요." },
  assistant: { title: "Lumen에게 묻기", description: "수집한 답변과 브랜드 정보를 바탕으로 궁금한 점을 물어보세요." },
  "design-system": { title: "디자인 시스템", description: "화면에 사용하는 색상, 글자, 버튼과 입력 요소의 기준이에요." },
};
/** Pages whose numbers depend on the period and model filters. */
const scopedSections = new Set(["overview", "agents", "visibility", "prompts", "competitors", "sources", "models", "content", "reports", "assistant"]);
const subscribeOrigin = () => () => {};
const mobileQuery = "(max-width: 1000px)";
const subscribeMobile = (onChange: () => void) => { const media = window.matchMedia(mobileQuery); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange); };
const getMobileSnapshot = () => window.matchMedia(mobileQuery).matches;
type Theme = "light" | "dark";
const themeListeners = new Set<() => void>();
const subscribeTheme = (onChange: () => void) => { themeListeners.add(onChange); window.addEventListener("storage", onChange); return () => { themeListeners.delete(onChange); window.removeEventListener("storage", onChange); }; };
const readTheme = (): Theme => { const stored = localStorage.getItem("lumen-theme"); return stored === "dark" || stored === "light" ? stored : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; };
const storeTheme = (next: Theme) => { localStorage.setItem("lumen-theme", next); themeListeners.forEach(listener => listener()); };
const sectionFromPath = (pathname: string) => { const id = pathname.replace(/^\/dashboard\/?/, "").split("/")[0]; return id && pageMeta[decodeURIComponent(id)] ? decodeURIComponent(id) : "overview"; };
const READ_ONLY_NOTICE = "샘플은 읽기 전용이에요. 로그인하면 내 브랜드로 시작할 수 있어요.";
const SIGN_IN_TO_START = "/sign-in?return_to=%2Fdashboard%3Fstart%3D1";

export default function Dashboard({ user, initialSection = "overview", initialScope = { period: "30", model: "all" } }: { user: { name: string; email: string; guest?: boolean }; initialSection?: string; initialScope?: DashboardScope }) {
  const [section, setSection] = useState(pageMeta[initialSection] ? initialSection : "overview");
  const guest = Boolean(user.guest);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null); const [state, setState] = useState<SiteState | null>(null); const [siteId, setSiteId] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false); const [commandOpen, setCommandOpen] = useState(false); const [commandText, setCommandText] = useState(""); const [form, setForm] = useState<FormKind | null>(null); const [editItem, setEditItem] = useState<EditItem | null>(null); const [detail, setDetail] = useState<Prompt | null>(null); const [document, setDocument] = useState<SavedDocument | null>(null); const [model, setModel] = useState(initialScope.model); const [period, setPeriod] = useState<DashboardScope["period"]>(initialScope.period); const [running, setRunning] = useState(false); const [runSetup, setRunSetup] = useState(false); const [confirmDelete, setConfirmDelete] = useState<{ type: string; id: string; title: string } | null>(null);
  const [preferredPromptId, setPreferredPromptId] = useState<string>();
  const [detailSequence, setDetailSequence] = useState<Prompt[]>([]);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "light");
  const router = useRouter();
  const [launch, setLaunch] = useState<{ agent: AgentDefinition; defaults: Record<string, string> } | null>(null);
  const [viewRun, setViewRun] = useState<AgentRun | "live" | null>(null);
  const [liveAgent, setLiveAgent] = useState<{ agent: AgentDefinition; input: Record<string, string> } | null>(null);
  const [ask, setAsk] = useState<{ open: boolean; seed: { id: number; text: string } | null }>({ open: false, seed: null });
  function openPrompt(prompt: Prompt, orderedPrompts?: Prompt[]) { setDetailSequence(orderedPrompts || [prompt]); setDetail(prompt); }
  const [formDefaults, setFormDefaults] = useState<Record<string, string>>({});
  const eligibility = useAiEligibility(state?.site.mode === "demo");
  const usage = useResource<{ daily: { limit: number; used: number }; available: number }>("/api/usage");
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileNav || !isMobile) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [menuButtonRef.current, ...Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button, select, summary") || [])].filter((item): item is HTMLElement => Boolean(item));
      const first = items[0], last = items.at(-1);
      if (!items.includes(window.document.activeElement as HTMLElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.document.addEventListener("keydown", trap);
    const trigger = menuButtonRef.current;
    return () => { window.document.body.style.overflow = previousOverflow; window.document.removeEventListener("keydown", trap); trigger?.focus({ preventScroll: true }); };
  }, [mobileNav, isMobile]);
  useEffect(() => {
    const back = () => setSection(sectionFromPath(location.pathname));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const toggleTheme = () => storeTheme(theme === "dark" ? "light" : "dark");
  const runLock = useRef(false); const currentSite = useRef(siteId); const initialLoad = useRef(false); const [clock] = useState(() => Date.now());
  const chooseSite = useCallback((id: string) => { setMobileNav(false); if (currentSite.current === id) return; const previousSite = currentSite.current; currentSite.current = id; const nextQuery = new URLSearchParams(location.search); nextQuery.set("site", id); if (previousSite) nextQuery.delete("prompt"); history.replaceState({}, "", `${location.pathname}?${nextQuery}`); setSiteId(id); setState(null); setDetail(null); setDocument(null); setRunSetup(false); setForm(null); setEditItem(null); setPreferredPromptId(undefined); setLaunch(null); setViewRun(null); setLoading(Boolean(id)); setError(""); }, []);
  const flash = useCallback((message: string) => setToast(message), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobileNav(false); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (window.document.querySelector('[role="dialog"]')) return; setMobileNav(false); setCommandOpen(v => !v); } }; window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut); }, []);
  const refresh = useCallback(async (id = currentSite.current) => { if (!id) return; const next = await api<SiteState>(`/api/sites/${id}/state`); if (currentSite.current === id) setState(next); return next; }, []);
  const refreshBootstrap = useCallback(async () => { const data = await api<Bootstrap>("/api/bootstrap"); setBootstrap(data); return data; }, []);
  const refreshUsage = usage.refresh;
  const afterAgent = useCallback(async () => { await Promise.all([refresh(), refreshUsage()]); }, [refresh, refreshUsage]);
  const agents = useAgents(siteId, afterAgent);
  useEffect(() => { if (initialLoad.current) return; initialLoad.current = true; (async () => { try { let data = await refreshBootstrap(); const search = new URLSearchParams(location.search); let selected: Site | undefined = data.sites.find(s => s.id === search.get("site")) || data.sites.find(s => s.id === localStorage.getItem("lumen-site")) || data.sites[0]; if (search.get("ga4") === "connected") flash("Google 계정이 연결됐어요. 분석할 속성을 선택해 주세요."); if (new URLSearchParams(location.search).get("demo") === "1") { selected = data.sites.find(s => s.mode === "demo"); if (!selected) { const created = await api<{ site: Site }>("/api/demo", "POST"); selected = created.site; data = await refreshBootstrap(); } search.delete("demo"); history.replaceState({}, "", `${location.pathname}${search.size ? `?${search}` : ""}`); } if (selected) chooseSite(selected.id); else setLoading(false); if (search.get("start") === "1") { setEditItem(null); setForm("site"); search.delete("start"); history.replaceState({}, "", `${location.pathname}${search.size ? `?${search}` : ""}`); } if (search.get("ga4") === "error") setError("Google 연결을 완료하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."); } catch (e) { setError((e as Error).message); setLoading(false); } })(); }, [refreshBootstrap, chooseSite, flash]);
  useEffect(() => { if (!siteId) return; let active = true; localStorage.setItem("lumen-site", siteId); api<SiteState>(`/api/sites/${siteId}/state`).then(data => { if (active) setState(data); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [siteId]);
  async function mutate(path: string, method: string, body?: unknown, success?: string) { setBusy(true); setError(""); try { const result = await api(path, method, body); await refresh(); if (success) flash(success); return result; } catch (e) { setError((e as Error).message); throw e; } finally { setBusy(false); } }
  /** Guests may look at everything in the sample but change nothing. */
  function blocked() { if (!guest) return false; flash(READ_ONLY_NOTICE); return true; }
  function openForm(kind: FormKind, edit: EditItem | null = null) { if (guest) { if (kind === "site") router.push(SIGN_IN_TO_START); else flash(READ_ONLY_NOTICE); return; } const open = () => { setMobileNav(false); setFormDefaults({}); setEditItem(edit); setForm(kind); }; if (kind === "content" || kind === "report") eligibility.request(open); else open(); }
  async function createDemo() { setBusy(true); setError(""); try { const result = await api<{ site: Site }>("/api/demo", "POST"); await refreshBootstrap(); chooseSite(result.site.id); flash("샘플 워크스페이스가 준비됐어요"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function submitForm(values: Record<string, unknown>) { const root = `/api/sites/${siteId}`; if (form === "site") { setBusy(true); setError(""); try { const result = await api<{ site: Site }>(editItem ? root : "/api/sites", editItem ? "PATCH" : "POST", values); await refreshBootstrap(); if (editItem) await refresh(); else chooseSite(result.site.id); setForm(null); flash(editItem ? "브랜드 정보를 저장했어요" : "브랜드를 등록했어요. 이제 첫 질문을 추가해 보세요."); } catch (e) { setError((e as Error).message); throw e; } finally { setBusy(false); } return; }
    const addingPrompt = form === "prompt" && !editItem;
    const resource = form === "content" || form === "report" ? "documents" : `${form}s`; const result = await mutate(`${root}/${resource}${editItem ? `/${editItem.id}` : ""}`, editItem ? "PATCH" : "POST", form === "content" || form === "report" ? { ...values, kind: form, scope: { ...scope } } : values, form === "content" || form === "report" ? "문서를 생성했어요" : addingPrompt ? "질문을 추가했어요. 답변 수집 버튼을 눌러 다음 단계로 진행하세요." : "저장했어요"); if (addingPrompt) setPreferredPromptId((result as { prompt: Prompt }).prompt.id); setForm(null);
  }
  async function processRun(run: Run) { if (runLock.current) return; runLock.current = true; setRunning(true); setError(""); const targetSite = run.siteId; try { let current = run; while (["queued", "running"].includes(current.status)) { try { const response = await api<{ run: Run }>(`/api/sites/${targetSite}/runs/${run.id}/process`, "POST"); current = response.run; await refresh(targetSite); } catch (error) { if ((error as Error & { code?: string }).code !== "run_locked") throw error; await new Promise(resolve => setTimeout(resolve, 2500)); const response = await api<{ run: Run }>(`/api/sites/${targetSite}/runs/${run.id}`); current = response.run; await refresh(targetSite); } } flash(current.status === "completed" ? "답변 수집을 완료했어요" : "수집 결과를 확인해 주세요"); void refreshUsage(); } catch (e) { setError((e as Error).message); } finally { runLock.current = false; setRunning(false); } }
  function startRun(promptId?: string) { if (!state || blocked()) return; if (state.runs.some(run => ["queued", "running"].includes(run.status))) { setError("진행 중인 수집이 있어요. ‘이어서 수집’ 버튼으로 먼저 완료해 주세요."); return; } if (!state.prompts.some(prompt => prompt.active)) { openForm("prompt", state.prompts[0] || null); return; } const targetSite = siteId; eligibility.request(() => { if (currentSite.current !== targetSite) return; if (promptId) setPreferredPromptId(promptId); setError(""); setRunSetup(true); }); }
  async function executeRun(promptIds: string[], models: string[]) { if (!state || running) return; setBusy(true); setError(""); try { const result = await api<{ run: Run }>(`/api/sites/${siteId}/runs`, "POST", { mode: state.site.mode, models, promptIds }); await refresh(); setRunSetup(false); setBusy(false); await processRun(result.run); } catch (e) { setError((e as Error).message); setBusy(false); } }
  async function generatePrompts(count: number) { try { const result = await mutate(`/api/sites/${siteId}/prompts/generate`, "POST", { count }) as { prompts: Prompt[] }; flash(`새 질문 ${result.prompts.length}개를 생성했어요`); } catch {} }
  const scope: DashboardScope = { period, model };
  const filteredHistory = useMemo(() => state ? filterDashboardAnswers(state.answers, { period, model }, clock, state.site) : [], [state, period, model, clock]);
  const answers = filteredHistory;
  const metrics = useMemo(() => state ? computeMetrics(state.site, state.competitors, answers, state.prompts) : null, [state, answers]);
  const href = (id: string) => dashboardHref(id, scope, siteId || undefined);
  function changeScope(next: DashboardScope) { setPeriod(next.period); setModel(next.model); history.replaceState({}, "", dashboardHref(section, next, siteId || undefined)); }
  /** Sections switch in place; the URL stays shareable and the back button works. */
  function navigate(id: string) { setMobileNav(false); setCommandOpen(false); setCommandText(""); if (id === section) return; history.pushState({}, "", href(id)); setSection(id); window.scrollTo({ top: 0 }); }
  const go = (id: string) => (event: ReactMouseEvent<HTMLAnchorElement>) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); navigate(id); };
  const openedPrompt = useRef("");
  useEffect(() => { if (!state) return; const promptId = new URLSearchParams(location.search).get("prompt"); if (promptId && openedPrompt.current !== `${state.site.id}:${promptId}`) { openedPrompt.current = `${state.site.id}:${promptId}`; setDetail(state.prompts.find(prompt => prompt.id === promptId) || null); } }, [state]);
  // An open answer keeps its own link, so a specific question can be shared.
  useEffect(() => { if (!state) return; const query = new URLSearchParams(location.search); if (detail) { if (query.get("prompt") === detail.id) return; query.set("prompt", detail.id); openedPrompt.current = `${state.site.id}:${detail.id}`; } else { if (!query.has("prompt")) return; query.delete("prompt"); } history.replaceState({}, "", `${location.pathname}?${query}`); }, [detail, state]);
  function createTaskFromPrompt(prompt: Prompt) {
    if (!state || blocked()) return;
    const evidence = summarizePromptEvidence(state.site, [prompt], state.competitors, answers)[0];
    const samples = answers.filter(answer => answer.promptId === prompt.id && answer.status === "completed").sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const observed = evidence.completedCount ? `완료 답변 ${evidence.completedCount}개 중 자사 언급 ${evidence.mentionCount}개, 경쟁사만 언급 ${evidence.competitorOnlyCount}개` : "완료 답변 없음. 수집 후 원문을 확인하세요.";
    setDetail(null); setEditItem(null);
    setFormDefaults({ title: `${evidence.completedCount ? "답변 내용 검토" : "답변 수집"}: ${prompt.text}`.slice(0,200), description: [
      `질문: ${prompt.text}`, `관측 조건: 최근 ${period}일 / ${model === "all" ? "모든 AI 모델" : modelName(model)} / ${state.site.mode === "demo" ? "합성 샘플" : "API 답변"}`,
      `확인한 근거: ${observed}`, evidence.competitorNames.length ? `등장한 경쟁사: ${evidence.competitorNames.join(", ")}` : "",
      samples[0] ? `최근 완료: ${shortDateTime(samples[0].completedAt || samples[0].createdAt)} (한국 시간)` : "",
      `질문 원문: ${dashboardHref("prompts", scope, state.site.id, prompt.id)}`,
      "", "할 일: 답변 원문에서 빠지거나 부정확한 제품 정보를 확인하고, 보완할 페이지와 변경 내용을 기록하세요.",
      "완료 기준: 같은 질문과 모델로 다시 수집해 변경 전후를 비교하세요.",
    ].filter(Boolean).join("\n").slice(0,2000), priority: evidence.competitorOnlyCount ? "high" : "medium", status: "todo" });
    setForm("task");
  }
  function runAgent(agent: AgentDefinition, input: Record<string, string>) {
    eligibility.request(async () => {
      setLaunch(null); setError(""); agents.clearLive(); setLiveAgent({ agent, input }); setViewRun("live");
      try { const finished = await agents.start(agent.id, input, scope); if (finished?.status === "completed" && !finished.persisted && !guest && state?.site.mode === "live") flash("결과를 저장하지 못했어요. 창을 닫기 전에 내려받아 주세요."); }
      catch (cause) { setViewRun(null); setError((cause as Error).message); }
    });
  }
  const askLumen = (text?: string) => setAsk(current => ({ open: true, seed: text ? { id: (current.seed?.id || 0) + 1, text } : current.seed }));
  const citationUnavailable = hasOnlyUngroundedAnswers(answers);
  const starting = state ? needsFirstAnswer(state) : false;
  const activeRun = state?.runs.find(r => ["queued", "running"].includes(r.status)); const meta = pageMeta[section];
  async function exportData() { if (!state || !metrics) return; csvFile(`${state.site.name}-${section}-${new Date().toISOString().slice(0, 10)}.csv`, section === "sources" ? [["도메인", "인용한 답변", "측정 가능한 완료 답변", "인용률(%)", "대표 URL"], ...metrics.sources.map(s => [s.domain, s.citations, metrics.citationEligibleAnswerCount, metrics.citationEligibleAnswerCount ? Math.round(s.citations / metrics.citationEligibleAnswerCount * 1000) / 10 : "측정 불가", s.url])] : section === "competitors" ? [["브랜드", "도메인", "언급률(%)", "인용률(%)", "점유율(%)", "평균 등장 순서"], ...metrics.brands.map(b => [b.name, b.domain, metrics.answerCount ? b.mentionRate : "측정 불가", citationUnavailable || b.citationRate === null ? "측정 불가" : b.citationRate, metrics.totalBrandMentions ? b.shareOfVoice : "측정 불가", b.averageRank])] : [["질문", "모델", "수집 유형", "상태", "답변", "출처", "수집 시간"], ...filteredHistory.map(a => [a.promptText, a.model, a.mode, a.status, a.text, measuredCitations(a).map(c => c.url).join(" | "), a.createdAt])]); flash("현재 필터의 데이터를 내보냈어요"); }
  async function removeConfirmed() { if (!confirmDelete) return; setBusy(true); setError(""); try { if (confirmDelete.type === "site") { await api(`/api/sites/${siteId}`, "DELETE"); const data = await refreshBootstrap(); setState(null); chooseSite(data.sites[0]?.id || ""); } else { await mutate(`/api/sites/${siteId}/${confirmDelete.type}/${confirmDelete.id}`, "DELETE"); } setConfirmDelete(null); flash("삭제했어요"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const remove = (target: { type: string; id: string; title: string }) => { if (!blocked()) setConfirmDelete(target); };
  const handleTaskStatus = async (task: Task, status: string) => { if (blocked()) return; try { await mutate(`/api/sites/${siteId}/tasks/${task.id}`, "PATCH", { status }, "작업 상태를 변경했어요"); } catch {} };
  const togglePrompt = async (prompt: Prompt, values: Record<string, boolean>) => { if (blocked()) return; try { await mutate(`/api/sites/${siteId}/prompts/${prompt.id}`, "PATCH", values); } catch {} };

  const filterControls = state ? <div className="d-filterbar"><label className="d-select-wrap"><CalendarDays size={13} /><select aria-label="분석 기간" value={period} onChange={e => changeScope({ ...scope, period: e.target.value === "7" ? "7" : "30" })}><option value="7">최근 7일</option><option value="30">최근 30일</option></select></label><label className="d-select-wrap"><Bot size={13} /><select aria-label="AI 모델 필터" value={model} onChange={e => changeScope({ ...scope, model: e.target.value })}><option value="all">모든 AI 모델</option>{Array.from(new Set([...(model !== "all" ? [model] : []), ...(state.site.mode === "demo" ? DEMO_MODELS : state.providers.map(p => p.model)), ...state.answers.map(a => a.model)])).map(m => { const unavailable = state.site.mode !== "demo" && !state.providers.some(p => p.model === m && p.configured && p.available) && !state.answers.some(a => a.model === m); return <option key={m} value={m} disabled={unavailable}>{modelName(m)}{unavailable ? " (현재 제공하지 않음)" : ""}</option>; })}</select></label><span className="d-filter-note"><RefreshCw size={10} />{`선택 기간 전체 · 완료 ${metrics?.answerCount ?? 0}개`}</span></div> : null;
  const reviewCount = agents.runs.reduce((sum, run) => sum + run.proposals.filter(proposal => proposal.status === "proposed").length, 0);
  const group = navGroups.find(item => item.items.some(entry => entry.id === sectionGroup(section)));
  const shownRun = viewRun === "live" ? agents.live?.run || (liveAgent ? { id: "pending", siteId, agentId: liveAgent.agent.id, title: liveAgent.agent.name, status: "running" as const, mode: state?.site.mode || "live", input: liveAgent.input, scope, steps: liveAgent.agent.steps.map(step => ({ ...step, status: "pending" as const })), summary: "", report: "", proposals: [], model: null, units: 0, error: null, createdAt: new Date(clock).toISOString(), completedAt: null, persisted: false } : null) : viewRun ? agents.runs.find(run => run.id === viewRun.id) || viewRun : null;
  const shownAgent = shownRun ? agents.agents.find(agent => agent.id === shownRun.agentId) : undefined;

  return <div className={`d-shell d-section-${section}`} data-theme={theme}>
    <a href="#workspace-content" className="d-skip">본문으로 건너뛰기</a>
    <div className={`d-nav-overlay ${mobileNav ? "open" : ""}`} onClick={() => setMobileNav(false)} />
    <aside id="workspace-navigation" ref={sidebarRef} className={`d-sidebar ${mobileNav ? "open" : ""}`} inert={isMobile && !mobileNav} aria-label="워크스페이스 탐색">
      <div className="d-sidebar-top"><Link href="/" className="d-brand" aria-label="Lumen 홈"><LumenMark size={26} />lumen</Link><button type="button" className="d-icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "밝은 화면으로 전환" : "어두운 화면으로 전환"}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button></div>
      <div className="d-workspace"><span className="d-site-avatar">{state?.site.name.slice(0,1).toUpperCase() || "L"}</span><div><label className="d-screen-reader" htmlFor="site-switcher">워크스페이스 선택</label><select id="site-switcher" disabled={busy || running} value={siteId} onChange={e => { if (e.target.value === "new") openForm("site"); else chooseSite(e.target.value); }}><option value="" disabled>워크스페이스</option>{bootstrap?.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}<option value="new">{guest ? "+ 내 브랜드로 시작 (로그인)" : "+ 새 워크스페이스"}</option></select><small>{state?.site.mode === "demo" ? "샘플 데이터" : "내 브랜드"}</small></div></div>
      <button type="button" className="d-sidebar-search" onClick={() => setCommandOpen(true)} aria-label="빠른 검색, Command K"><Search size={15} />검색<kbd>⌘K</kbd></button>
      {navGroups.map(item => <nav className="d-nav" key={item.label || "main"} aria-label={item.label || "주 탐색"}>{item.label && <p className="d-nav-label">{item.label}</p>}{item.items.map(entry => { const active = sectionGroup(section) === entry.id; return <a key={entry.id} href={href(entry.id)} onClick={go(entry.id)} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><entry.icon size={16} />{entry.title}{entry.id === "agents" && reviewCount > 0 && <span className="d-nav-count" aria-label={`검토할 제안 ${reviewCount}건`}>{reviewCount}</span>}</a>; })}</nav>)}
      <div className="d-sidebar-foot">
        {guest ? <a className="d-usage-card" href={SIGN_IN_TO_START}><strong>내 브랜드로 시작하기<LogIn size={14} /></strong>지금은 샘플을 보고 있어요. 로그인하면 내 브랜드의 답변을 수집할 수 있어요.</a>
          : <a className="d-usage-card" href={href("usage")} onClick={go("usage")} aria-current={section === "usage" ? "page" : undefined}><strong>오늘 AI 사용량<span>{usage.data ? `${usage.data.daily.used} / ${usage.data.daily.limit}` : "—"}</span></strong><div className="d-progress-track"><div className="d-progress-fill" style={{ width: `${usage.data ? Math.min(100, usage.data.daily.used / Math.max(1, usage.data.daily.limit) * 100) : 0}%` }} /></div></a>}
        <div className="d-account"><details className="d-account-menu"><summary aria-label="계정 메뉴"><span className="d-profile-avatar">{(user.name || "G").slice(0,1).toUpperCase()}</span><span>{guest ? "게스트" : user.name}</span></summary><div>{guest ? <><strong>로그인 없이 샘플을 보는 중</strong><a href={SIGN_IN_TO_START}><LogIn size={16} />로그인하고 시작</a></> : <><strong>{user.email}</strong><a href={href("settings")} onClick={go("settings")}><Settings2 size={16} />브랜드 설정</a><a href={href("usage")} onClick={go("usage")}><Gauge size={16} />사용량</a><a href="/sign-out"><LogOut size={16} />로그아웃</a></>}</div></details></div>
      </div>
    </aside>
    <div className="d-main" inert={mobileNav && isMobile}>
      <header className="d-topbar">
        <button ref={menuButtonRef} type="button" className="d-icon-button d-mobile-menu" onClick={() => setMobileNav(v => !v)} aria-label={mobileNav ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={mobileNav} aria-controls="workspace-navigation">{mobileNav ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="d-crumb">{group?.label && <><span>{group.label}</span><span aria-hidden="true">/</span></>}<strong>{meta.title}</strong></div>
        {state?.site.mode === "demo" && <span className="d-pill d-pill-sample" title="합성 데이터예요. 실제 AI 응답이 아니에요.">샘플<span className="d-pill-extra">&nbsp;데이터{guest ? " · 읽기 전용" : ""}</span></span>}
        <div className="d-topbar-space" />
        {scopedSections.has(section) && !starting && filterControls}
        {state && <button type="button" className="d-ask-button" onClick={() => askLumen()} aria-label="Lumen에게 묻기"><MessagesSquare size={15} /><span>Lumen에게 묻기</span></button>}
      </header>
      <main className="d-content" id="workspace-content">
        {error && <div className="d-error" role="alert"><Info size={15} /><span>{error}</span><button className="d-icon-button" onClick={() => setError("")} aria-label="오류 메시지 닫기"><X size={14} /></button></div>}
        {loading ? <Skeleton /> : section === "usage" ? <><PageHeading meta={meta} /><Usage /></> : section === "design-system" ? <><PageHeading meta={meta} /><DesignSystem /></> : !state && (siteId || !bootstrap) ? <Panel><Empty title="워크스페이스를 불러오지 못했어요" text="연결 상태를 확인한 뒤 다시 시도해 주세요. 저장된 데이터는 그대로 유지돼요." action={<Button onClick={() => window.location.reload()}><RefreshCw size={16} />다시 불러오기</Button>} /></Panel>  : !state ? <div className="d-onboard"><div className="d-onboard-eyebrow">처음 시작하기</div><h1>브랜드를 등록하고<br />첫 AI 답변을 확인하세요.</h1><p>브랜드 이름과 웹사이트, 질문 하나면 시작할 수 있어요.<br />GA4 연결과 경쟁사 등록은 나중에 해도 돼요.</p><FirstAnswerSteps step={0} /><div className="d-onboard-grid"><Panel className="d-onboard-card"><Globe2 size={28} strokeWidth={1.3} /><h2>내 브랜드 등록</h2><p>브랜드별로 질문과 답변을 모아 두는<br />워크스페이스를 만들어요.</p><Button variant="primary" onClick={() => openForm("site")}><Plus size={14} />브랜드 등록하기</Button></Panel><Panel className="d-onboard-card"><PanelTop size={28} strokeWidth={1.3} /><h2>샘플로 먼저 둘러보기</h2><p>미리 준비한 합성 답변으로 살펴보세요.<br />실제 AI 사용량은 차감하지 않아요.</p><Button onClick={createDemo} busy={busy}>샘플 둘러보기<ArrowRight size={14} /></Button></Panel></div><p className="d-start-note">등록만으로 AI 요청이 실행되지는 않아요. 수집 전에 이용 조건과 남은 사용량을 확인해요.</p></div> : <>
          {(section !== "overview" || starting) && section !== "assistant" && <div className="d-page-title">{section === "overview" ? <div /> : <div><h1>{meta.title}</h1><p>{meta.description}</p></div>}<div className="d-page-actions">{!starting && ["visibility", "prompts", "competitors", "sources", "models"].includes(section) && <ExportButton onClick={exportData} />}{(!starting || section === "models") && ["visibility", "models"].includes(section) && <Button variant="primary" onClick={() => startRun()} busy={busy || running} disabled={!state.prompts.some(p => p.active)}><RefreshCw size={13} />{state.site.mode === "demo" ? "샘플 분석 실행" : "답변 수집"}</Button>}{section === "prompts" && <Button variant="primary" onClick={() => openForm("prompt")}><Plus size={14} />질문 추가</Button>}{section === "competitors" && <Button variant="primary" onClick={() => openForm("competitor")}><Plus size={14} />경쟁사 추가</Button>}{section === "personas" && <Button variant="primary" onClick={() => openForm("persona")}><Plus size={14} />페르소나 추가</Button>}{section === "content" && <Button variant="primary" onClick={() => openForm("content")}><Sparkles size={14} />콘텐츠 만들기</Button>}{section === "reports" && <Button variant="primary" onClick={() => openForm("report")}><Plus size={14} />리포트 생성</Button>}{section === "actions" && <Button variant="primary" onClick={() => openForm("task")}><Plus size={14} />작업 추가</Button>}{section === "settings" && <Button variant="primary" onClick={() => openForm("site")}><Plus size={14} />워크스페이스 추가</Button>}</div></div>}
          {!starting && eligibility.banner}
          {contextualTabs[sectionGroup(section)] && <nav className="d-context-tabs" aria-label="세부 탐색">{contextualTabs[sectionGroup(section)].map(tab => <a key={tab.id} href={href(tab.id)} onClick={go(tab.id)} className={section === tab.id ? "active" : ""} aria-current={section === tab.id ? "page" : undefined}>{tab.title}</a>)}</nav>}
          {state.dataWindow?.truncated && <div className="d-demo-banner"><Info size={13} /><span>최근 30일 답변 {numberLabel(state.dataWindow.totalAnswers)}개 중 최신 {numberLabel(state.dataWindow.answersReturned)}개를 표시해요.</span><a href={`/api/sites/${siteId}/export`} className="d-text-link">전체 30일 CSV<ArrowDownToLine size={12} /></a></div>}
          {activeRun && <div className="d-run-progress"><Radio size={20} className={running ? "d-spin" : ""} /><div><strong>{running ? "답변을 수집하고 있어요" : "진행 중인 수집이 있어요"}</strong><p>{activeRun.completed}개 완료{activeRun.failed ? `, ${activeRun.failed}개 실패` : ""} / 전체 {activeRun.total}개. 답변 하나에 최대 90초가 걸릴 수 있고, 화면을 닫아도 완료한 답변은 저장돼요.</p><div className="d-progress-track"><div className="d-progress-fill" style={{ width: `${(activeRun.completed + activeRun.failed) / Math.max(1, activeRun.total) * 100}%` }} /></div></div>{!running && <Button onClick={() => eligibility.request(() => processRun(activeRun))}><Play size={12} />이어서 수집</Button>}</div>}
          {((section === "overview" && starting) || (section === "prompts" && state.prompts.length > 0)) && <FirstAnswerGuide key={siteId} primary={section === "overview" && starting} state={state} busy={busy || running} running={running} onAdd={text => { openForm("prompt"); if (text && !guest) setFormDefaults({ text }); }} onEdit={prompt => openForm("prompt", prompt)} onRun={startRun} onOpen={openPrompt} />}
          {metrics && section === "overview" && !starting && <Home state={state} metrics={metrics} scope={scope} clock={clock} controller={agents} readOnly={guest} onLaunch={(agent, defaults) => setLaunch({ agent, defaults: defaults || {} })} onOpenRun={setViewRun} onAsk={askLumen} onCollect={() => startRun()} onForm={openForm} navigate={navigate} flash={flash} />}
          {section === "agents" && <Agents controller={agents} state={state} scope={scope} onLaunch={agent => setLaunch({ agent, defaults: {} })} onOpenRun={setViewRun} />}
          {metrics && section === "visibility" && <><Overview scope={scope} state={state} metrics={metrics} answers={answers} navigate={navigate} openPrompt={openPrompt} openForm={openForm} onCreateTask={createTaskFromPrompt} filters={null} /><VisibilityMatrix state={state} answers={answers} /></>}
          {metrics && section === "prompts" && <Prompts state={state} answers={answers} onCreateTask={createTaskFromPrompt} onAdd={() => openForm("prompt")} busy={busy || running} onDetail={openPrompt} onEdit={p => openForm("prompt", p)} onDelete={p => remove({ type: "prompts", id: p.id, title: p.text })} onToggle={togglePrompt} onGenerate={count => { if (!blocked()) eligibility.request(() => generatePrompts(count)); }} onRun={() => startRun()} />}
          {metrics && section === "competitors" && <Competitors state={state} metrics={metrics} citationUnavailable={citationUnavailable} onEdit={c => openForm("competitor", c)} onDelete={c => remove({ type: "competitors", id: c.id, title: c.name })} onAdd={() => openForm("competitor")} />}
          {metrics && section === "sources" && <Sources metrics={metrics} citationUnavailable={citationUnavailable} answers={answers} prompts={state.prompts} site={state.site} competitors={state.competitors} onPrompt={openPrompt} onObserve={() => navigate("impact")} />}
          {metrics && section === "models" && <Models state={state} answers={filteredHistory} />}
          {section === "personas" && <Personas state={state} onAdd={() => openForm("persona")} onEdit={p => openForm("persona", p)} onDelete={p => remove({ type: "personas", id: p.id, title: p.name })} onUse={p => { if (!blocked()) eligibility.request(async () => { try { await mutate(`/api/sites/${siteId}/prompts/generate`, "POST", { personaId: p.id, count: 3 }, "페르소나 관점의 질문 3개를 생성했어요"); navigate("prompts"); } catch {} }); }} busy={busy} />}
          {(section === "content" || section === "reports") && <Documents documents={state.documents.filter(d => d.kind === (section === "content" ? "content" : "report"))} kind={section === "content" ? "content" : "report"} onOpen={setDocument} onCreate={() => openForm(section === "content" ? "content" : "report")} onAgent={() => navigate("agents")} />}
          {section === "rehearsal" && <Rehearsal key={siteId} siteId={siteId} state={state} requestAI={eligibility.request} onUsed={refreshUsage} />}
          {section === "impact" && <Impact key={siteId} state={state} />}
          {section === "actions" && <div className="d-stack"><Actions tasks={state.tasks} onEdit={t => openForm("task", t)} onStatus={handleTaskStatus} onDelete={t => remove({ type: "tasks", id: t.id, title: t.title })} onAdd={() => openForm("task")} /><Experiments key={siteId} state={state} /></div>}
          {section === "traffic" && <div className="d-stack"><GA4 key={siteId} state={state} /><Traffic state={state} flash={flash} /></div>}
          {section === "connections" && <Connections key={siteId} state={state} />}
          {section === "security" && <Security key={siteId} state={state} />}
          {(section === "automations" || section === "operations") && <Operations key={`${siteId}-${section}`} state={state} view={section} requestAI={eligibility.request} />}
          {section === "settings" && <Settings state={state} user={user} onEdit={() => openForm("site", state.site)} onDelete={() => remove({ type: "site", id: siteId, title: state.site.name })} />}
          {section === "assistant" && <Assistant key={siteId} siteId={siteId} siteName={state.site.name} demo={state.site.mode === "demo"} scope={scope} requestAI={eligibility.request} />}
        </>}
        <footer className="d-feedback"><span>Lumen · 운영자 곽현</span><nav aria-label="서비스 안내"><a href="/methodology">측정 방법</a><a href="/privacy">개인정보 처리 안내</a><a href="/terms">이용 안내</a><a href="mailto:khyun9685@gmail.com">문의</a></nav></footer>
      </main>
    </div>
    {eligibility.dialog}
    {toast && <div className="d-toast" role="status"><CheckCircle2 size={15} />{toast}</div>}
    {ask.open && state && <><div className="d-dock-overlay" onClick={() => setAsk(current => ({ ...current, open: false }))} /><aside className="d-dock" role="dialog" aria-modal="true" aria-label="Lumen에게 묻기"><header className="d-dock-head"><Sparkles size={16} /><div><h2>Lumen에게 묻기</h2><small>최근 {period}일 · {model === "all" ? "모든 AI 모델" : modelName(model)} · 완료 답변 {metrics?.answerCount ?? 0}개</small></div><button type="button" className="d-icon-button" onClick={() => setAsk(current => ({ ...current, open: false }))} aria-label="닫기"><X size={18} /></button></header><div className="d-dock-body"><Assistant key={siteId} siteId={siteId} siteName={state.site.name} demo={state.site.mode === "demo"} scope={scope} requestAI={eligibility.request} seed={ask.seed} onUsed={refreshUsage} /></div></aside></>}
    {launch && state && <AgentLauncher key={launch.agent.id} agent={launch.agent} state={state} scope={scope} engine={agents.engine} defaults={launch.defaults} busy={false} onClose={() => setLaunch(null)} onRun={input => runAgent(launch.agent, input)} />}
    {shownRun && <AgentRunDialog run={shownRun} live={agents.live} agent={shownAgent} controller={agents} readOnly={guest} flash={flash} onClose={() => { setViewRun(null); if (shownRun.status !== "running") agents.clearLive(); }} onRerun={shownAgent && shownRun.status !== "running" ? () => { setViewRun(null); setLaunch({ agent: shownAgent, defaults: shownRun.input }); } : undefined} />}
    {runSetup && state && <RunSetup key={siteId} preferredPromptId={preferredPromptId} state={state} busy={busy || running} error={error} defaultModel={model} onClose={() => setRunSetup(false)} onRun={executeRun} />}
    {form && <ProductForm siteId={form !== "site" ? siteId : undefined} analysisScope={scope} answerCount={metrics?.answerCount ?? 0} kind={form} edit={editItem} defaults={formDefaults} busy={busy} onClose={() => setForm(null)} onSubmit={submitForm} demo={form !== "site" && state?.site.mode === "demo"} />}
    {detail && state && <PromptDetail sequence={detailSequence} onNavigate={setDetail} prompt={detail} state={{ ...state, answers: filteredHistory }} scopeLabel={`최근 ${period}일 / ${model === "all" ? "모든 AI 모델" : modelName(model)}`} onCreateTask={() => createTaskFromPrompt(detail)} onClose={() => setDetail(null)} onCollect={() => { setDetail(null); if (detail.active) startRun(detail.id); else openForm("prompt", detail); }} />}
    {document && <DocumentEditor document={document} readOnly={guest} onClose={() => setDocument(null)} onSave={async content => { await mutate(`/api/sites/${siteId}/documents/${document.id}`, "PATCH", { content }, "문서를 저장했어요"); setDocument({ ...document, content }); }} />}
    {confirmDelete && <Modal title="삭제하시겠어요?" subtitle={`‘${confirmDelete.title.slice(0, 60)}’${confirmDelete.type === "site" ? " 워크스페이스와 연결된 데이터를" : " 항목을"} 삭제해요. 이 작업은 되돌릴 수 없어요.`} onClose={() => setConfirmDelete(null)}><div className="d-form"><div className="d-form-actions"><Button onClick={() => setConfirmDelete(null)}>취소</Button><Button variant="danger" busy={busy} onClick={removeConfirmed}>삭제하기</Button></div></div></Modal>}
    {commandOpen && <Modal title="빠른 검색" onClose={() => setCommandOpen(false)}><div className="d-command"><input className="d-search-input" value={commandText} onChange={e => setCommandText(e.target.value)} placeholder="페이지, 에이전트, 질문을 검색하세요" aria-label="페이지, 에이전트, 질문 검색" autoFocus />{navItems.filter(item => item.title.includes(commandText)).map(item => <button className="d-command-result" key={item.id} onClick={() => navigate(item.id)}><item.icon size={16} />{item.title}<small>이동 ↵</small></button>)}{commandText && agents.agents.filter(agent => agent.name.includes(commandText)).slice(0, 4).map(agent => <button className="d-command-result" key={agent.id} onClick={() => { setCommandOpen(false); setCommandText(""); setLaunch({ agent, defaults: {} }); }}><Sparkles size={15} />{agent.name}<small>에이전트 실행</small></button>)}{commandText && state?.prompts.filter(p => p.text.includes(commandText)).slice(0, 5).map(p => <button className="d-command-result" key={p.id} onClick={() => { setCommandOpen(false); openPrompt(p); }}><MessageCircle size={15} />{p.text.slice(0, 65)}</button>)}</div></Modal>}
  </div>;
}

/** Topic by brand: where the brand is present and where rivals lead. */
function VisibilityMatrix({ state, answers }: { state: SiteState; answers: Answer[] }) {
  const matrix = useMemo(() => topicBrandMatrix(state, answers), [state, answers]);
  if (!matrix.rows.length) return null;
  return <Panel className="d-section-space" title="주제별 브랜드 언급률" subtitle="각 칸은 그 주제의 완료 답변 중 해당 브랜드가 언급된 비율이에요. 자사 언급률이 낮은 주제부터 보여 줘요.">
    <div className="d-matrix-wrap"><table className="d-matrix"><thead><tr><th scope="col">주제</th>{matrix.brands.map(brand => <th scope="col" key={brand.domain} className={brand.isOwn ? "d-matrix-own" : undefined}>{brand.name}{brand.isOwn ? " (자사)" : ""}</th>)}</tr></thead>
      <tbody>{matrix.rows.map(row => <tr key={row.topic}><td>{row.topic}<small>완료 답변 {row.answers}개</small></td>{row.rates.map((value, index) => <td key={matrix.brands[index].domain}><span className={`d-matrix-cell ${matrix.brands[index].isOwn ? "d-matrix-own" : ""}`} style={{ "--heat": Math.round(value * 0.42) } as React.CSSProperties}>{numberLabel(value)}%</span></td>)}</tr>)}</tbody></table></div>
  </Panel>;
}

function PageHeading({ meta }: { meta: { title: string; description: string } }) { return <div className="d-page-title"><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>; }

function Competitors({ state, metrics, citationUnavailable, onEdit, onDelete, onAdd }: { state: SiteState; metrics: Metrics; citationUnavailable: boolean; onEdit: (c: Competitor) => void; onDelete: (c: Competitor) => void; onAdd: () => void }) { const brands = [...metrics.brands].sort((a, b) => b.mentionRate - a.mentionRate); return <><Panel title="브랜드 비교" subtitle={`완료 답변 ${metrics.answerCount}개를 지금 등록된 브랜드 목록으로 다시 평가한 결과예요. 경쟁사를 바꾸면 과거 수치도 달라져요.`}><div className="d-table-wrap"><table className="d-table"><thead><tr><th>브랜드</th><th>언급률</th><th>답변 내 점유율</th><th>인용률</th><th>평균 등장 순서</th><th /></tr></thead><tbody>{brands.map((brand, i) => { const competitor = state.competitors.find(c => c.domain === brand.domain); return <tr key={brand.domain}><td><div className="d-row-inline"><span className="d-ranking-logo" style={{ color: colors[i % colors.length] }}>{brand.name[0]}</span><div>{brand.name}{brand.isOwn && <Badge tone="green">우리 브랜드</Badge>}<div className="d-table-sub">{brand.domain}</div></div></div></td><td>{metrics.answerCount ? <div className="d-row-inline"><div className="d-progress-track" style={{ width: 66 }}><div className="d-progress-fill" style={{ width: `${brand.mentionRate}%`, background: colors[i % colors.length] }} /></div>{numberLabel(brand.mentionRate)}%</div> : "측정 불가"}</td><td>{metrics.totalBrandMentions ? `${numberLabel(brand.shareOfVoice)}%` : "측정 불가"}</td><td>{citationUnavailable || brand.citationRate === null ? "측정 불가" : `${numberLabel(brand.citationRate)}%`}</td><td>{brand.averageRank === null ? "—" : `${numberLabel(brand.averageRank)}번째`}</td><td>{competitor && <div className="d-table-actions"><button aria-label="경쟁사 편집" className="d-icon-button" onClick={() => onEdit(competitor)}><Pencil size={13} /></button><button aria-label="경쟁사 삭제" className="d-icon-button" onClick={() => onDelete(competitor)}><Trash2 size={13} /></button></div>}</td></tr>; })}</tbody></table></div>{!state.competitors.length && <Empty title="함께 비교할 브랜드를 등록하세요" text="비교할 경쟁사를 등록하면 같은 답변에서 각 브랜드가 차지하는 언급 비중을 확인할 수 있어요." action={<Button onClick={onAdd}><Plus size={13} />경쟁사 추가</Button>} />}</Panel></>; }



function Models({ state, answers }: { state: SiteState; answers: Answer[] }) { const models = Array.from(new Set([...(state.site.mode === "demo" ? DEMO_MODELS : state.providers.map(p => p.model)), ...answers.map(a => a.model)])); return <><div className="d-grid-3">{models.map((id, index) => { const metrics = computeMetrics(state.site, state.competitors, answers.filter(a => a.model === id), state.prompts); const provider = state.providers.find(p => p.model === id); return <Panel className="d-model-card" key={id}><div className="d-card-body"><span className="d-model-logo" style={{ color: colors[index] }}><Bot size={25} strokeWidth={1.4} /></span><h3>{modelName(id)}</h3><Badge tone={state.site.mode === "demo" || (provider?.configured && provider.available) ? "green" : "amber"}>{state.site.mode === "demo" ? "샘플 데이터" : provider ? providerLabel(provider) : "과거 수집 모델"}</Badge><p>{state.site.mode === "demo" ? "제품 체험을 위한 합성 답변이에요. 해당 서비스의 실제 응답이 아니에요." : provider?.description || "제공자 API의 답변이에요. 소비자 서비스의 답변과 다를 수 있어요."}</p><div className="d-model-stat"><span>완료 답변</span><strong>{metrics.answerCount}개</strong></div><div className="d-model-stat"><span>브랜드 언급률</span><strong>{metrics.answerCount ? `${numberLabel(metrics.mentionRate)}%` : "측정 불가"}</strong></div><div className="d-model-stat"><span>브랜드 인용률</span><strong>{metrics.citationRate === null ? "측정 불가" : `${numberLabel(metrics.citationRate)}%`}</strong></div></div></Panel>; })}</div><RunHistory runs={state.runs} /></>; }

function Personas({ state, onAdd, onEdit, onDelete, onUse, busy }: { state: SiteState; onAdd: () => void; onEdit: (p: Persona) => void; onDelete: (p: Persona) => void; onUse: (p: Persona) => void; busy: boolean }) { return state.personas?.length ? <div className="d-grid-3">{state.personas.map(persona => <Panel className="d-persona-card" key={persona.id}><div className="d-card-body"><div className="d-row-inline" style={{ justifyContent: "space-between" }}><span className="d-persona-icon"><Users size={17} /></span><div className="d-table-actions"><button className="d-icon-button" aria-label={`${persona.name} 편집`} onClick={() => onEdit(persona)}><Pencil size={13} /></button><button className="d-icon-button" aria-label={`${persona.name} 삭제`} onClick={() => onDelete(persona)}><Trash2 size={13} /></button></div></div><h3>{persona.name}</h3><p>{persona.description}</p><blockquote>{persona.promptPrefix}</blockquote><Button onClick={() => onUse(persona)} busy={busy}><Plus size={12} />이 관점으로 질문 3개 생성</Button></div></Panel>)}</div> : <Panel><Empty icon={<Users size={24} strokeWidth={1.4} />} title="아직 등록한 고객 페르소나가 없어요" text="고객의 상황과 필요를 등록하면 해당 고객이 물어볼 만한 질문을 만들 수 있어요." action={<Button variant="primary" onClick={onAdd}><Plus size={13} />페르소나 만들기</Button>} /></Panel>; }

const documentFormats: Record<string, string> = { article: "아티클", comparison: "비교 글", faq: "FAQ", report: "리포트", listicle: "목록형 글", "how-to": "가이드" };
function Documents({ documents, kind, onOpen, onCreate, onAgent }: { documents: SavedDocument[]; kind: "content" | "report"; onOpen: (d: SavedDocument) => void; onCreate: () => void; onAgent: () => void }) { return <><Panel title={kind === "content" ? "내 콘텐츠" : "저장된 리포트"} subtitle={kind === "content" ? `문서 ${documents.length}개 · 초안은 게시 전에 사실관계를 검토하세요.` : `문서 ${documents.length}개 · 분석 조건은 문서마다 생성 당시 기준으로 기록돼요.`} action={<Button onClick={onAgent}><BookOpen size={13} />에이전트로 만들기</Button>}>{documents.length ? documents.map(doc => <div className="d-document-row" key={doc.id}><span className="d-document-icon">{kind === "content" ? <FileText size={19} strokeWidth={1.4} /> : <BarChart3 size={19} strokeWidth={1.4} />}</span><div className="d-document-info"><h3>{doc.title}</h3><p>{dateLabel(doc.createdAt)} 생성 · {documentFormats[doc.format] || doc.format || "문서"} · {doc.mode === "demo" ? "샘플" : "초안"} · {savedAnalysisLabel(doc.content)}</p></div><Button onClick={() => onOpen(doc)}><Pencil size={12} />열기</Button><button className="d-icon-button" aria-label="문서 다운로드" onClick={() => downloadFile(`${doc.title.replaceAll("/", "-")}.md`, doc.content, "text/markdown;charset=utf-8")}><ArrowDownToLine size={15} /></button></div>) : <Empty icon={<FileText size={25} strokeWidth={1.3} />} title={kind === "content" ? "아직 작성한 콘텐츠가 없어요" : "아직 작성한 리포트가 없어요"} text={kind === "content" ? "주제를 입력하면 수집한 답변과 브랜드 정보를 참고해 콘텐츠 초안을 작성해요." : "수집 결과와 개선할 내용을 리포트 초안으로 정리할 수 있어요."} action={<Button onClick={onCreate} variant="primary"><Sparkles size={13} />{kind === "content" ? "콘텐츠 만들기" : "리포트 생성"}</Button>} />}</Panel></>; }

function Actions({ tasks, onStatus, onEdit, onDelete, onAdd }: { tasks: Task[]; onStatus: (t: Task, s: string) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void; onAdd: () => void }) { const statuses = { todo: "시작 전", in_progress: "진행 중", done: "완료" }; return <><div className="d-grid-3">{Object.entries(statuses).map(([status, label]) => <section className="d-kanban-column" key={status}><div className="d-kanban-title"><span className="d-legend-dot" style={{ background: status === "done" ? "var(--lumen-success)" : status === "in_progress" ? "var(--lumen-warning)" : "var(--lumen-muted)" }} />{label}<span>{tasks.filter(t => t.status === status).length}</span></div>{tasks.filter(t => t.status === status).map(task => <article className="d-task-card" key={task.id}><div className="d-row-inline" style={{ justifyContent: "space-between" }}><Badge tone={task.priority === "high" ? "amber" : task.priority === "medium" ? "purple" : "gray"}>{task.priority === "high" ? "높은 우선순위" : task.priority === "medium" ? "보통" : "낮음"}</Badge><button className="d-icon-button" onClick={() => onEdit(task)} aria-label="작업 편집"><Pencil size={12} /></button></div><h3>{task.title}</h3><TaskDescription text={task.description} /><div className="d-row-inline" style={{ justifyContent: "space-between" }}><select aria-label={`${task.title} 상태`} value={task.status} onChange={e => onStatus(task, e.target.value)}>{Object.entries(statuses).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select><button className="d-icon-button" onClick={() => onDelete(task)} aria-label="작업 삭제"><Trash2 size={12} /></button></div></article>)}{status === "todo" && <Button variant="quiet" onClick={onAdd} style={{ width: "100%" }}><Plus size={13} />작업 추가</Button>}</section>)}</div>{!tasks.length && <div className="d-rich-note d-section-space"><Sparkles size={15} /><span>콘텐츠 보완이나 제품 페이지 수정 등 필요한 작업을 등록하고 진행 상태를 관리하세요.</span></div>}</>; }

function TaskDescription({ text }: { text: string }) {
  const evidenceLink = text.match(/^질문 원문: (\/dashboard\/prompts\?[^\s]+)$/m)?.[1];
  return <>{text.length > 280 ? <details className="d-task-evidence"><summary>관측 근거와 완료 기준</summary><p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{text}</p></details> : <p>{text}</p>}{evidenceLink && <a href={evidenceLink} className="d-text-link">질문과 답변 열기<ArrowUpRight size={14} /></a>}</>;
}

function Traffic({ state, flash }: { state: SiteState; flash: (s: string) => void }) { const origin = useSyncExternalStore(subscribeOrigin, () => window.location.origin, () => ""); const script = `<script defer src="${origin}/api/track.js?key=${state.site.trackingKey}"></script>`; return <><div className="d-tracking-stats"><Panel className="d-mini-stat"><span>수집된 전체 방문</span><strong>{numberLabel(state.traffic.totalVisits)}</strong></Panel><Panel className="d-mini-stat"><span>AI 유입으로 확인된 방문</span><strong>{numberLabel(state.traffic.aiVisits)}</strong></Panel><Panel className="d-mini-stat"><span>AI 추천 방문 비중</span><strong>{state.traffic.totalVisits ? `${numberLabel(state.traffic.aiVisits / state.traffic.totalVisits * 100)}%` : "—"}</strong></Panel></div><Panel title="AI 추천 방문 추이" subtitle={state.site.mode === "demo" ? "샘플 데이터예요. 실제 방문을 수집한 결과가 아니에요" : "실제 수집된 방문 이벤트만 표시해요"}>{state.traffic.totalVisits ? <TrendChart label="AI 추천 방문" suffix="" data={state.traffic.series.map(s => ({ date: s.date, value: s.aiVisits }))} /> : <Empty icon={<TrendingUp size={25} strokeWidth={1.4} />} title="아직 수집된 방문이 없어요" text="웹사이트에 아래 스크립트를 설치하면 방문 데이터를 수집할 수 있어요. 브라우저가 전달한 추천 출처를 기준으로 AI 유입을 식별해요." />}</Panel><Panel className="d-section-space" title="웹사이트 연결" subtitle={`${state.site.domain}의 페이지에 추적 스크립트를 추가하세요`} action={<Badge tone={state.site.mode === "demo" ? "gray" : state.traffic.totalVisits > 0 ? "green" : "gray"}>{state.site.mode === "demo" ? "샘플 데이터" : state.traffic.totalVisits > 0 ? "방문 기록 있음" : "방문 기록 대기 중"}</Badge>}><div className="d-card-body"><div className="d-rich-note"><Info size={15} /><span>{state.traffic.note || "추천 정보가 전달되지 않는 방문은 AI 유입으로 분류할 수 없어요."} 외부 웹사이트의 방문을 수집하려면 Lumen의 방문 수집 주소에 공개적으로 접근할 수 있어야 해요.</span></div><pre className="d-code">{state.site.mode === "demo" ? "실제 브랜드 워크스페이스를 만들면 추적 스크립트가 제공돼요." : script}</pre><Button disabled={state.site.mode === "demo"} onClick={async () => { try { await navigator.clipboard.writeText(script); flash("추적 스크립트를 복사했어요"); } catch { flash("브라우저에서 복사를 허용해 주세요"); } }}><Copy size={12} />스크립트 복사</Button></div></Panel><div className="d-grid-2 d-section-space"><Panel title="추천 출처"><div className="d-card-body">{state.traffic.sources.length ? state.traffic.sources.map(s => <div className="d-stat-pair" key={s.source}><span>{s.source}</span><strong>{s.visits}회</strong></div>) : <p className="d-muted">수집된 출처가 없어요.</p>}</div></Panel><Panel title="방문한 페이지"><div className="d-card-body">{state.traffic.pages.length ? state.traffic.pages.map(s => <div className="d-stat-pair" key={s.path}><span>{s.path}</span><strong>{s.visits}회</strong></div>) : <p className="d-muted">수집된 페이지가 없어요.</p>}</div></Panel></div></>; }

function Settings({ state, user, onEdit, onDelete }: { state: SiteState; user: { name: string; email: string; guest?: boolean }; onEdit: () => void; onDelete: () => void }) { return <div className="d-settings-grid"><div><Panel title="브랜드 정보" subtitle="질문과 콘텐츠 생성의 기준이 돼요" action={<Button onClick={onEdit}><Pencil size={12} />편집</Button>}><div className="d-card-body">{[["브랜드", state.site.name], ["웹사이트", state.site.domain], ["제품 분야", state.site.industry || "미설정"], ["언어", ({ ko: "한국어", en: "English", ja: "日本語" } as Record<string, string>)[state.site.language] || state.site.language], ["국가", ({ KR: "대한민국", US: "미국", JP: "일본", GB: "영국" } as Record<string, string>)[state.site.country] || state.site.country], ["설명", state.site.description || "미설정"]].map(([name, value]) => <div className="d-setting-row" key={name}><strong style={{ minWidth: 65 }}>{name}</strong><p style={{ maxWidth: 280, textAlign: "right", lineHeight: 1.8 }}>{value}</p></div>)}</div></Panel><Panel title="워크스페이스 관리" className="d-section-space"><div className="d-card-body"><div className="d-setting-row"><div><strong>소유자</strong><p>{user.guest ? "로그인 없이 샘플을 보는 중" : user.email}</p></div><Badge tone={user.guest ? "gray" : "green"}>{user.guest ? "게스트" : "Google 계정"}</Badge></div><div className="d-setting-row"><div><strong>워크스페이스 삭제</strong><p>이 워크스페이스의 앱 데이터가 삭제돼요. 계정 사용량 기록, 외부 제공자 데이터와 내려받은 파일은 별도예요.</p></div><Button variant="danger" onClick={onDelete}>삭제</Button></div></div></Panel></div><div><Panel title="AI 제공자 연결" subtitle="AI 제공자별 연결 상태와 사용 가능한 모델"><div className="d-card-body">{state.providers.map(provider => <div className="d-setting-row" key={provider.id}><div><strong>{provider.name}</strong><p>{provider.description}</p><span className="d-run-table-code">{provider.model}</span></div><Badge tone={provider.configured && provider.available ? "green" : "amber"}>{providerLabel(provider)}</Badge></div>)}<div className="d-rich-note" style={{ marginTop: 20, marginBottom: 0 }}><ShieldCheck size={15} /><span>비밀 키는 브라우저에 전달하지 않아요. 현재 사용할 수 있는 모델만 실행할 수 있으며, 유료 모델로 자동 전환하지 않아요.</span></div></div></Panel><Panel title="지표를 읽는 방법" className="d-section-space"><div className="d-card-body"><div className="d-setting-row"><div><strong>언급률과 인용률</strong><p>언급은 답변 본문, 인용은 제공자의 출처 표시를 기준으로 계산해요.</p></div></div><div className="d-setting-row"><div><strong>분석 기준</strong><p>요약과 표, 답변 원문은 선택한 기간과 모델의 전체 답변을 기준으로 해요. 언급률은 완료 답변만 집계하며 실패와 진행 중인 답변은 별도로 표시해요.</p></div></div><div className="d-setting-row"><div><strong>표본의 한계</strong><p>AI 답변은 질문, 수집 시점, 모델에 따라 달라져요. 이 지표가 실제 구매나 검색량을 뜻하지는 않아요.</p></div></div></div></Panel></div></div>; }


function DocumentEditor({ document, readOnly, onSave, onClose }: { document: SavedDocument; readOnly: boolean; onSave: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState(document.content); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [mode, setMode] = useState<"read" | "edit">("read");
  return <Modal title={document.title} subtitle={`${document.mode === "demo" ? "샘플 문서" : "초안"} · ${savedAnalysisLabel(document.content)}`} onClose={onClose} wide><div className="d-modal-content">
    <div className="d-run-tabs"><button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")}>읽기</button>{!readOnly && <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Markdown 편집</button>}<div className="d-run-tools"><Button onClick={() => downloadFile(`${document.title.replaceAll("/", "-")}.md`, text, "text/markdown;charset=utf-8")}><ArrowDownToLine size={13} />내려받기</Button>{mode === "edit" && <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); setError(""); try { await onSave(text); setMode("read"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Check size={13} />저장</Button>}</div></div>
    {error && <p className="d-error">{error}</p>}
    {mode === "read" ? <MarkdownContent className="d-answer">{text}</MarkdownContent> : <textarea className="d-editor" aria-label="문서 내용 편집" value={text} onChange={e => setText(e.target.value)} />}
  </div></Modal>;
}
