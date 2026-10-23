/**
 * Input validation + SSRF / open-proxy protections.
 * language: JavaScript (ES modules), runtime: Cloudflare Workers
 */

const MAX_URL_LENGTH = 2048;
const MAX_QUERY_LENGTH = 4096;

/** Private / reserved / special-use IPv4 prefixes (dotted-decimal form). */
const PRIVATE_IPV4_RE = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT RFC 6598
  /^198\.1[89]\./,                             // benchmarking
  /^192\.0\.0\./,
  /^192\.0\.2\./,                              // TEST-NET-1
  /^198\.51\.100\./,                           // TEST-NET-2
  /^203\.0\.113\./,                            // TEST-NET-3
  /^224\./,                                    // multicast
  /^2(4[0-9]|5[0-5])\./,                      // 240–255 reserved
];

const RESERVED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  '0.0.0.0',
  '255.255.255.255',
]);

/**
 * Lower-case, strip trailing dot, strip one leading "www.".
 * @param {string} h
 * @returns {string}
 */
export function normalizeHostname(h) {
  if (!h) return '';
  let s = String(h).toLowerCase();
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

/**
 * @param {string} host
 */
function isIPv4Literal(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Alternate encodings that resolve to the same IP as a dotted form
 * and commonly slip past naive private-IP checks.
 * @param {string} host
 */
function isSuspiciousIpEncoding(host) {
  if (/^\d{8,10}$/.test(host)) return true;           // decimal integer
  if (/^0x[0-9a-f]+$/i.test(host)) return true;       // hex
  if (/^0[0-7]+(\.0[0-7]+)*$/.test(host)) return true; // octal segments
  // mixed: 0x7f.0.0.1 style
  if (/0x[0-9a-f]+/i.test(host) && host.includes('.')) return true;
  return false;
}

/**
 * @param {string} bare  IPv6 without brackets
 */
function isPrivateOrReservedIPv6(bare) {
  const h = bare.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;   // ULA
  if (h.startsWith('fe80')) return true;                       // link-local
  if (h.startsWith('ff')) return true;                         // multicast
  // IPv4-mapped IPv6 private ranges
  if (
    h.startsWith('::ffff:127.') ||
    h.startsWith('::ffff:10.') ||
    h.startsWith('::ffff:192.168.') ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.startsWith('::ffff:0.') ||
    h.startsWith('::ffff:169.254.')
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} raw
 * @returns {{ ok: true, url: URL } | { ok: false, error: string, code: string }}
 */
export function validateTargetUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'Missing or empty url parameter', code: 'MISSING_URL' };
  }
  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, error: `URL exceeds maximum length of ${MAX_URL_LENGTH}`, code: 'URL_TOO_LONG' };
  }

  let parsed;
  try {
    const decoded = /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
    parsed = new URL(decoded);
  } catch {
    return { ok: false, error: 'Invalid URL format', code: 'INVALID_URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https schemes are allowed', code: 'INVALID_SCHEME' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs with embedded credentials are rejected', code: 'CREDENTIALS_REJECTED' };
  }

  // Reject empty host or userinfo-style oddities that some parsers accept
  if (!parsed.hostname || parsed.host.startsWith('@')) {
    return { ok: false, error: 'Invalid or empty hostname', code: 'INVALID_URL' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalized = normalizeHostname(hostname);

  if (RESERVED_HOSTS.has(hostname) || RESERVED_HOSTS.has(normalized)) {
    return { ok: false, error: 'Reserved or empty hostname', code: 'RESERVED_HOST' };
  }

  if (isSuspiciousIpEncoding(hostname)) {
    return { ok: false, error: 'Non-standard IP encoding is not allowed', code: 'PRIVATE_IP' };
  }

  if (isIPv4Literal(hostname)) {
    const parts = hostname.split('.').map(Number);
    if (parts.some((n) => !Number.isFinite(n) || n > 255)) {
      return { ok: false, error: 'Invalid IPv4 address', code: 'INVALID_URL' };
    }
    for (const re of PRIVATE_IPV4_RE) {
      if (re.test(hostname)) {
        return { ok: false, error: 'Private or reserved IP addresses are not allowed', code: 'PRIVATE_IP' };
      }
    }
  }

  if (hostname.includes(':')) {
    const bare = hostname.replace(/^\[|\]$/g, '');
    if (isPrivateOrReservedIPv6(bare)) {
      return { ok: false, error: 'Private or reserved IPv6 addresses are not allowed', code: 'PRIVATE_IP' };
    }
  }

  if (
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.localhost')
  ) {
    return { ok: false, error: 'Internal hostnames are not allowed', code: 'INTERNAL_HOST' };
  }

  return { ok: true, url: parsed };
}

/**
 * @param {URL} requestUrl
 */
export function validateRequestSize(requestUrl) {
  const qs = requestUrl.search || '';
  if (qs.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: 'Query string too large', code: 'QUERY_TOO_LARGE' };
  }
  return { ok: true };
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function sanitizeProviderId(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return cleaned.length > 0 && cleaned.length <= 64 ? cleaned : null;
}
