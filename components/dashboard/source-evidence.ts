import type { Answer, Citation, DataMode } from "@/lib/product-types";
import { measuredCitations } from "@/lib/metrics";

const sourceDomain = (domain: string) => domain.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
export type SourceEvidenceRow = { answer: Answer; citations: Citation[] };

/** Keep the same mode, completion and duplicate boundaries as the source metrics. */
export function sourceEvidence(answers: Answer[], domain: string, mode: DataMode): SourceEvidenceRow[] {
  const seen = new Set<string>();
  const rows: SourceEvidenceRow[] = [];
  for (const answer of answers) {
    if (answer.mode !== mode || (answer.id && seen.has(answer.id))) continue;
    if (answer.id) seen.add(answer.id);
    if (answer.status !== "completed") continue;
    const citations = [...new Map(measuredCitations(answer)
      .filter(citation => sourceDomain(citation.domain) === sourceDomain(domain))
      .map(citation => [citation.url, citation])).values()];
    if (citations.length) rows.push({ answer, citations });
  }
  return rows.sort((a, b) => (b.answer.completedAt || b.answer.createdAt).localeCompare(a.answer.completedAt || a.answer.createdAt));
}
