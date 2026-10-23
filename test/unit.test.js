/**
 * Unit tests — validation, detection, routing helpers.
 * No live network; pure logic.
 */

import { describe, test, expect } from '@jest/globals';
import { validateTargetUrl, sanitizeProviderId, validateRequestSize } from '../src/validation.js';
import { detectBypassProvider, selectGeneratorProvider } from '../src/detect.js';
import { buildUpstreamUrl } from '../src/router.js';
import {
  BYPASS_PROVIDERS,
  GENERATOR_PROVIDERS,
  listBypassProviders,
  listGeneratorProviders,
  UPSTREAM_BASE,
} from '../src/providers.js';

describe('validation', () => {
  test('accepts valid https URL', () => {
    const r = validateTargetUrl('https://linkvertise.com/12345/foo');
    expect(r.ok).toBe(true);
    expect(r.url.hostname).toBe('linkvertise.com');
  });

  test('rejects missing url', () => {
    const r = validateTargetUrl('');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_URL');
  });

  test('rejects non-http scheme', () => {
    const r = validateTargetUrl('ftp://example.com/file');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_SCHEME');
  });

  test('rejects embedded credentials', () => {
    const r = validateTargetUrl('https://user:pass@example.com/path');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CREDENTIALS_REJECTED');
  });

  test('rejects private IPv4', () => {
    expect(validateTargetUrl('http://127.0.0.1/').code).toBe('PRIVATE_IP');
    expect(validateTargetUrl('http://10.0.0.5/').code).toBe('PRIVATE_IP');
    expect(validateTargetUrl('http://192.168.1.1/').code).toBe('PRIVATE_IP');
    expect(validateTargetUrl('http://172.16.0.1/').code).toBe('PRIVATE_IP');
  });

  test('rejects localhost', () => {
    expect(validateTargetUrl('http://localhost/').code).toBe('RESERVED_HOST');
  });

  test('rejects oversized URL', () => {
    const long = 'https://example.com/' + 'a'.repeat(3000);
    expect(validateTargetUrl(long).code).toBe('URL_TOO_LONG');
  });

  test('sanitizeProviderId cleans input', () => {
    expect(sanitizeProviderId('  Delta-Gen-Android  ')).toBe('delta-gen-android');
    expect(sanitizeProviderId('bad!chars')).toBe('badchars');
    expect(sanitizeProviderId(null)).toBeNull();
  });
});

describe('bypass detection', () => {
  test('detects linkvertise by hostname', () => {
    const u = new URL('https://linkvertise.com/123/abc');
    const r = detectBypassProvider(u);
    expect(r.ok).toBe(true);
    expect(r.providerKey).toBe('linkvertise');
    expect(r.config.path).toBe('linkvertise');
    expect(r.config.param).toBe('url');
  });

  test('detects rekonise', () => {
    const u = new URL('https://rekonise.com/foo');
    const r = detectBypassProvider(u);
    expect(r.ok).toBe(true);
    expect(r.providerKey).toBe('rekonise');
  });

  test('detects luarmor-org (no param)', () => {
    const u = new URL('https://luarmor.org/key');
    const r = detectBypassProvider(u);
    expect(r.ok).toBe(true);
    expect(r.providerKey).toBe('luarmor-org');
    expect(r.config.param).toBeNull();
  });

  test('rejects unknown hostname', () => {
    const u = new URL('https://unknown-provider.example/path');
    const r = detectBypassProvider(u);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNSUPPORTED_PROVIDER');
  });

  test('all 22 bypass providers are registered', () => {
    const list = listBypassProviders();
    expect(list.length).toBe(22);
    const ids = list.map((p) => p.id).sort();
    expect(ids).toContain('linkvertise');
    expect(ids).toContain('delta');
    expect(ids).toContain('sub4unlock');
  });
});

describe('generator selection', () => {
  test('selects by explicit provider=', () => {
    const params = new URLSearchParams('provider=delta-gen-android');
    const r = selectGeneratorProvider(params);
    expect(r.ok).toBe(true);
    expect(r.providerKey).toBe('delta-gen-android');
    expect(r.config.path).toBe('delta-gen-android');
    expect(r.config.param).toBeNull();
  });

  test('selects yui-asset-shop', () => {
    const params = new URLSearchParams('provider=yui-asset-shop');
    const r = selectGeneratorProvider(params);
    expect(r.ok).toBe(true);
    expect(r.providerKey).toBe('yui-asset-shop');
  });

  test('rejects unknown generator', () => {
    const params = new URLSearchParams('provider=not-a-real-gen');
    const r = selectGeneratorProvider(params);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_GENERATOR');
  });

  test('requires provider when no hostname match', () => {
    const params = new URLSearchParams('');
    const r = selectGeneratorProvider(params);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('GENERATOR_UNSPECIFIED');
  });

  test('generator registry has exactly 3 entries and does not overlap bypass', () => {
    const gens = listGeneratorProviders();
    expect(gens.length).toBe(3);
    const bypassIds = new Set(listBypassProviders().map((p) => p.id));
    for (const g of gens) {
      expect(bypassIds.has(g.id)).toBe(false);
    }
  });
});

describe('upstream URL construction', () => {
  test('builds path with url param', () => {
    const cfg = BYPASS_PROVIDERS['linkvertise'];
    const target = 'https://linkvertise.com/1/2';
    const upstream = buildUpstreamUrl(cfg, target);
    expect(upstream.startsWith(UPSTREAM_BASE)).toBe(true);
    expect(upstream).toContain('/linkvertise');
    expect(upstream).toContain('url=' + encodeURIComponent(target));
  });

  test('builds path without param when null', () => {
    const cfg = GENERATOR_PROVIDERS['delta-gen-android'];
    const upstream = buildUpstreamUrl(cfg, null);
    expect(upstream).toBe(UPSTREAM_BASE + 'delta-gen-android');
    expect(upstream).not.toContain('?');
  });

  test('preserves exact LDS-HUB casing', () => {
    const cfg = BYPASS_PROVIDERS['lds-hub'];
    const upstream = buildUpstreamUrl(cfg, null);
    expect(upstream).toContain('LDS-HUB');
  });
});
