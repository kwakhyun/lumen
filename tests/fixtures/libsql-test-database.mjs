import { createClient } from '@libsql/client/http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createSqliteBinding } from '../../lib/runtime/sqlite-binding.ts';
// Keep database transport separate from the provider fetch mocks in each test.
const transportFetch = globalThis.fetch.bind(globalThis);
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export class Miniflare {
  #databases = new Map();
  async getD1Database(name) {
    if (!this.#databases.has(name)) {
      const port = await freePort();
      const server = spawn('turso', ['dev', '--port', String(port)], { stdio: 'ignore' });
      let failed;
      server.on('error', error => { failed = error; });
      const url = `http://127.0.0.1:${port}`;
      const client = createClient({ url, fetch: transportFetch });
      const resource = { server, client, binding: createSqliteBinding(client) };
      this.#databases.set(name, resource);
      let ready = false;
      for (let i = 0; i < 150; i++) {
        if (failed || server.exitCode !== null) throw failed || new Error('Turso test server exited.');
        try { await client.execute('SELECT 1'); ready = true; break; } catch { await delay(100); }
      }
      if (!ready) { await this.dispose(); throw new Error('Turso test server did not start. Install the official Turso CLI.'); }
    }
    return this.#databases.get(name).binding;
  }
  async dispose() {
    for (const { client, server } of this.#databases.values()) {
      client.close();
      if (server.exitCode === null) {
        const closed = once(server, 'exit');
        server.kill('SIGTERM');
        await closed;
      }
    }
    this.#databases.clear();
  }
}
