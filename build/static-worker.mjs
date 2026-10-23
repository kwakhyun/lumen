// Source for the production entry wrapper, copied only after a complete build.
import app from './lumen-app.js';
import assets from './lumen-static-assets.js';
import { serveStaticAsset } from './lumen-static-response.js';

export * from './lumen-app.js';
export default {
  ...app,
  fetch(request, env, ctx) {
    return serveStaticAsset(request, assets) ?? app.fetch(request, env, ctx);
  },
};
