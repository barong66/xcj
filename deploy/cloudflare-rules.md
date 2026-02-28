# Cloudflare Configuration — xxxaccounter

Production Cloudflare setup for sites proxied through Cloudflare.
HTTPS termination happens at Cloudflare; nginx listens on port 80.

---

## 1. DNS

| Record | Type | Value | Proxy |
|--------|------|-------|-------|
| `@` (root) | A | `<server-ip>` | Proxied (orange cloud) |
| `www` | CNAME | `@` | Proxied (orange cloud) |

All traffic must flow through Cloudflare for caching and WAF to work.
Do **not** expose the origin IP in any public DNS records.

---

## 2. SSL/TLS

| Setting | Value |
|---------|-------|
| Encryption mode | **Full (strict)** |
| Minimum TLS version | TLS 1.2 |
| TLS 1.3 | Enabled |
| Automatic HTTPS Rewrites | ON |
| Always Use HTTPS | ON |
| HSTS | Enabled (max-age 6 months, includeSubDomains) |

Origin server does **not** need its own TLS certificate since Cloudflare
terminates TLS. However, for Full (strict) mode, install a Cloudflare
Origin CA certificate on the origin server if you later add TLS to nginx.

---

## 3. Cache Rules

Configure these via **Rules > Cache Rules** in the Cloudflare dashboard.
Rules are evaluated top-to-bottom; first match wins.

### Rule 1: Events API — Bypass Cache

| Field | Value |
|-------|-------|
| When | URI Path starts with `/api/v1/events` |
| Cache eligibility | **Bypass cache** |
| Rationale | Analytics events are unique POST requests that must never be cached |

### Rule 2: Video Listings API — Short Cache

| Field | Value |
|-------|-------|
| When | URI Path starts with `/api/v1/videos` AND Request Method equals `GET` |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | 60 seconds |
| Browser TTL | 30 seconds |
| Cache Key | Include query string |
| Rationale | Video listings change frequently as new content is added |

### Rule 3: Categories API — Medium Cache

| Field | Value |
|-------|-------|
| When | URI Path starts with `/api/v1/categories` AND Request Method equals `GET` |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | 300 seconds (5 minutes) |
| Browser TTL | 120 seconds |
| Cache Key | Include query string |
| Rationale | Categories change rarely; 5-minute edge cache is acceptable |

### Rule 4: Next.js Static Assets — Long Cache

| Field | Value |
|-------|-------|
| When | URI Path starts with `/_next/static/` |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | 31536000 seconds (1 year) |
| Browser TTL | 31536000 seconds (1 year) |
| Cache Key | Include query string (hashed filenames handle busting) |
| Rationale | Next.js static files have content hashes in filenames; immutable |

### Rule 5: Sitemap — Hourly Cache

| Field | Value |
|-------|-------|
| When | URI Path equals `/sitemap.xml` |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | 3600 seconds (1 hour) |
| Browser TTL | 3600 seconds |
| Rationale | Sitemap regenerates periodically; 1-hour cache keeps search engines current |

### Rule 6: Default — Everything Else

| Field | Value |
|-------|-------|
| When | (catch-all, all remaining requests) |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | 120 seconds |
| Browser TTL | 60 seconds |
| Serve stale | **Stale-while-revalidate** enabled |
| Rationale | SSR pages benefit from short edge caching while keeping content fresh |

---

## 4. Performance

| Setting | Value | Notes |
|---------|-------|-------|
| Brotli | **ON** | Better compression than gzip for text assets |
| Auto Minify | JS: ON, CSS: ON, HTML: ON | Reduces payload size at the edge |
| Rocket Loader | **OFF** | Conflicts with Next.js hydration; causes rendering issues |
| Early Hints | **ON** | Sends 103 responses for faster resource loading |
| HTTP/2 | ON (default) | Multiplexing for parallel asset loading |
| HTTP/3 (QUIC) | **ON** | Faster connections, especially on mobile |
| Speed Brain | **OFF** | Evaluate before enabling; may conflict with SPA navigation |
| Polish (image optimization) | **OFF** | Images are already optimized during parsing |

---

## 5. Security

### WAF (Web Application Firewall)

| Setting | Value |
|---------|-------|
| Security Level | Medium |
| WAF Managed Rules | ON (Cloudflare Managed Ruleset) |
| OWASP Core Ruleset | ON (Paranoia Level 1) |
| Challenge Passage | 30 minutes |

### Bot Management

| Setting | Value |
|---------|-------|
| Bot Fight Mode | **ON** |
| Super Bot Fight Mode | Definitely automated: Block |
| Super Bot Fight Mode | Likely automated: Managed Challenge |
| Super Bot Fight Mode | Verified bots: **Allow** |

**Important:** Verified bots (Googlebot, Bingbot, etc.) must be allowed.
The site depends on search engine indexing for organic traffic.

### Additional Security

| Setting | Value |
|---------|-------|
| Browser Integrity Check | ON |
| Hotlink Protection | ON (protect `/thumbnails/` and `/previews/` paths) |
| Email Address Obfuscation | ON |
| Server-Side Excludes | ON |

### Rate Limiting (Cloudflare-level)

Create these rate limiting rules as a second layer behind nginx rate limiting:

| Rule | Threshold | Action | Duration |
|------|-----------|--------|----------|
| API abuse | 200 req/10sec per IP to `/api/*` | Block | 1 minute |
| Events flood | 1000 req/10sec per IP to `/api/v1/events*` | Block | 1 minute |
| Login/admin brute force | 10 req/min per IP to `/admin*` | Block | 10 minutes |

---

## 6. Page Rules (Legacy — use only if Cache Rules are unavailable)

If your Cloudflare plan does not support Cache Rules, configure these Page Rules:

| Priority | URL Pattern | Setting |
|----------|-------------|---------|
| 1 | `*example.com/api/v1/events*` | Cache Level: Bypass |
| 2 | `*example.com/api/v1/videos*` | Cache Level: Everything, Edge TTL: 60s |
| 3 | `*example.com/api/v1/categories*` | Cache Level: Everything, Edge TTL: 300s |
| 4 | `*example.com/_next/static/*` | Cache Level: Everything, Edge TTL: 1 month |
| 5 | `*example.com/sitemap.xml` | Cache Level: Everything, Edge TTL: 1 hour |

---

## 7. Workers (Optional)

An optional Cloudflare Worker can normalize cache keys by stripping
unnecessary query parameters. Deploy only if cache hit ratio is low
due to query string variation.

```javascript
// worker: cache-key-normalizer
// Deploy to route: *example.com/api/*

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Strip tracking/analytics params from cache key
    const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid', '_'];
    for (const param of stripParams) {
      url.searchParams.delete(param);
    }

    // Sort remaining params for consistent cache keys
    url.searchParams.sort();

    const cleanRequest = new Request(url.toString(), request);
    return fetch(cleanRequest, {
      cf: {
        cacheEverything: true,
        cacheTtl: 60,
      },
    });
  },
};
```

---

## 8. Deployment Checklist

- [ ] DNS records created and proxied (orange cloud)
- [ ] SSL mode set to Full (strict)
- [ ] All 6 cache rules created in order
- [ ] Rocket Loader is OFF
- [ ] Bot Fight Mode is ON with verified bots allowed
- [ ] Rate limiting rules created
- [ ] Hotlink Protection enabled
- [ ] HSTS enabled with 6-month max-age
- [ ] Origin server IP is not exposed in any public records
- [ ] Test cache headers: `curl -sI https://example.com/ | grep cf-cache-status`
- [ ] Verify `cf-cache-status: HIT` on static assets after warm-up
- [ ] Verify `cf-cache-status: DYNAMIC` or `BYPASS` on events endpoint
