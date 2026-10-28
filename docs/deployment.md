# Deployment and Security

LogLens is a static site. It does not require a frontend build, server-side rendering, or a vendor-specific hosting service.

## Configure and serve

1. Copy `config.example.js` to `config.js`.
2. Set `window.LOG_LENS_CONFIG.apiBaseUrl` to the LogStreamer HTTP(S) origin, without a path. For production, use the HTTPS origin, such as `https://logs.example.com`.
3. Serve the LogLens directory from a static host over HTTPS. Keep `index.html`, `app.js`, `styles.css`, and `config.js` together, and make sure `/` and URLs with query parameters serve `index.html` so direct refreshes resolve correctly.
4. In LogStreamer, set `server.cors_allowed_origins` to the exact LogLens origin, including scheme and non-default port if present. For example, `https://lens.example.com`. Do not add a path or wildcard.

For local development, `python3 -m http.server 4173` serves the directory at `http://localhost:4173`; configure that exact origin in LogStreamer. The development API origin can remain `http://127.0.0.1:8080` in `config.js`.

`config.js` is client-visible configuration. It must contain only the API origin, never an ingestion token or other secret. LogLens calls only `GET /api/services` and `GET /api/logs/stream`; it does not authenticate users. CORS controls which browser origins can read responses. It does not prevent direct HTTP clients from accessing a publicly reachable service and is not authentication or authorization. Protect sensitive logs with a private network or an authenticated reverse proxy, and use TLS for both the static site and LogStreamer.

## Content Security Policy

Configure the static host to return this response header on the LogLens documents. Replace `https://logs.example.com` with the exact origin configured in `config.js` and in LogStreamer’s CORS allowlist:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://logs.example.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

This permits the site’s own static assets and the selected API origin for the services fetch and EventSource connection. Do not add a wildcard or unrelated API hosts. If a deployment changes the LogStreamer origin, update the runtime config, CSP, and CORS allowlist together.

## Server-Sent Events through a reverse proxy

If LogStreamer is behind a reverse proxy, turn off response buffering and caching for `/api/logs/stream`. Set the upstream read timeout longer than LogStreamer’s configured SSE keepalive interval. For example, an nginx location can use:

```nginx
location /api/logs/stream {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

The static host should also support direct navigation and refresh at `/`; the page loads its CSS and scripts relative to `index.html`. LogStreamer keeps recent history only in memory. A reconnect receives its current history snapshot and may repeat events; delivery is not exactly once and no browser log buffer is persisted.

## Initial view links

Use URL parameters to share a starting view. Names are intersected with the services returned by LogStreamer; unknown names are ignored, and an empty or entirely unknown selection falls back to all configured services.

```text
https://lens.example.com/?services=api,worker&view=separated
```

Only the initial display state is affected. LogLens does not rewrite the URL, add backend sources, or open additional SSE connections.
