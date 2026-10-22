import type { Answer, Site } from "@/lib/product-types";

export const intentNames = { informational: "정보 탐색", comparison: "비교 검토", transactional: "구매 고려" };

export function ownMention(answer: Answer, site: Site) { const domain = (value: string) => value.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); return answer.mentions.find(m => domain(m.domain) === domain(site.domain)); }

/** Index completed evidence once, preserving provider order and excluding failed answers. */
export function completedAnswersByPrompt(answers: Answer[]): Map<string, Answer[]> {
  const byPrompt = new Map<string, Answer[]>();
  for (const answer of answers) {
    if (answer.status !== "completed") continue;
    const group = byPrompt.get(answer.promptId);
    if (group) group.push(answer);
    else byPrompt.set(answer.promptId, [answer]);
  }
  return byPrompt;
}
