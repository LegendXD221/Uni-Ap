/**
 * Upstream routing and request forwarding.
 * Fixed origin, exact path preservation, timeout, no silent fallback.
 */

import { UPSTREAM_BASE } from './providers.js';

const UPSTREAM_TIMEOUT_MS = 25_000;
const UPSTREAM_ORIGIN = new URL(UPSTREAM_BASE).origin;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const ALLOWED_UPSTREAM_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'last-modified',
  'date',
  'vary',
  'content-encoding',
]);

/**
 * @param {{ path: string, param: string | null }} config
 * @param {string | null} [targetUrlString]
 * @returns {string}
 */
export function buildUpstreamUrl(config, targetUrlString = null) {
  const base = UPSTREAM_BASE.endsWith('/') ? UPSTREAM_BASE : `${UPSTREAM_BASE}/`;
  const path = config.path.replace(/^\//, '');
  const url = new URL(path, base);

  if (config.param && targetUrlString) {
    url.searchParams.set(config.param, targetUrlString);
  }

  return url.toString();
}

/**
 * @param {string} upstreamUrl
 * @param {Request} originalRequest
 * @returns {Promise<Response>}
 */
export async function forwardToUpstream(upstreamUrl, originalRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const headers = new Headers();
    const accept = originalRequest.headers.get('Accept');
    if (accept) headers.set('Accept', accept);
    headers.set('User-Agent', 'Universal-Bypass-API/1.2 (Cloudflare Workers)');
    headers.set('Accept-Encoding', 'identity');

    /** @type {RequestInit} */
    const init = {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
    };

    const response = await fetch(upstreamUrl, init);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        try {
          const locUrl = new URL(location, upstreamUrl);
          if (locUrl.origin !== UPSTREAM_ORIGIN) {
            return jsonError(
              502,
              'UPSTREAM_REDIRECT_BLOCKED',
              'Upstream attempted redirect outside fixed origin',
            );
          }
        } catch {
          return jsonError(502, 'UPSTREAM_REDIRECT_INVALID', 'Upstream returned invalid redirect');
        }
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: filterUpstreamHeaders(response.headers),
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: filterUpstreamHeaders(response.headers),
    });
  } catch (err) {
    const name = err && err.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return jsonError(
        504,
        'UPSTREAM_TIMEOUT',
        `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms`,
      );
    }
    const msg = err && err.message ? String(err.message) : 'unknown';
    return jsonError(502, 'UPSTREAM_ERROR', `Upstream request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Headers} headers
 * @returns {Headers}
 */
function filterUpstreamHeaders(headers) {
  const out = new Headers();
  for (const [name, value] of headers.entries()) {
    if (ALLOWED_UPSTREAM_HEADERS.has(name.toLowerCase())) {
      out.set(name, value);
    }
  }
  for (const [k, v] of Object.entries(CORS)) {
    out.set(k, v);
  }
  return out;
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {string} [requestId]
 * @returns {Response}
 */
export function jsonError(status, code, message, requestId) {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS,
  };
  if (requestId) headers['X-Request-Id'] = requestId;

  const body = JSON.stringify({
    success: false,
    error: { code, message },
    ...(requestId ? { requestId } : {}),
  });

  return new Response(body, { status, headers });
}

/**
 * @param {object} data
 * @param {number} [status]
 * @param {string} [requestId]
 * @returns {Response}
 */
export function jsonOk(data, status = 200, requestId) {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    ...CORS,
  };
  if (requestId) headers['X-Request-Id'] = requestId;

  return new Response(JSON.stringify({ success: true, ...data }), { status, headers });
}

/**
 * Annotate upstream response with provider metadata; body is streamed, never buffered.
 * @param {Response} upstreamResponse
 * @param {Record<string, string>} extraHeaders
 * @param {string} [requestId]
 * @returns {Response}
 */
export function annotateResponse(upstreamResponse, extraHeaders, requestId) {
  const headers = new Headers(upstreamResponse.headers);
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, v);
  }
  if (requestId) headers.set('X-Request-Id', requestId);
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}
