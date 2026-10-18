import { requireChatGPTUser } from "@/app/chatgpt-auth";
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
  const returnTo = `${path}${query.demo === "1" ? "?demo=1" : ""}`;
  const user = await requireChatGPTUser(returnTo);
  return <Dashboard user={{ name: user.displayName, email: user.email }} />;
}
