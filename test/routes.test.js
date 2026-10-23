/**
 * Route-level tests with mocked upstream fetch.
 * Deterministic — no live network calls.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Minimal Request/Response polyfill for Node if needed
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Dynamic import after polyfills
const { default: worker } = await import('../src/index.js');

const ORIGINAL_FETCH = global.fetch;

function mockUpstream(status = 200, body = { ok: true }, headers = {}) {
  global.fetch = jest.fn(async (url, init) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  });
}

function makeRequest(pathAndQuery, method = 'GET') {
  return new Request(`https://example.workers.dev${pathAndQuery}`, { method });
}

describe('routes', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test('GET /health returns ok', async () => {
    const res = await worker.fetch(makeRequest('/health'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.status).toBe('ok');
  });

  test('GET /providers lists both registries independently', async () => {
    const res = await worker.fetch(makeRequest('/providers'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bypass.length).toBe(22);
    expect(json.generators.length).toBe(3);
    const bypassIds = json.bypass.map((p) => p.id);
    const genIds = json.generators.map((p) => p.id);
    for (const g of genIds) {
      expect(bypassIds).not.toContain(g);
    }
  });

  test('OPTIONS returns CORS preflight', async () => {
    const res = await worker.fetch(makeRequest('/bypass', 'OPTIONS'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  test('POST is rejected', async () => {
    const res = await worker.fetch(makeRequest('/health', 'POST'));
    expect(res.status).toBe(405);
  });

  test('/bypass with valid linkvertise url forwards and sets provider header', async () => {
    mockUpstream(200, { unlocked: true });
    const target = encodeURIComponent('https://linkvertise.com/12345/test');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bypass-Provider')).toBe('linkvertise');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('api.bypass.lat/bypass/free/linkvertise');
    expect(calledUrl).toContain('url=');
  });

  test('/bypass rejects private IP', async () => {
    const target = encodeURIComponent('http://127.0.0.1/secret');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('PRIVATE_IP');
  });

  test('/bypass rejects unknown provider hostname', async () => {
    const target = encodeURIComponent('https://totally-unknown.example/path');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('UNSUPPORTED_PROVIDER');
  });

  test('/bypass with luarmor (no url param required upstream)', async () => {
    mockUpstream(200, { key: 'abc' });
    const target = encodeURIComponent('https://luarmor.org/something');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bypass-Provider')).toBe('luarmor-org');
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('/luarmor-org');
    // should not append a url query when param is null
    expect(calledUrl.endsWith('luarmor-org') || calledUrl.endsWith('luarmor-org/')).toBe(true);
  });

  test('/gen requires provider', async () => {
    const res = await worker.fetch(makeRequest('/gen'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('GENERATOR_UNSPECIFIED');
  });

  test('/gen?provider=delta-gen-android forwards correctly', async () => {
    mockUpstream(200, { key: 'android-key' });
    const res = await worker.fetch(makeRequest('/gen?provider=delta-gen-android'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Generator-Provider')).toBe('delta-gen-android');
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toBe('https://api.bypass.lat/bypass/free/delta-gen-android');
  });

  test('/gen?provider=delta-gen-ios', async () => {
    mockUpstream(200, {});
    const res = await worker.fetch(makeRequest('/gen?provider=delta-gen-ios'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Generator-Provider')).toBe('delta-gen-ios');
  });

  test('/gen?provider=yui-asset-shop', async () => {
    mockUpstream(200, {});
    const res = await worker.fetch(makeRequest('/gen?provider=yui-asset-shop'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Generator-Provider')).toBe('yui-asset-shop');
  });

  test('/gen never routes a bypass provider', async () => {
    const res = await worker.fetch(makeRequest('/gen?provider=linkvertise'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('UNKNOWN_GENERATOR');
  });

  test('/bypass never routes a generator provider via hostname alone if not in bypass map', async () => {
    // Generators are not in BYPASS_HOSTNAME_MAP, so unknown
    const target = encodeURIComponent('https://delta-android.com/gen');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('UNSUPPORTED_PROVIDER');
  });

  test('unknown route 404', async () => {
    const res = await worker.fetch(makeRequest('/nope'));
    expect(res.status).toBe(404);
  });

  test('upstream timeout surfaces 504', async () => {
    global.fetch = jest.fn(() => new Promise((resolve) => {
      // never resolve — will be aborted by the 25s timeout in real code,
      // but for unit speed we simulate AbortError
    }));
    // Force abort path by mocking AbortController behavior is heavy;
    // instead verify the error path exists via a rejected fetch
    global.fetch = jest.fn(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const target = encodeURIComponent('https://linkvertise.com/1');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(504);
    const json = await res.json();
    expect(json.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  test('upstream error surfaces 502', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    const target = encodeURIComponent('https://rekonise.com/x');
    const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('all 22 bypass provider mappings', () => {
  const cases = [
    ['link-unlock', 'link-unlock.com', 'link-unlock'],
    ['voidpath', 'voidpath.com', 'voidpath'],
    ['trigon', 'trigon.gg', 'trigon'],
    ['violated', 'violated.gg', 'violated'],
    ['xeno', 'xeno.download', 'xeno'],
    ['lds-hub', 'ldshub.com', 'LDS-HUB'],
    ['delta', 'delta-executor.com', 'delta'],
    ['rekonise', 'rekonise.com', 'rekonise'],
    ['delta-5s', 'delta-5s.com', 'delta-5s'],
    ['luarmor-org', 'luarmor.org', 'luarmor-org'],
    ['linkvertise', 'linkvertise.com', 'linkvertise'],
    ['neox-hub', 'neoxhub.com', 'neox-hub'],
    ['pandadev', 'pandadev.net', 'pandadev'],
    ['ntt-hub', 'ntthub.com', 'ntt-hub'],
    ['link4sub', 'link4sub.com', 'link4sub'],
    ['subnise', 'subnise.com', 'subnise'],
    ['boostylink', 'boostylink.com', 'boostylink'],
    ['bstshrt', 'bstshrt.com', 'bstshrt'],
    ['sub2s', 'sub2s.com', 'sub2s'],
    ['linkunlocker', 'linkunlocker.com', 'linkunlocker'],
    ['mboost', 'mboost.me', 'mboost'],
    ['sub4unlock', 'sub4unlock.com', 'sub4unlock'],
  ];

  test.each(cases)(
    'provider %s maps hostname %s → upstream path %s',
    async (providerKey, hostname, expectedPath) => {
      mockUpstream(200, { ok: true });
      const target = encodeURIComponent(`https://${hostname}/test-path`);
      const res = await worker.fetch(makeRequest(`/bypass?url=${target}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Bypass-Provider')).toBe(providerKey);
      expect(res.headers.get('X-Upstream-Path')).toBe(expectedPath);
      const called = global.fetch.mock.calls[0][0];
      expect(called).toContain(`/bypass/free/${expectedPath}`);
    }
  );
});
