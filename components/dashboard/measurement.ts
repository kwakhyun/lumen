import type { Answer, ProviderStatus } from "@/lib/product-types";
import { citationMeasurementAvailable } from "../../lib/metrics";

export function hasOnlyUngroundedAnswers(answers: Answer[]): boolean {
  const completed = answers.filter(answer => answer.status === "completed");
  return completed.length > 0 && completed.every(answer => !citationMeasurementAvailable(answer));
}

export function providerLabel(provider: ProviderStatus): string {
  if (provider.available && provider.configured) return "사용 가능";
  return provider.configured ? "현재 제공하지 않음" : "미연결";
}
