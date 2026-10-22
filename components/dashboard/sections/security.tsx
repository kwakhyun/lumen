'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Copy, ExternalLink, FileJson, Info, Plus, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import type { SiteState } from '@/lib/product-types';
import { SECURITY_REQUEST_BYTES, type SecurityCheck, type SecurityChecksResponse, type SecurityEvidence, type SecurityFinding } from '@/lib/security-types';
import { assessSecurityEvidence, compareSecurityChecks } from '@/lib/security-assessment';
import { latestSecurityChecks, prepareSecurityImport, securityCollectorCommand, securityOriginForDomain, securityReport } from '../security-view';
import { requestJson, useResource } from '../client';
import { Badge, Button, Empty, Panel, Skeleton, downloadFile } from '../ui';
import '../security.css';

const stateNames = { pass: '설정 확인', attention: '개선 검토', unknown: '확인 불가' };
const categoryNames = { security: '보안 관련 설정', discovery: '검색 접근 설정' };
const toolUrl = 'https://github.com/kwakhyun/lumen/blob/main/SECURITY_CHECKS.md';
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : '요청을 완료하지 못했어요. 다시 시도해 주세요.';
const localDateTime = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export default function Security({ state }: { state: SiteState }) {
  if (state.site.mode === 'demo') return <div className="d-stack d-security"><ScopeNote /><Panel><Empty icon={<ShieldCheck size={28} />} title="실제 브랜드에서 웹사이트를 점검하세요" text="샘플 워크스페이스에는 실제 점검 결과를 가져올 수 없어요. 내 브랜드를 선택한 뒤 권한이 있는 웹사이트에서 수집 도구를 실행하세요." /></Panel></div>;
  return <SecurityWorkspace key={state.site.id} state={state} />;
}

function ScopeNote() {
  return <div className="d-rich-note"><Info size={18} /><span>공개 홈페이지의 보안 헤더와 검색 접근 설정을 확인합니다. 서버 내부, 로그인과 권한, 취약한 소스 코드는 검사하지 않으며 서비스 전체의 안전성을 보증하지 않습니다. AI 호출 없이 무료로 사용할 수 있어요.</span></div>;
}

function SecurityWorkspace({ state }: { state: SiteState }) {
  const siteId = state.site.id;
  const resource = useResource<SecurityChecksResponse>(`/api/security-checks?siteId=${encodeURIComponent(siteId)}`);
  const [pending, setPending] = useState<{ evidence: SecurityEvidence; filename: string; requestId: string } | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createdTasks, setCreatedTasks] = useState<string[]>([]);
  const fileId = useId();
  const active = useRef(false);
  const readSequence = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const origin = securityOriginForDomain(state.site.domain);
  const command = securityCollectorCommand(state.site.domain);
  const { latest, previous } = latestSecurityChecks(resource.data?.checks || []);
  const previewFindings = pending ? assessSecurityEvidence(pending.evidence) : [];

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; readSequence.current += 1; mutation.current?.abort(); mutation.current = null; };
  }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const sequence = ++readSequence.current;
    setPending(null); setAuthorized(false); setReading(false); setError(''); setNotice('');
    if (!file || !origin) return;
    if (file.size > SECURITY_REQUEST_BYTES) { setError('파일은 32 KiB 이하여야 해요. 수집 도구가 만든 JSON 파일을 선택하세요.'); return; }
    setReading(true);
    try {
      const raw = await file.text();
      if (!active.current || sequence !== readSequence.current) return;
      const evidence = prepareSecurityImport(raw, origin);
      setPending({ evidence, filename: file.name, requestId: crypto.randomUUID() });
    } catch (cause) { if (active.current && sequence === readSequence.current) setError(messageOf(cause)); }
    finally { if (active.current && sequence === readSequence.current) setReading(false); }
  }

  async function saveEvidence() {
    if (!pending || !authorized || mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller; setBusy('import'); setError(''); setNotice('');
    try {
      const result = await requestJson<SecurityChecksResponse>('/api/security-checks', 'POST', { action: 'import', siteId, requestId: pending.requestId, evidence: pending.evidence }, { signal: controller.signal });
      if (!active.current || controller.signal.aborted || mutation.current !== controller) return;
      resource.setData(result); setPending(null); setAuthorized(false);
      setNotice(result.cached ? '이미 저장된 결과를 확인했어요. 같은 기록을 중복 저장하지 않았어요.' : '점검 결과를 저장했어요. 개선할 항목을 검토하고 필요한 작업을 추가하세요.');
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(messageOf(cause)); }
    finally { if (active.current && mutation.current === controller) { mutation.current = null; setBusy(''); } }
  }

  async function createTask(check: SecurityCheck, finding: SecurityFinding) {
    if (mutation.current) return;
    const controller = new AbortController();
    const taskKey = `${check.id}:${finding.id}`;
    mutation.current = controller; setBusy(taskKey); setError(''); setNotice('');
    try {
      const result = await requestJson<{ taskId: string; cached: boolean }>('/api/security-checks', 'POST', { action: 'create_task', siteId, checkId: check.id, findingId: finding.id }, { signal: controller.signal });
      if (!active.current || controller.signal.aborted || mutation.current !== controller) return;
      setCreatedTasks(values => [...values, taskKey]);
      setNotice(result.cached ? '이 항목의 개선 작업이 이미 있어요. ‘개선 관리’에서 확인하세요.' : '개선 작업을 추가했어요. 설정을 변경한 뒤 다시 점검해 결과를 확인하세요.');
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(messageOf(cause)); }
    finally { if (active.current && mutation.current === controller) { mutation.current = null; setBusy(''); } }
  }

  async function copyCommand() {
    if (!command) return;
    try { await navigator.clipboard.writeText(command); if (active.current) setNotice('수집 명령을 복사했어요. 권한이 있는 주소인지 확인한 뒤 터미널에서 실행하세요.'); }
    catch { if (active.current) setError('자동 복사를 사용할 수 없어요. 표시된 명령을 직접 선택해 복사하세요.'); }
  }

  return <div className="d-stack d-security">
    <ScopeNote />
    {notice && <p className="d-security-notice" role="status">{notice}</p>}
    {(error || resource.error) && <div className="d-error" role="alert">{error || resource.error}</div>}
    <Panel title="점검 결과 가져오기" subtitle="내 컴퓨터에서 공개 설정을 수집하고, 내용을 확인한 뒤 이 브랜드에 저장하세요.">
      <ol className="d-security-steps">
        <li><span className="d-security-step">1</span><div><h3>권한이 있는 웹사이트에서 수집</h3><p>현재 브랜드의 주소는 <strong>{origin || state.site.domain}</strong>입니다. 소유하거나 점검 허가를 받은 웹사이트만 실행하세요. 수집기는 홈페이지, robots.txt, sitemap.xml에 비로그인 GET 요청을 각 한 번 보냅니다.</p><p><a className="d-security-link" href={toolUrl} target="_blank" rel="noopener noreferrer">수집 도구와 실행 안내 <ExternalLink size={13} /></a>에서 소스를 받은 뒤 Node.js 22.13 이상 환경의 프로젝트 폴더에서 실행하세요.</p>{command ? <div className="d-security-command"><Terminal size={16} aria-hidden="true" /><code>{command}</code><Button onClick={copyCommand} aria-label="수집 명령 복사"><Copy size={15} />복사</Button></div> : <p className="d-security-warning">사용할 수 있는 HTTPS 주소를 만들지 못했어요. 브랜드 설정에서 경로와 포트가 없는 공개 도메인을 확인하세요.</p>}</div></li>
        <li><span className="d-security-step">2</span><div><h3>수집한 JSON 파일 확인</h3><p id={`${fileId}-hint`}>lumen-web-check.json 파일을 선택하세요. 최대 32 KiB이며, 선택만으로 서버에 전송하거나 저장하지 않습니다.</p><label className="d-security-file-label" htmlFor={fileId}>수집 결과 파일</label><input id={fileId} className="d-security-file" type="file" accept=".json,application/json" aria-describedby={`${fileId}-hint`} disabled={Boolean(busy) || !origin} onChange={chooseFile} />{reading && <p className="d-caption" role="status">파일 내용을 확인하고 있어요.</p>}</div></li>
        <li><span className="d-security-step">3</span><div><h3>결과를 검토하고 저장</h3>{pending ? <div className="d-security-preview"><div className="d-row-inline"><Badge tone="blue">저장 전 미리보기</Badge><span className="d-caption">{pending.filename}</span></div><dl className="d-security-metadata"><div><dt>대상 주소</dt><dd>{pending.evidence.targetOrigin}</dd></div><div><dt>관측 시각</dt><dd>{localDateTime(pending.evidence.observedAt)} KST</dd></div><div><dt>수집 버전</dt><dd>{pending.evidence.collector}</dd></div></dl><FindingCounts findings={previewFindings} /><details className="d-security-preview-items"><summary>항목별 상태 미리보기</summary><ul>{previewFindings.map(finding => <li key={finding.id}><div className="d-row-inline"><strong>{finding.title}</strong><Badge tone={finding.state === 'attention' ? 'amber' : finding.state === 'pass' ? 'green' : 'gray'}>{stateNames[finding.state]}</Badge></div><p>{finding.detail}</p></li>)}</ul></details><p>헤더와 쿠키의 원문이나 값은 저장하지 않아요. 이 파일은 사용자가 제공한 관측 자료이며 Lumen이 사이트 소유권이나 수집 사실을 독립적으로 확인한 자료는 아닙니다.</p><label className="d-security-consent"><input type="checkbox" checked={authorized} disabled={Boolean(busy)} onChange={event => setAuthorized(event.target.checked)} /><span>이 웹사이트를 소유하거나 점검 허가를 받았으며, 표시된 주소와 관측 시각을 확인했어요.</span></label><div className="d-row-inline"><Button variant="primary" busy={busy === 'import'} disabled={!authorized || Boolean(busy)} onClick={saveEvidence}><FileJson size={16} />결과 저장</Button><Button disabled={Boolean(busy)} onClick={() => { setPending(null); setAuthorized(false); }}>취소</Button></div></div> : <p>파일을 선택하면 주소, 관측 시각과 항목별 상태를 확인할 수 있어요. ‘결과 저장’을 눌러야 워크스페이스에 반영됩니다.</p>}</div></li>
      </ol>
    </Panel>

    {resource.loading && !resource.data ? <Skeleton /> : latest ? <>
      <Panel title="최근 점검 결과" subtitle="관측 시각이 가장 최근인 결과입니다. 저장한 순서와 관측한 순서는 다를 수 있어요." action={<div className="d-row-inline"><Button disabled={Boolean(busy) || resource.loading} onClick={() => void resource.refresh()} aria-label="점검 결과 새로고침"><RefreshCw size={15} /></Button><Button onClick={() => downloadFile(`lumen-web-report-${latest.evidence.observedAt.slice(0, 10)}.json`, JSON.stringify(securityReport(latest, previous), null, 2), 'application/json')}><ArrowDownToLine size={15} />보고서 JSON</Button></div>}>
        <div className="d-security-summary"><div className="d-row-inline"><Badge tone="blue">사용자가 가져온 관측 자료</Badge><span className="d-caption">{latest.evidence.collector}</span></div><h3>{latest.evidence.targetOrigin}</h3><p><time dateTime={latest.evidence.observedAt}>{localDateTime(latest.evidence.observedAt)} KST 관측</time><span className="d-caption"> / {localDateTime(latest.createdAt)} KST 저장</span></p><FindingCounts findings={latest.findings} /><p className="d-caption">‘설정 확인’은 해당 설정을 관측했다는 뜻입니다. ‘확인 불가’는 자료 부족이나 추가 검토가 필요한 상태이며, 안전하거나 문제가 없다는 뜻이 아닙니다.</p></div>
      </Panel>
      <Comparison latest={latest} previous={previous} />
      {(['security', 'discovery'] as const).map(category => <Panel key={category} title={categoryNames[category]} subtitle={category === 'security' ? '권장 설정이 빠진 이유와 서비스 요구 사항을 확인한 뒤 변경하세요.' : '검색에 공개하려는 페이지의 설정입니다. 봇 허용만으로 실제 색인이나 AI 답변 노출이 보장되지는 않아요.'}><div className="d-security-findings">{latest.findings.filter(finding => finding.category === category).map(finding => {
        const taskKey = `${latest.id}:${finding.id}`;
        const added = createdTasks.includes(taskKey);
        return <article className="d-security-finding" key={finding.id}><div className="d-security-finding-title"><h3>{finding.title}</h3><Badge tone={finding.state === 'pass' ? 'green' : finding.state === 'attention' ? 'amber' : 'gray'}>{stateNames[finding.state]}</Badge></div><p>{finding.detail}</p><details><summary>검토할 내용과 참고 자료</summary><p>{finding.recommendation}</p><a className="d-security-link" href={finding.referenceUrl} target="_blank" rel="noopener noreferrer">공식 참고 자료 <ExternalLink size={13} /></a></details>{finding.state === 'attention' && <div className="d-security-finding-action"><Button disabled={Boolean(busy) || added} busy={busy === taskKey} onClick={() => createTask(latest, finding)}>{added ? <Check size={14} /> : <Plus size={14} />}{added ? '개선 작업 추가됨' : '개선 작업 추가'}</Button></div>}</article>;
      })}</div></Panel>)}
      <div className="d-security-next"><p>작업을 완료로 표시해도 점검 상태는 바뀌지 않습니다. 변경 후 같은 도구로 다시 수집하고 결과를 가져오세요.</p><a className="d-security-link" href={`/dashboard/actions?site=${encodeURIComponent(siteId)}`}>개선 관리에서 작업 보기 <ArrowRight size={15} /></a></div>
      <details className="d-security-history"><summary>저장된 관측 기록 {resource.data?.checks.length || 0}건</summary><ul>{[...(resource.data?.checks || [])].sort((a, b) => Date.parse(b.evidence.observedAt) - Date.parse(a.evidence.observedAt)).map(check => <li key={check.id}><time dateTime={check.evidence.observedAt}>{localDateTime(check.evidence.observedAt)} KST</time><span>{check.evidence.targetOrigin}</span><Badge tone="gray">{check.evidence.collector}</Badge></li>)}</ul><p className="d-caption">브랜드당 최대 20건, 1 MiB까지 보관하며 기존 기록을 자동으로 삭제하지 않습니다. 보고서에는 워크스페이스와 작업의 내부 ID를 포함하지 않습니다.</p></details>
    </> : <Panel><Empty icon={<ShieldCheck size={28} />} title={resource.error ? '저장된 결과를 불러오지 못했어요' : '아직 저장한 점검 결과가 없어요'} text={resource.error ? '기존 기록은 유지됩니다. 연결 상태를 확인한 뒤 다시 불러오세요.' : '위의 수집 도구를 실행하고 첫 결과를 가져오세요. 공개 설정에서 확인된 항목과 추가 검토가 필요한 항목을 구분해 보여드립니다.'} action={resource.error ? <Button onClick={() => void resource.refresh()}><RefreshCw size={15} />다시 불러오기</Button> : undefined} /></Panel>}
  </div>;
}

function FindingCounts({ findings }: { findings: SecurityFinding[] }) {
  return <dl className="d-security-counts">{(['attention', 'pass', 'unknown'] as const).map(state => <div key={state}><dt>{stateNames[state]}</dt><dd>{findings.filter(finding => finding.state === state).length}<span>개 항목</span></dd></div>)}</dl>;
}

function Comparison({ latest, previous }: { latest: SecurityCheck; previous?: SecurityCheck }) {
  const comparison = previous ? compareSecurityChecks(previous, latest) : null;
  const names = new Map(latest.findings.map(finding => [finding.id, finding.title]));
  return <Panel title="이전 점검과 비교" subtitle={previous ? `${localDateTime(previous.evidence.observedAt)} → ${localDateTime(latest.evidence.observedAt)} KST` : '같은 주소와 수집 버전의 이전 기록이 있어야 비교할 수 있어요.'}><div className="d-security-comparison">{comparison?.comparable ? <><div className="d-security-comparison-grid">{[{ title: '설정 개선 확인', ids: comparison.improved }, { title: '새로 검토할 항목', ids: comparison.regressed }, { title: '변화 판단 불가', ids: comparison.unobserved }].map(group => <div key={group.title}><h3>{group.title} <span>{group.ids.length}개</span></h3>{group.ids.length ? <ul>{group.ids.map(id => <li key={id}>{names.get(id) || id}</li>)}</ul> : <p>해당 항목 없음</p>}</div>)}</div><p className="d-caption">{comparison.reason} 관측되지 않은 항목을 개선으로 계산하지 않습니다.</p></> : <p className="d-muted">{comparison?.reason || '첫 결과를 기준으로 설정을 검토하세요. 변경 후 다시 수집하면 확인 가능한 항목의 변화만 표시합니다.'}</p>}</div></Panel>;
}
