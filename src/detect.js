/**
 * Provider detection.
 * Bypass: exact hostname map only (no substring matching).
 * Generator: explicit provider= primary; hostname map secondary.
 */

import {
  BYPASS_PROVIDERS,
  BYPASS_HOSTNAME_MAP,
  GENERATOR_PROVIDERS,
  GENERATOR_HOSTNAME_MAP,
} from './providers.js';
import { normalizeHostname, sanitizeProviderId } from './validation.js';

/**
 * Resolve a hostname against a map using raw, normalized, and www-prefixed forms.
 * @param {string} hostname
 * @param {ReadonlyMap<string, string>} map
 * @returns {string | undefined}
 */
function lookupHostname(hostname, map) {
  const raw = hostname.toLowerCase();
  const normalized = normalizeHostname(raw);
  return map.get(raw) || map.get(normalized) || map.get(`www.${normalized}`);
}

/**
 * @param {URL} targetUrl
 * @returns {{ ok: true, providerKey: string, config: object } | { ok: false, error: string, code: string }}
 */
export function detectBypassProvider(targetUrl) {
  const key = lookupHostname(targetUrl.hostname, BYPASS_HOSTNAME_MAP);

  if (!key || !BYPASS_PROVIDERS[key]) {
    return {
      ok: false,
      error: `Unsupported bypass provider for hostname: ${targetUrl.hostname}. See /providers for supported hosts.`,
      code: 'UNSUPPORTED_PROVIDER',
    };
  }

  return {
    ok: true,
    providerKey: key,
    config: BYPASS_PROVIDERS[key],
  };
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{ ok: true, providerKey: string, config: object } | { ok: false, error: string, code: string }}
 */
export function selectGeneratorProvider(searchParams) {
  const explicitRaw = searchParams.get('provider');
  if (explicitRaw !== null && explicitRaw !== '') {
    const key = sanitizeProviderId(explicitRaw);
    if (key && GENERATOR_PROVIDERS[key]) {
      return { ok: true, providerKey: key, config: GENERATOR_PROVIDERS[key] };
    }
    return {
      ok: false,
      error: `Unknown generator provider "${explicitRaw}". Supported: ${Object.keys(GENERATOR_PROVIDERS).join(', ')}`,
      code: 'UNKNOWN_GENERATOR',
    };
  }

  const urlParam = searchParams.get('url');
  if (urlParam) {
    try {
      const decoded = /%[0-9A-Fa-f]{2}/.test(urlParam) ? decodeURIComponent(urlParam) : urlParam;
      const u = new URL(decoded);
      const key = lookupHostname(u.hostname, GENERATOR_HOSTNAME_MAP);
      if (key && GENERATOR_PROVIDERS[key]) {
        return { ok: true, providerKey: key, config: GENERATOR_PROVIDERS[key] };
      }
    } catch {
      // leave to validation when url is required; here it is optional
    }
  }

  return {
    ok: false,
    error:
      'Generator provider could not be identified. Supply ?provider=<id> where id is one of: ' +
      Object.keys(GENERATOR_PROVIDERS).join(', '),
    code: 'GENERATOR_UNSPECIFIED',
  };
}
