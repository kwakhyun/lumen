'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { analyticsAllowed, CONSENT_KEY, createLandingAnalytics, parseConsent, serializeConsent } from '@/lib/landing-analytics';
import type { AnalyticsConsent as Consent } from '@/lib/landing-analytics';
import './analytics-consent.css';
export function AnalyticsConsent() {
  const [open, setOpen] = useState(false), [choice, setChoice] = useState<Consent | null>(null), [eligible, setEligible] = useState(false), [storageUnavailable, setStorageUnavailable] = useState(false);
  const controller = useRef<ReturnType<typeof createLandingAnalytics> | null>(null), trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const runtime = createLandingAnalytics(window, document, process.env.NODE_ENV === 'production'); controller.current = runtime;
    setEligible(analyticsAllowed(window.location, process.env.NODE_ENV === 'production'));
    const sync = () => { let saved: Consent | null = null; try { saved = parseConsent(window.localStorage.getItem(CONSENT_KEY)); } catch { setStorageUnavailable(true); } setChoice(saved); setOpen(saved === null); runtime.apply(saved); };
    sync();
    const changed = (event: StorageEvent) => { if (event.key === CONSENT_KEY || event.key === null) sync(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) sync(); };
    window.addEventListener('storage', changed); window.addEventListener('pageshow', restored);
    return () => { runtime.dispose(); controller.current = null; window.removeEventListener('storage', changed); window.removeEventListener('pageshow', restored); };
  }, []);
  function choose(value: Consent) {
    try { window.localStorage.setItem(CONSENT_KEY, serializeConsent(value)); setStorageUnavailable(false); } catch { setStorageUnavailable(true); }
    setChoice(value); controller.current?.apply(value); setOpen(false); trigger.current?.focus();
  }
  return <><button ref={trigger} type="button" className="analytics-preferences" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="analytics-consent-panel">방문 통계 설정</button>{open && <section id="analytics-consent-panel" className="analytics-consent" role="dialog" aria-labelledby="analytics-consent-title" aria-describedby="analytics-consent-description">
    <div className="analytics-consent-heading"><h2 id="analytics-consent-title">방문 통계 수집을 허용할까요?</h2><button type="button" className="analytics-close" aria-label="설정 닫기" onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></div>
    <p id="analytics-consent-description">허용하면 Google Analytics가 쿠키를 사용해 소개 페이지의 방문 수, 유입 도메인과 브라우저 기본 정보를 분석합니다. 대시보드, 질문, 답변과 계정 정보는 보내지 않습니다. 거절해도 모든 기능을 이용할 수 있습니다.</p>
    <p className="analytics-consent-note">{!eligible ? '로컬 환경이나 통계 수집이 허용되지 않은 미리보기에서는 방문 정보를 전송하지 않습니다.' : choice === 'granted' ? '현재 방문 통계 수집을 허용하고 있습니다. 언제든 아래에서 변경할 수 있습니다.' : choice === 'denied' ? '현재 방문 통계 수집을 허용하지 않아 정보를 전송하지 않습니다.' : '허용하기 전에는 Google Analytics를 실행하지 않습니다.'}{storageUnavailable && ' 브라우저에서 설정을 저장할 수 없어 현재 페이지에서만 선택이 적용됩니다.'}</p>
    <div className="analytics-consent-actions"><a href="/privacy#landing-analytics">수집 정보 확인</a><div><button type="button" onClick={() => choose('denied')}>허용하지 않기</button><button type="button" onClick={() => choose('granted')}>방문 통계 허용</button></div></div>
  </section>}</>;
}
