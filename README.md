# Universal Bypass API

Cloudflare Workers API gateway that detects supported providers and forwards requests to the fixed upstream origin `https://api.bypass.lat/bypass/free/`.

Compatible with the Cloudflare free plan. No paid services, no Node-only APIs at runtime.

Version: **1.2.0**

## Public Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/bypass?url=<ENCODED_URL>` | Regular bypass — auto-detect provider from hostname |
| GET | `/gen?provider=<id>` | Generator — explicit provider selection (required) |
| GET | `/health` | Liveness |
| GET | `/providers` | List both independent registries |
| OPTIONS | `*` | CORS preflight |

**Registries are independent.** Generator endpoints never appear under `/bypass` and bypass endpoints never appear under `/gen`.

## Bypass Providers (22)

Selected automatically from the hostname of the `url` query parameter. Exact map lookup only — no substring matching.

| Provider ID | Upstream path | Parameter |
|-------------|---------------|-----------|
| link-unlock | link-unlock | url |
| voidpath | voidpath | — |
| trigon | trigon | — |
| violated | violated | — |
| xeno | xeno | — |
| lds-hub | LDS-HUB | — |
| delta | delta | url |
| rekonise | rekonise | url |
| delta-5s | delta-5s | url |
| luarmor-org | luarmor-org | — |
| linkvertise | linkvertise | url |
| neox-hub | neox-hub | — |
| pandadev | pandadev | url |
| ntt-hub | ntt-hub | url |
| link4sub | link4sub | url |
| subnise | subnise | url |
| boostylink | boostylink | url |
| bstshrt | bstshrt | url |
| sub2s | sub2s | url |
| linkunlocker | linkunlocker | url |
| mboost | mboost | url |
| sub4unlock | sub4unlock | url |

## Generator Providers (3)

Must be selected with `?provider=<id>`. These endpoints do **not** accept a `url` parameter.

| Provider ID | Upstream path | Parameter |
|-------------|---------------|-----------|
| delta-gen-android | delta-gen-android | — |
| delta-gen-ios | delta-gen-ios | — |
| yui-asset-shop | yui-asset-shop | — |

Example:

```
GET /gen?provider=delta-gen-android
```

If the provider cannot be identified, the API returns a clear JSON error listing the supported IDs.

## Security Controls

- HTTP/HTTPS only
- Embedded credentials rejected
- Private / reserved IPv4 & IPv6 blocked (incl. decimal/hex/octal encodings)
- Internal / `.local` / `.localhost` hostnames blocked
- Fixed upstream origin (no open proxy)
- Redirects outside upstream origin blocked
- Request query size limit
- Upstream timeout (25 s)
- CORS headers
- Consistent JSON error envelope with `requestId`
- No secrets stored; submitted URLs are not logged by the Worker

## Project Layout

```
src/
  index.js        Entry + route dispatch
  providers.js    Independent bypass + generator registries (frozen)
  detect.js       Hostname / explicit provider selection
  router.js       Upstream URL construction + forwarding
  validation.js   URL / SSRF / size checks
test/
  unit.test.js
  routes.test.js
package.json
wrangler.toml
jest.config.js
README.md
```

## Local Development

```bash
npm install
npx wrangler dev
```

## Deploy (free plan)

```bash
npm install
npx wrangler login   # once
npx wrangler deploy
```

The Worker will be available at `https://universal-bypass-api.<your-subdomain>.workers.dev`.

## Tests

```bash
npm test
```

Tests mock upstream `fetch` and cover:

- All 22 bypass hostname → path mappings
- All 3 generator explicit selections
- Registry isolation (no cross-routing)
- URL validation, private IPs, credentials, alternate IP encodings
- CORS, method rejection, timeouts, upstream errors
- Correct query-parameter behaviour (url present only when required)

## Notes on Unverified Mappings

Hostname lists are best-effort mappings derived from common public domains associated with each provider path. The upstream service at `api.bypass.lat` is treated as the source of truth for path and parameter behaviour. If a live hostname differs, update the `hostnames` array for that provider in `src/providers.js` — detection uses exact map lookup only (no unsafe substring matching).

Generator selection prefers the explicit `provider=` query parameter because reliable public hostnames for the three generator endpoints are not consistently documented.

## Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "UNSUPPORTED_PROVIDER",
    "message": "..."
  },
  "requestId": "uuid"
}
```

Common codes: `MISSING_URL`, `INVALID_URL`, `INVALID_SCHEME`, `CREDENTIALS_REJECTED`, `PRIVATE_IP`, `UNSUPPORTED_PROVIDER`, `GENERATOR_UNSPECIFIED`, `UNKNOWN_GENERATOR`, `UPSTREAM_TIMEOUT`, `UPSTREAM_ERROR`, `METHOD_NOT_ALLOWED`, `NOT_FOUND`.
