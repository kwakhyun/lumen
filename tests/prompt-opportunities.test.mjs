import { test } from "node:test";
import assert from "node:assert/strict";
import { prioritizePromptOpportunities, summarizePromptEvidence } from "../lib/prompt-opportunities.ts";

const site = { id: "site", domain: "acme.com", mode: "live" };
const prompt = (id, props = {}) => ({ id, siteId: "site", text: id, active: true, pinned: false, ...props });
const mention = (domain, mentioned = true) => ({ domain, mentioned });
const answer = (id, props = {}) => ({ id, siteId: "site", promptId: "q1", mode: "live", status: "completed", createdAt: "2026-11-01T00:00:00Z", completedAt: null, mentions: [], ...props });
const competitors = [{ name: "Rival", domain: "rival.com" }, { name: "Rival duplicate", domain: "WWW.RIVAL.COM." }, { name: "Own duplicate", domain: "acme.com" }];
const summary = (rows, prompts = [prompt("q1")]) => summarizePromptEvidence(site, prompts, competitors, rows);

test("missing, failed and pending observations never become a measured zero mention rate", () => {
  const empty = summary([])[0];
  assert.equal(empty.mentionRate, null);
  assert.equal(empty.hasGap, false);
  assert.equal(empty.latestAt, null);
  const failed = summary([answer("failed", { status: "failed", mentions: [mention("rival.com")] }), answer("pending", { status: "processing" })])[0];
  assert.equal(failed.completedCount, 0);
  assert.equal(failed.failedCount, 1);
  assert.equal(failed.pendingCount, 1);
  assert.equal(failed.mentionRate, null);
  assert.equal(failed.competitorOnlyCount, 0);
  assert.equal(failed.status, "uncollected");
  const zero = summary([answer("completed")])[0];
  assert.equal(zero.mentionRate, 0);
  assert.equal(zero.hasGap, true);
  assert.equal(zero.status, "unmentioned");
});

test("same-period historical answers remain in the denominator and competitor-only requires own absence", () => {
  const rows = [answer("old", { runId: "run-old", mentions: [mention("WWW.ACME.COM."), mention("rival.com")] }), answer("new", { runId: "run-new", mentions: [mention("rival.com"), mention("rival.com")] }), answer("none", { mentions: [] })];
  const value = summary(rows)[0];
  assert.equal(value.completedCount, 3);
  assert.equal(value.mentionCount, 1);
  assert.equal(value.mentionRate, 33.3);
  assert.equal(value.unmentionedCount, 2);
  assert.equal(value.competitorOnlyCount, 1);
  assert.deepEqual(value.competitorNames, ["Rival"]);
});

test("unregistered, removed, lookalike and cited-only brands do not become competitor gaps", () => {
  const rows = [answer("unregistered", { mentions: [mention("removed.com")] }), answer("lookalike", { mentions: [mention("rival.com.attacker.test")] }), answer("cited-only", { mentions: [{ ...mention("rival.com", false), cited: true }] })];
  assert.equal(summary(rows)[0].competitorOnlyCount, 0);
  assert.deepEqual(summary(rows)[0].competitorNames, []);
  const removed = summarizePromptEvidence(site, [prompt("q1")], [], [answer("rival", { mentions: [mention("rival.com")] })])[0];
  assert.equal(removed.competitorOnlyCount, 0);
});

test("duplicate answers, mixed modes, foreign sites and foreign prompts are excluded", () => {
  const same = answer("same", { mentions: [mention("rival.com")] });
  const value = summary([same, same, answer("demo", { mode: "demo" }), answer("foreign", { siteId: "other" }), answer("failed", { status: "failed" })], [prompt("q1"), prompt("foreign-q", { siteId: "other" })]);
  assert.equal(value.length, 1);
  assert.equal(value[0].completedCount, 1);
  assert.equal(value[0].competitorOnlyCount, 1);
  assert.equal(value[0].failedCount, 1);
});

test("latest completed observation uses time, not input order or timezone text order", () => {
  const value = summary([answer("recent", { createdAt: "2026-11-03T00:00:00Z", completedAt: "2026-11-03T00:01:00Z" }), answer("older", { createdAt: "2026-11-03T08:00:00+09:00" }), answer("invalid", { createdAt: "invalid" }), answer("failed-newer", { status: "failed", createdAt: "2026-11-10T00:00:00Z" })])[0];
  assert.equal(value.latestAt, "2026-11-03T00:01:00Z");
});

test("triage preserves all summaries but prioritizes only active gaps with explicit evidence counts", () => {
  const prompts = [prompt("complete"), prompt("missing"), prompt("gap"), prompt("rival"), prompt("disabled", { active: false }), prompt("larger-rival")];
  const rows = [answer("a", { promptId: "complete", mentions: [mention("acme.com")] }), answer("b", { promptId: "gap" }), answer("c", { promptId: "rival", mentions: [mention("rival.com")] }), answer("d", { promptId: "disabled", mentions: [mention("rival.com")] }), answer("e", { promptId: "larger-rival", mentions: [mention("rival.com")] }), answer("f", { promptId: "larger-rival", mentions: [mention("rival.com")] })];
  const evidence = summary(rows, prompts);
  assert.equal(evidence.length, 6);
  assert.deepEqual(prioritizePromptOpportunities(evidence).map(row => row.prompt.id), ["larger-rival", "rival", "gap", "missing"]);
  assert.deepEqual(evidence.map(row => row.prompt.id), prompts.map(row => row.id));
});
