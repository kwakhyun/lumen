#!/usr/bin/env node
/** Submit Lumen's three public pages once. No automatic retries or index-status claims. */
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ORIGIN = 'https://lumen-ai-visibility.khyun97.chatgpt.site';
export const KEY_LOCATION = `${SITE_ORIGIN}/lumen-indexnow-key.txt`;
export const INDEXNOW_ENDPOINT = 'https://www.bing.com/indexnow';
export const SUBMISSION_URLS = Object.freeze([
  `${SITE_ORIGIN}/`,
  `${SITE_ORIGIN}/guides/free-ai-brand-tracking`,
  `${SITE_ORIGIN}/methodology`,
]);
const KEY_FILE = fileURLToPath(new URL('../public/lumen-indexnow-key.txt', import.meta.url));
const TIMEOUT_MS = 15_000;
const MAX_KEY_BYTES = 256;

export class SubmissionError extends Error {
  constructor(code, stage, httpStatus) {
    super(code);
    this.name = 'SubmissionError';
    this.code = code;
    this.stage = stage;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

export function parseArguments(args) {
  if (args.length === 0) return { submit: false, help: false };
  if (args.length === 1 && args[0] === '--submit') return { submit: true, help: false };
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { submit: false, help: true };
  throw new SubmissionError('invalid_arguments', 'configuration');
}

export function validateKey(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_KEY_BYTES) {
    throw new SubmissionError('invalid_local_key', 'configuration');
  }
  const key = text.trim();
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new SubmissionError('invalid_local_key', 'configuration');
  return key;
}

export function validateSubmissionUrls(urls) {
  if (!Array.isArray(urls) || urls.length !== SUBMISSION_URLS.length || new Set(urls).size !== urls.length) {
    throw new SubmissionError('invalid_url_list', 'configuration');
  }
  for (const value of urls) {
    let url;
    try { url = new URL(value); } catch { throw new SubmissionError('invalid_url_list', 'configuration'); }
    if (typeof value !== 'string' || url.protocol !== 'https:' || url.origin !== SITE_ORIGIN
      || url.username || url.password || url.search || url.hash || !SUBMISSION_URLS.includes(value)) {
      throw new SubmissionError('invalid_url_list', 'configuration');
    }
  }
  return [...urls];
}

export function classifySubmissionStatus(httpStatus) {
  if (httpStatus === 200) return 'received';
  if (httpStatus === 202) return 'key_validation_pending';
  return 'not_accepted';
}

async function readLocalKey() {
  let file;
  try {
    file = await open(KEY_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_KEY_BYTES) throw new SubmissionError('invalid_local_key', 'configuration');
    return validateKey(await file.readFile('utf8'));
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    throw new SubmissionError('local_key_unavailable', 'configuration');
  } finally { await file?.close(); }
}

async function readPublishedKey(response) {
  if (!response.body) throw new SubmissionError('published_key_missing', 'key_verification');
  const reader = response.body.getReader();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_KEY_BYTES) {
        await reader.cancel();
        throw new SubmissionError('published_key_too_large', 'key_verification');
      }
      parts.push(Buffer.from(part.value));
    }
    return Buffer.concat(parts).toString('utf8').trim();
  } finally { reader.releaseLock(); }
}

/** Dependency injection is used only by offline tests; CLI always uses built-in fetch. */
export async function submitOnce(key, { fetchImpl = globalThis.fetch } = {}) {
  const verifiedKey = validateKey(key);
  const urlList = validateSubmissionUrls(SUBMISSION_URLS);
  let published;
  try {
    published = await fetchImpl(KEY_LOCATION, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'text/plain', 'User-Agent': 'Lumen-IndexNow/1.0' },
    });
    if (published.status !== 200) {
      await published.body?.cancel();
      throw new SubmissionError('published_key_http_error', 'key_verification', published.status);
    }
    if (await readPublishedKey(published) !== verifiedKey) throw new SubmissionError('published_key_mismatch', 'key_verification');
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    throw new SubmissionError('published_key_request_failed', 'key_verification');
  }

  let response;
  try {
    response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'Lumen-IndexNow/1.0' },
      body: JSON.stringify({ host: new URL(SITE_ORIGIN).hostname, key: verifiedKey, keyLocation: KEY_LOCATION, urlList }),
    });
    // The response body is unnecessary and could echo submitted values.
    await response.body?.cancel();
  } catch {
    // Delivery may have occurred. Never retry automatically.
    throw new SubmissionError('submission_request_failed_delivery_unknown', 'submission');
  }
  const status = classifySubmissionStatus(response.status);
  return {
    mode: 'submit', endpoint: INDEXNOW_ENDPOINT, host: new URL(SITE_ORIGIN).hostname,
    keyLocation: KEY_LOCATION, publicKeyVerified: true, urlCount: urlList.length, urls: urlList,
    httpStatus: response.status, status, indexingConfirmed: false, retryAttempted: false,
  };
}

const HELP = `Usage: node scripts/submit-indexnow.mjs [--submit | --help]

Without arguments, print a dry-run summary without making network requests.
--submit verifies the published key, then sends exactly one POST to Bing IndexNow.
Only the home page, guide and methodology page are submitted. No retries are made.
HTTP 200 means received; HTTP 202 means key validation is pending. Neither proves indexing.

This script is scoped to Lumen's current host. For your own deployment, change
SITE_ORIGIN, the public page paths and the key file before submitting your own host.
The local public/lumen-indexnow-key.txt must already exist; this script never creates a key.
Key values, response bodies and credentials are never printed.
`;

export async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) { process.stdout.write(HELP); return; }
    const key = await readLocalKey();
    if (!options.submit) {
      process.stdout.write(`${JSON.stringify({
        mode: 'dry-run', endpoint: INDEXNOW_ENDPOINT, host: new URL(SITE_ORIGIN).hostname,
        keyLocation: KEY_LOCATION, localKeyValid: true, publicKeyVerified: false,
        urlCount: SUBMISSION_URLS.length, urls: validateSubmissionUrls(SUBMISSION_URLS),
        networkRequests: 0, indexingConfirmed: false,
      }, null, 2)}\n`);
      return;
    }
    const summary = await submitOnce(key);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.status === 'not_accepted') process.exitCode = 1;
  } catch (error) {
    const safe = error instanceof SubmissionError ? error : new SubmissionError('unexpected_failure', 'local');
    process.stderr.write(`${JSON.stringify({ status: 'failed', code: safe.code, stage: safe.stage,
      ...(safe.httpStatus === undefined ? {} : { httpStatus: safe.httpStatus }),
      indexingConfirmed: false, retryAttempted: false })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
