"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardScope } from "@/lib/dashboard-scope";
import type { AgentDefinition, AgentEvent, AgentRun } from "@/lib/agents/types";
import type { Document as SavedDocument } from "@/lib/product-types";
import { requestJson, streamEvents } from "./client";

export type AgentEngine = { model: string | null; units: number };
type AgentList = { agents: AgentDefinition[]; runs: AgentRun[]; engine: AgentEngine };
export type LiveRun = { run: AgentRun; activity: string; startedAt: number };

/** Loads agent templates and history for one workspace and drives a streamed run. */
export function useAgents(siteId: string, onChanged: () => Promise<unknown> | void) {
  // Keyed by workspace: switching workspaces never shows the previous one's runs.
  const [store, setStore] = useState<{ siteId: string; list: AgentList } | null>(null);
  const [error, setError] = useState("");
  const [liveState, setLive] = useState<(LiveRun & { siteId: string }) | null>(null);
  const current = useRef(siteId);
  const running = useRef(false);
  const data = store?.siteId === siteId ? store.list : null;
  const live = liveState?.siteId === siteId ? liveState : null;

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(key => key + 1), []);
  useEffect(() => {
    current.current = siteId;
    if (!siteId) return;
    let active = true;
    requestJson<AgentList>(`/api/sites/${siteId}/agents`)
      .then(next => { if (active) { setStore({ siteId, list: next }); setError(""); } })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [siteId, reloadKey]);

  const setRuns = useCallback((update: (runs: AgentRun[]) => AgentRun[]) => setStore(previous => previous ? { ...previous, list: { ...previous.list, runs: update(previous.list.runs) } } : previous), []);
  const replaceRun = useCallback((run: AgentRun) => setRuns(runs => runs.some(item => item.id === run.id) ? runs.map(item => item.id === run.id ? run : item) : [run, ...runs.filter(item => item.persisted)]), [setRuns]);

  const start = useCallback(async (agentId: string, input: Record<string, string>, scope: DashboardScope): Promise<AgentRun | null> => {
    if (running.current || !siteId) return null;
    running.current = true;
    const target = siteId; let finished: AgentRun | null = null;
    try {
      await streamEvents<AgentEvent>(`/api/sites/${target}/agents`, { agentId, input, scope }, event => {
        if (current.current !== target) return;
        if (event.type === "run") setLive({ siteId: target, run: event.run, activity: "", startedAt: Date.now() });
        else if (event.type === "step") setLive(previous => previous ? { ...previous, activity: "", run: { ...previous.run, steps: previous.run.steps.map(step => step.id === event.id ? { ...step, status: event.status, detail: event.detail ?? step.detail } : step) } } : previous);
        else if (event.type === "activity") setLive(previous => previous ? { ...previous, activity: event.text } : previous);
        else if (event.type === "done") { finished = event.run; setLive(previous => previous ? { ...previous, activity: "", run: event.run } : previous); replaceRun(event.run); }
      });
      if (finished) await onChanged();
      return finished;
    } finally { running.current = false; }
  }, [siteId, onChanged, replaceRun]);

  const decide = useCallback(async (run: AgentRun, proposalId: string, action: "accept" | "dismiss") => {
    const result = await requestJson<{ run: AgentRun }>(`/api/sites/${siteId}/agents/${run.id}`, "PATCH", { proposalId, action });
    replaceRun(result.run); setLive(previous => previous?.run.id === run.id ? { ...previous, run: result.run } : previous);
    if (action === "accept") await onChanged();
    return result.run;
  }, [siteId, onChanged, replaceRun]);

  const saveDocument = useCallback(async (run: AgentRun) => {
    const result = await requestJson<{ document: SavedDocument }>(`/api/sites/${siteId}/agents/${run.id}/document`, "POST");
    await onChanged();
    return result.document;
  }, [siteId, onChanged]);

  const remove = useCallback(async (run: AgentRun) => {
    if (run.persisted) await requestJson(`/api/sites/${siteId}/agents/${run.id}`, "DELETE");
    setRuns(runs => runs.filter(item => item.id !== run.id));
  }, [siteId, setRuns]);

  return { agents: data?.agents || [], runs: data?.runs || [], engine: data?.engine || null, loading: !data && !error, error, live, clearLive: () => setLive(null), start, decide, saveDocument, remove, reload };
}
export type AgentsController = ReturnType<typeof useAgents>;
