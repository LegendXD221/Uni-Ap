/**
 * Independent registries for bypass and generator providers.
 * Upstream base is fixed. Paths and parameter requirements are exact.
 * Registries are frozen; key collision aborts module load.
 */

export const UPSTREAM_BASE = 'https://api.bypass.lat/bypass/free/';
export const SERVICE_VERSION = '1.2.0';

/** @typedef {{ readonly path: string, readonly param: string | null, readonly hostnames: readonly string[] }} ProviderConfig */

/** @type {Readonly<Record<string, ProviderConfig>>} */
export const BYPASS_PROVIDERS = Object.freeze({
  'link-unlock': Object.freeze({
    path: 'link-unlock',
    param: 'url',
    hostnames: Object.freeze(['link-unlock.com', 'www.link-unlock.com', 'linkunlock.com', 'www.linkunlock.com']),
  }),
  voidpath: Object.freeze({
    path: 'voidpath',
    param: null,
    hostnames: Object.freeze(['voidpath.com', 'www.voidpath.com', 'void-path.com']),
  }),
  trigon: Object.freeze({
    path: 'trigon',
    param: null,
    hostnames: Object.freeze(['trigon.gg', 'www.trigon.gg', 'trigon.com']),
  }),
  violated: Object.freeze({
    path: 'violated',
    param: null,
    hostnames: Object.freeze(['violated.gg', 'www.violated.gg', 'violated.com']),
  }),
  xeno: Object.freeze({
    path: 'xeno',
    param: null,
    hostnames: Object.freeze(['xeno.download', 'www.xeno.download', 'xenodownload.com']),
  }),
  'lds-hub': Object.freeze({
    path: 'LDS-HUB',
    param: null,
    hostnames: Object.freeze(['ldshub.com', 'www.ldshub.com', 'lds-hub.com', 'www.lds-hub.com']),
  }),
  delta: Object.freeze({
    path: 'delta',
    param: 'url',
    hostnames: Object.freeze(['delta-executor.com', 'www.delta-executor.com', 'deltaexecutor.com']),
  }),
  rekonise: Object.freeze({
    path: 'rekonise',
    param: 'url',
    hostnames: Object.freeze(['rekonise.com', 'www.rekonise.com']),
  }),
  'delta-5s': Object.freeze({
    path: 'delta-5s',
    param: 'url',
    hostnames: Object.freeze(['delta-5s.com', 'www.delta-5s.com']),
  }),
  'luarmor-org': Object.freeze({
    path: 'luarmor-org',
    param: null,
    hostnames: Object.freeze(['luarmor.org', 'www.luarmor.org']),
  }),
  linkvertise: Object.freeze({
    path: 'linkvertise',
    param: 'url',
    hostnames: Object.freeze(['linkvertise.com', 'www.linkvertise.com', 'linkvertise.net']),
  }),
  'neox-hub': Object.freeze({
    path: 'neox-hub',
    param: null,
    hostnames: Object.freeze(['neoxhub.com', 'www.neoxhub.com', 'neox-hub.com']),
  }),
  pandadev: Object.freeze({
    path: 'pandadev',
    param: 'url',
    hostnames: Object.freeze(['pandadev.net', 'www.pandadev.net', 'panda-dev.com']),
  }),
  'ntt-hub': Object.freeze({
    path: 'ntt-hub',
    param: 'url',
    hostnames: Object.freeze(['ntthub.com', 'www.ntthub.com', 'ntt-hub.com']),
  }),
  link4sub: Object.freeze({
    path: 'link4sub',
    param: 'url',
    hostnames: Object.freeze(['link4sub.com', 'www.link4sub.com']),
  }),
  subnise: Object.freeze({
    path: 'subnise',
    param: 'url',
    hostnames: Object.freeze(['subnise.com', 'www.subnise.com']),
  }),
  boostylink: Object.freeze({
    path: 'boostylink',
    param: 'url',
    hostnames: Object.freeze(['boostylink.com', 'www.boostylink.com']),
  }),
  bstshrt: Object.freeze({
    path: 'bstshrt',
    param: 'url',
    hostnames: Object.freeze(['bstshrt.com', 'www.bstshrt.com', 'bst.shrt']),
  }),
  sub2s: Object.freeze({
    path: 'sub2s',
    param: 'url',
    hostnames: Object.freeze(['sub2s.com', 'www.sub2s.com']),
  }),
  linkunlocker: Object.freeze({
    path: 'linkunlocker',
    param: 'url',
    hostnames: Object.freeze(['linkunlocker.com', 'www.linkunlocker.com']),
  }),
  mboost: Object.freeze({
    path: 'mboost',
    param: 'url',
    hostnames: Object.freeze(['mboost.me', 'www.mboost.me', 'mboost.com']),
  }),
  sub4unlock: Object.freeze({
    path: 'sub4unlock',
    param: 'url',
    hostnames: Object.freeze(['sub4unlock.com', 'www.sub4unlock.com']),
  }),
});

/** @type {Readonly<Record<string, ProviderConfig>>} */
export const GENERATOR_PROVIDERS = Object.freeze({
  'delta-gen-android': Object.freeze({
    path: 'delta-gen-android',
    param: null,
    hostnames: Object.freeze(['delta-android.com', 'www.delta-android.com']),
  }),
  'delta-gen-ios': Object.freeze({
    path: 'delta-gen-ios',
    param: null,
    hostnames: Object.freeze(['delta-ios.com', 'www.delta-ios.com']),
  }),
  'yui-asset-shop': Object.freeze({
    path: 'yui-asset-shop',
    param: null,
    hostnames: Object.freeze(['yui-asset-shop.com', 'www.yui-asset-shop.com', 'cidontop.com']),
  }),
});

// Fail fast on key collision between independent registries
for (const key of Object.keys(GENERATOR_PROVIDERS)) {
  if (Object.prototype.hasOwnProperty.call(BYPASS_PROVIDERS, key)) {
    throw new Error(`Registry key collision: "${key}" exists in both bypass and generator registries`);
  }
}

/**
 * Build hostname → provider-key map, indexing both with and without "www.".
 * @param {Readonly<Record<string, ProviderConfig>>} registry
 * @returns {ReadonlyMap<string, string>}
 */
function buildHostnameMap(registry) {
  const map = new Map();
  for (const [key, cfg] of Object.entries(registry)) {
    for (const h of cfg.hostnames) {
      const lower = h.toLowerCase();
      map.set(lower, key);
      if (lower.startsWith('www.')) {
        map.set(lower.slice(4), key);
      } else {
        map.set(`www.${lower}`, key);
      }
    }
  }
  return map;
}

/** @type {ReadonlyMap<string, string>} */
export const BYPASS_HOSTNAME_MAP = buildHostnameMap(BYPASS_PROVIDERS);

/** @type {ReadonlyMap<string, string>} */
export const GENERATOR_HOSTNAME_MAP = buildHostnameMap(GENERATOR_PROVIDERS);

export function listBypassProviders() {
  return Object.keys(BYPASS_PROVIDERS).map((key) => ({
    id: key,
    path: BYPASS_PROVIDERS[key].path,
    param: BYPASS_PROVIDERS[key].param,
    hostnames: BYPASS_PROVIDERS[key].hostnames,
  }));
}

export function listGeneratorProviders() {
  return Object.keys(GENERATOR_PROVIDERS).map((key) => ({
    id: key,
    path: GENERATOR_PROVIDERS[key].path,
    param: GENERATOR_PROVIDERS[key].param,
    hostnames: GENERATOR_PROVIDERS[key].hostnames,
  }));
}
