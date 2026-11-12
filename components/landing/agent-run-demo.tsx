"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";

const KPIS = [
  { label: "언급률", value: "62%", basis: "답변 21건 중 13건" },
  { label: "언급 점유율", value: "34%", basis: "브랜드 4곳 가운데" },
  { label: "인용률", value: "41%", basis: "검색 답변 17건 중 7건" },
] as const;
const PROPOSALS = [
  { kind: "작업", title: "가격 비교 페이지에 요금제 표 추가", reason: "가격 질문 5개 중 4개에서 경쟁사만 언급돼요" },
  { kind: "질문", title: "‘원격 근무’ 주제 질문 3개 추가", reason: "이 주제는 수집한 답변이 2건뿐이에요" },
] as const;

/**
 * A looping illustration of one agent run: steps tick off, figures, a quoted answer and a summary appear,
 * then one proposal is approved. Server-rendered in its finished state, so it reads
 * correctly without JavaScript and under reduced motion.
 */
export function AgentRunDemo({ name, steps }: { name: string; steps: string[] }) {
  const total = steps.length, settled = total + 2;
  const [tick, setTick] = useState(settled);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0, started = false;
    const observer = new IntersectionObserver(([entry]) => {
      window.clearInterval(timer);
      if (!entry.isIntersecting) return;
      if (!started) { started = true; setTick(0); }
      // The finished state is held for a few beats before the run starts over.
      timer = window.setInterval(() => setTick(value => value >= total + 7 ? 0 : value + 1), 900);
    }, { threshold: 0.35 });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, [total]);

  const done = Math.min(tick, total), complete = tick >= total, approved = tick >= settled;
  const show = (visible: boolean) => visible ? "" : undefined;

  return (
    <div className="hm-demo" ref={ref} role="img" aria-label="에이전트 실행 예시. 단계가 차례로 끝나면 지표와 근거 답변, 요약, 제안이 나타나고 제안 하나가 승인돼요.">
      <div className="hm-demo-bar">
        <span className="hm-demo-dots"><i /><i /><i /></span>
        <strong><Sparkles size={14} />{name}</strong>
        <span className="hm-demo-status" data-done={show(complete)}>{complete ? "완료" : "실행 중"}</span>
      </div>
      <div className="hm-demo-body">
        <ol className="hm-demo-steps">
          {steps.map((label, index) => (
            <li key={label} data-state={index < done ? "done" : index === done ? "running" : "pending"}>
              <span className="hm-demo-step-icon">{index < done ? <Check size={12} strokeWidth={3.2} /> : null}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="hm-demo-result">
          <div className="hm-demo-kpis" data-show={show(tick >= 2)}>
            {KPIS.map(kpi => <div key={kpi.label}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.basis}</small></div>)}
          </div>
          <blockquote className="hm-demo-evidence" data-show={show(tick >= total - 2)}>
            <span>근거 답변</span>
            <p>“가격만 놓고 보면 <b>Orbit</b>과 <b>Tandem</b>이 먼저 언급됩니다.”</p>
            <small>팀 협업 도구 가격을 비교해 줘 · 답변 4건 중 1건</small>
          </blockquote>
          <p className="hm-demo-summary" data-show={show(tick >= total - 1)}>
            가격을 비교하는 질문에서 언급이 가장 약해요. 근거 답변 4건을 읽고 먼저 손볼 곳을 정리했어요.
          </p>
          <ul className="hm-demo-proposals" data-show={show(complete)}>
            {PROPOSALS.map((proposal, index) => (
              <li key={proposal.title}>
                <span className="hm-demo-kind">{proposal.kind}</span>
                <div><strong>{proposal.title}</strong><small>{proposal.reason}</small></div>
                <span className="hm-demo-approve" data-approved={show(index === 0 && approved)}>
                  {index === 0 && approved ? <><Check size={13} strokeWidth={3} />승인됨</> : "승인"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="hm-demo-caption">합성 데이터로 구성한 예시 화면이에요</p>
    </div>
  );
}
