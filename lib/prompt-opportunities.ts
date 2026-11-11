import type { Answer, Competitor, Prompt, Site } from "./product-types";

export type PromptEvidence = {
  prompt: Prompt;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  mentionCount: number;
  mentionRate: number | null;
  unmentionedCount: number;
  competitorOnlyCount: number;
  competitorNames: string[];
  hasGap: boolean;
  latestAt: string | null;
  status: "uncollected" | "competitor_only" | "unmentioned" | "mentioned";
};

const canonicalDomain = (value: string) => value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

/** Summarize the supplied time/model window without inferring missing observations. */
export function summarizePromptEvidence(
  site: Pick<Site, "id" | "domain" | "mode">,
  prompts: Prompt[],
  competitors: Pick<Competitor, "name" | "domain">[],
  answers: Answer[],
): PromptEvidence[] {
  const ownDomain = canonicalDomain(site.domain);
  const registered = new Map<string, string>();
  for (const competitor of competitors) {
    const domain = canonicalDomain(competitor.domain);
    if (domain !== ownDomain && !registered.has(domain)) registered.set(domain, competitor.name);
  }
  const rows = new Map<string, Answer[]>();
  const seen = new Set<string>();
  for (const answer of answers) {
    if (answer.siteId !== site.id || answer.mode !== site.mode || seen.has(answer.id)) continue;
    if (answer.id) seen.add(answer.id);
    const group = rows.get(answer.promptId);
    if (group) group.push(answer);
    else rows.set(answer.promptId, [answer]);
  }

  return prompts.filter(prompt => prompt.siteId === site.id).map(prompt => {
    const all = rows.get(prompt.id) || [];
    const completed = all.filter(answer => answer.status === "completed");
    let mentionCount = 0;
    let competitorOnlyCount = 0;
    let latestAt: string | null = null;
    const competitorDomains = new Set<string>();
    for (const answer of completed) {
      const timestamp = answer.completedAt || answer.createdAt;
      if (Number.isFinite(Date.parse(timestamp)) && (latestAt === null || Date.parse(timestamp) > Date.parse(latestAt))) latestAt = timestamp;
      const mentioned = new Set(answer.mentions.filter(mention => mention.mentioned).map(mention => canonicalDomain(mention.domain)));
      if (mentioned.has(ownDomain)) {
        mentionCount += 1;
        continue;
      }
      const rivals = [...mentioned].filter(domain => registered.has(domain));
      if (rivals.length) {
        competitorOnlyCount += 1;
        rivals.forEach(domain => competitorDomains.add(domain));
      }
    }
    const unmentionedCount = completed.length - mentionCount;
    return {
      prompt,
      completedCount: completed.length,
      failedCount: all.filter(answer => answer.status === "failed").length,
      pendingCount: all.filter(answer => answer.status === "pending" || answer.status === "processing").length,
      mentionCount,
      mentionRate: completed.length ? Math.round(mentionCount / completed.length * 1000) / 10 : null,
      unmentionedCount,
      competitorOnlyCount,
      competitorNames: [...competitorDomains].map(domain => registered.get(domain)!),
      hasGap: unmentionedCount > 0,
      latestAt,
      status: !completed.length ? "uncollected" : competitorOnlyCount > 0 ? "competitor_only" : unmentionedCount > 0 ? "unmentioned" : "mentioned",
    };
  });
}

/** A transparent triage order, not an estimated impact score or a ranking forecast. */
export function prioritizePromptOpportunities(evidence: PromptEvidence[]): PromptEvidence[] {
  const category = (row: PromptEvidence) => row.competitorOnlyCount > 0 ? 0 : row.hasGap ? 1 : 2;
  return evidence.filter(row => row.prompt.active && (row.hasGap || row.completedCount === 0))
    .sort((a, b) => category(a) - category(b)
      || b.competitorOnlyCount - a.competitorOnlyCount
      || b.unmentionedCount - a.unmentionedCount
      || Number(b.prompt.pinned) - Number(a.prompt.pinned)
      || a.prompt.text.localeCompare(b.prompt.text, "ko")
      || a.prompt.id.localeCompare(b.prompt.id));
}
