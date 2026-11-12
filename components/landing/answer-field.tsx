"use client";

import { useEffect, useRef } from "react";

type Token = string | { brand: string; own?: boolean };
const own = (brand: string): Token => ({ brand, own: true });
const rival = (brand: string): Token => ({ brand });

/**
 * Synthetic answer lines for the hero backdrop. Northstar and its rivals are the fictional
 * brands of the sample workspace; none of these sentences describes a real product.
 */
const ROWS: Token[][][] = [
  [
    ["작은 팀이 쓰기 좋은 협업 도구로는 ", own("Northstar"), ", ", rival("Orbit"), ", ", rival("Tandem"), "이 자주 언급됩니다."],
    ["문서와 프로젝트를 한곳에서 관리하려면 ", own("Northstar"), "를 먼저 비교해 보세요."],
    ["화이트보드 중심으로 일한다면 ", rival("Boardly"), "가 익숙할 수 있습니다."],
  ],
  [
    ["원격 팀에는 ", rival("Orbit"), "의 화상 회의 연동이 강점으로 꼽힙니다."],
    ["가격 대비 기능을 보면 ", rival("Tandem"), "과 ", own("Northstar"), "가 비슷한 평가를 받습니다."],
    ["디자인 리뷰가 잦은 팀은 ", own("Northstar"), "의 댓글 흐름을 선호합니다."],
  ],
  [
    ["스타트업이 처음 도입하기에는 ", own("Northstar"), "의 무료 플랜이 넉넉한 편입니다."],
    ["간단한 할 일 관리만 필요하면 ", rival("Tandem"), "으로 충분합니다."],
    ["보안 설정이 중요하다면 ", rival("Orbit"), "과 ", own("Northstar"), "의 관리 기능을 확인하세요."],
  ],
  [
    ["20명 규모 제품팀이라면 ", own("Northstar"), ", ", rival("Boardly"), " 순으로 검토해 볼 만합니다."],
    ["개발 도구 연동은 ", rival("Orbit"), "이 가장 많이 언급됩니다."],
    ["온보딩이 쉬운 도구로는 ", own("Northstar"), "가 자주 추천됩니다."],
  ],
  [
    ["회의록과 문서를 연결하려면 ", rival("Tandem"), "보다 ", own("Northstar"), "가 적합하다는 평가가 있습니다."],
    ["외부 협력사와 함께 쓰기에는 ", rival("Boardly"), "의 게스트 권한이 편리합니다."],
    ["로드맵 공유 기능은 ", own("Northstar"), "와 ", rival("Orbit"), " 모두 제공합니다."],
  ],
  [
    ["비용을 줄이려는 팀에는 ", rival("Tandem"), "의 연간 요금제가 언급됩니다."],
    ["한국어 지원을 기준으로 보면 ", own("Northstar"), "가 먼저 소개됩니다."],
    ["여러 도구를 하나로 합치려면 ", rival("Orbit"), " 또는 ", own("Northstar"), "를 비교하세요."],
  ],
  [
    ["제품팀과 디자인팀이 함께 쓴다면 ", own("Northstar"), "와 ", rival("Boardly"), "를 나란히 살펴보세요."],
    ["알림이 많은 팀은 ", rival("Orbit"), "의 요약 기능을 유용하게 씁니다."],
    ["처음 써 보는 팀에는 ", own("Northstar"), "의 템플릿이 도움이 됩니다."],
  ],
  [
    ["프로젝트 일정 관리는 ", rival("Tandem"), ", 문서 협업은 ", own("Northstar"), "가 강하다는 답변이 많습니다."],
    ["브레인스토밍 도구로는 ", rival("Boardly"), "가 먼저 언급됩니다."],
    ["팀 위키를 찾는다면 ", own("Northstar"), "를 추천하는 답변이 늘고 있습니다."],
  ],
];

function Row({ sentences }: { sentences: Token[][] }) {
  // Both layers share this markup so the dim and the lit text stay exactly aligned.
  const half = sentences.map((sentence, index) => (
    <span className="hm-field-sentence" key={index}>
      {sentence.map((token, position) => typeof token === "string"
        ? token
        : <b className={token.own ? "own" : undefined} key={position}>{token.brand}</b>)}
    </span>
  ));
  // The line is rendered twice so the loop restarts without a seam.
  return <div className="hm-field-track"><div>{half}</div><div>{half}</div></div>;
}

function Layer({ lit }: { lit: boolean }) {
  return (
    <div className={lit ? "hm-field-layer hm-field-lit" : "hm-field-layer hm-field-dim"}>
      {ROWS.map((sentences, index) => (
        <div className="hm-field-row" data-reverse={index % 2 === 1 ? "" : undefined} style={{ animationDuration: `${118 + index * 13}s` }} key={index}>
          <Row sentences={sentences} />
        </div>
      ))}
    </div>
  );
}

/**
 * Hero backdrop: a wall of dim answer text. A light follows the pointer (or drifts on its own)
 * and the text under it becomes readable, with the brand names picked out.
 */
export function AnswerField() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let width = element.clientWidth, height = element.clientHeight;
    let x = width * 0.72, y = height * 0.34, targetX = x, targetY = y;
    let pointerAt = -Infinity, frame = 0;

    const tick = (time: number) => {
      // Without recent pointer input the light wanders, so touch screens get the effect too.
      if (time - pointerAt > 2400) {
        targetX = width * (0.5 + 0.38 * Math.sin(time / 3300));
        targetY = height * (0.4 + 0.24 * Math.sin(time / 2100 + 1.3));
      }
      x += (targetX - x) * 0.07;
      y += (targetY - y) * 0.07;
      element.style.setProperty("--mx", `${x.toFixed(1)}px`);
      element.style.setProperty("--my", `${y.toFixed(1)}px`);
      frame = requestAnimationFrame(tick);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const box = element.getBoundingClientRect();
      if (event.clientY > box.bottom) return;
      targetX = event.clientX - box.left;
      targetY = event.clientY - box.top;
      pointerAt = performance.now();
    };
    const resize = new ResizeObserver(() => { width = element.clientWidth; height = element.clientHeight; });
    // The loop only runs while the hero is on screen.
    const visibility = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      if (entry.isIntersecting) frame = requestAnimationFrame(tick);
    });
    resize.observe(element);
    visibility.observe(element);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="hm-field" ref={ref} aria-hidden="true">
      <Layer lit={false} />
      <Layer lit />
      <div className="hm-field-glow" />
    </div>
  );
}
