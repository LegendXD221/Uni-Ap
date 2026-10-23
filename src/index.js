/**
 * Universal Bypass API — Cloudflare Worker entrypoint
 * language: JavaScript (ES modules), runtime: Cloudflare Workers free plan
 * Routes: /bypass, /gen, /health, /providers, OPTIONS
 */

import { validateTargetUrl, validateRequestSize } from './validation.js';
import { detectBypassProvider, selectGeneratorProvider } from './detect.js';
import {
  buildUpstreamUrl,
  forwardToUpstream,
  jsonError,
  jsonOk,
  annotateResponse,
} from './router.js';
import {
  listBypassProviders,
  listGeneratorProviders,
  SERVICE_VERSION,
} from './providers.js';

const CORS_PREFLIGHT = {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  },
};

export default {
  /**
   * @param {Request} request
   * @param {unknown} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    try {
      return await handleRequest(request, requestId);
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String(/** @type {{ message: unknown }} */ (err).message)
        : 'Unexpected error';
      return jsonError(500, 'INTERNAL_ERROR', message, requestId);
    }
  },
};

/**
 * @param {Request} request
 * @param {string} requestId
 */
async function handleRequest(request, requestId) {
  if (request.method === 'OPTIONS') {
    return new Response(null, CORS_PREFLIGHT);
  }

  if (request.method !== 'GET') {
    return jsonError(405, 'METHOD_NOT_ALLOWED', 'Only GET and OPTIONS are supported', requestId);
  }

  const url = new URL(request.url);

  const sizeCheck = validateRequestSize(url);
  if (!sizeCheck.ok) {
    return jsonError(413, sizeCheck.code, sizeCheck.error, requestId);
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  switch (path) {
    case '/health':
      return jsonOk(
        { status: 'ok', service: 'universal-bypass-api', version: SERVICE_VERSION },
        200,
        requestId,
      );

    case '/providers':
      return jsonOk(
        {
          bypass: listBypassProviders(),
          generators: listGeneratorProviders(),
          notes: [
            'Bypass providers are selected automatically from the hostname of the supplied url parameter.',
            'Generator providers require an explicit provider= query parameter (recommended) or a matching hostname in url=.',
            'Bypass and generator registries are independent; no cross-routing occurs.',
          ],
        },
        200,
        requestId,
      );

    case '/bypass':
      return handleBypass(request, url, requestId);

    case '/gen':
      return handleGen(request, url, requestId);

    default:
      return jsonError(
        404,
        'NOT_FOUND',
        `Unknown route: ${path}. Available: /bypass, /gen, /health, /providers`,
        requestId,
      );
  }
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {string} requestId
 */
async function handleBypass(request, url, requestId) {
  const rawUrl = url.searchParams.get('url');
  const validation = validateTargetUrl(rawUrl || '');
  if (!validation.ok) {
    return jsonError(400, validation.code, validation.error, requestId);
  }

  const detection = detectBypassProvider(validation.url);
  if (!detection.ok) {
    return jsonError(400, detection.code, detection.error, requestId);
  }

  const { config, providerKey } = detection;
  const targetString = validation.url.toString();
  const upstream = buildUpstreamUrl(config, config.param ? targetString : null);
  const upstreamResponse = await forwardToUpstream(upstream, request);

  return annotateResponse(
    upstreamResponse,
    {
      'X-Bypass-Provider': providerKey,
      'X-Upstream-Path': config.path,
    },
    requestId,
  );
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {string} requestId
 */
async function handleGen(request, url, requestId) {
  const selection = selectGeneratorProvider(url.searchParams);
  if (!selection.ok) {
    return jsonError(400, selection.code, selection.error, requestId);
  }

  const { config, providerKey } = selection;
  // Generators do not take a url parameter unless config.param is set (none currently are).
  const upstream = buildUpstreamUrl(config, config.param ? url.searchParams.get('url') : null);
  const upstreamResponse = await forwardToUpstream(upstream, request);

  return annotateResponse(
    upstreamResponse,
    {
      'X-Generator-Provider': providerKey,
      'X-Upstream-Path': config.path,
    },
    requestId,
  );
}
