"use client";

import type { Run } from "@/lib/product-types";
import { modelLabel as modelName } from "../client";
import { Badge, Empty, Panel } from "../ui";

const runNames: Record<string, string> = { queued: "대기 중", running: "수집 중", completed: "완료", partial: "일부 완료", failed: "실패" };

export default function RunHistory({ runs }: { runs: Run[] }) { return <Panel className="d-section-space" title="수집 기록" subtitle="최근 수집의 진행 상태와 성공, 실패 건수를 확인하세요.">{runs.length ? <div className="d-table-wrap"><table className="d-table"><thead><tr><th>시작 시간</th><th>모델</th><th>유형</th><th>수집 결과</th><th>상태</th></tr></thead><tbody>{runs.slice(0, 8).map(run => <tr key={run.id}><td>{new Date(run.createdAt).toLocaleString("ko-KR")}</td><td>{run.models.map(modelName).join(", ")}</td><td><Badge>{run.mode === "demo" ? "샘플" : "실제 API"}</Badge></td><td>{run.completed} / {run.total}{run.failed > 0 ? ` (${run.failed}개 실패)` : ""}</td><td><Badge tone={run.status === "completed" ? "green" : run.status === "failed" ? "amber" : "gray"}>{runNames[run.status]}</Badge>{run.error && <p className="d-table-sub" style={{ maxWidth: 220, whiteSpace: "normal" }}>{/^\d+ answers? could not be collected\./.test(run.error) ? `답변 ${run.failed}개를 수집하지 못했어요. 질문을 눌러 실패 이유를 확인하세요.` : run.error}</p>}</td></tr>)}</tbody></table></div> : <Empty title="아직 수집 기록이 없어요" text="질문을 추가하고 답변을 수집하면 기록이 표시돼요." />}</Panel>; }

