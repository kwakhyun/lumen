// Exercise the existing database integration suite against a real local Turso HTTP server.
// This hook substitutes only the test database process, never app authentication.
import { registerHooks } from 'node:module';
const fixture = new URL('./fixtures/libsql-test-database.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
  if(specifier==='miniflare' && context.parentURL?.endsWith('.test.mjs') && !context.parentURL.includes('workerd-providers')) return {url:fixture,shortCircuit:true};
  return next(specifier,context);
}});
