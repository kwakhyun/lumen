import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { readDashboardScope } from "@/lib/dashboard-scope";
import Dashboard from "@/components/dashboard/dashboard";
import "@/app/dashboard.css";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const path = `/dashboard${route.path?.length ? `/${route.path.map(encodeURIComponent).join("/")}` : ""}`;
  const safeQuery = new URLSearchParams();
  if (query.start === "1") safeQuery.set("start", "1");
  if (query.demo === "1") safeQuery.set("demo", "1");
  if (query.ga4 === "connected" || query.ga4 === "error") safeQuery.set("ga4", query.ga4);
  if (typeof query.site === "string" && /^[a-f0-9-]{36}$/i.test(query.site)) safeQuery.set("site", query.site);
  const scope = readDashboardScope(query);
  safeQuery.set("period", scope.period);
  if (scope.model !== "all") safeQuery.set("model", scope.model);
  if (typeof query.prompt === "string" && /^[a-f0-9-]{36}$/i.test(query.prompt)) safeQuery.set("prompt", query.prompt);
  const returnTo = `${path}${safeQuery.size ? `?${safeQuery}` : ""}`;
  const user = await requireChatGPTUser(returnTo);
  return <Dashboard user={{ name: user.displayName, email: user.email }} initialSection={route.path?.[0] || "overview"} initialScope={scope} />;
}
