import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { prepareSecurityRequest, applySecurityHeaders } from "../lib/http-security";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    // Vite HMR uses development-only scripts. Exercise the enforced policy with
    // the production build (`npm run build` then `npm start`), not the dev server.
    if (import.meta.env.DEV) return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    const secured = prepareSecurityRequest(request);
    return runWithConnectorBinding(binding, async () =>
      applySecurityHeaders(request, await handler.fetch(secured.request, env, ctx), secured.policy),
    );
  },
};
