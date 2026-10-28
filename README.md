# LogLens

A dependency-free static dashboard for live LogStreamer events.

## Run locally

1. Copy `config.example.js` to `config.js` and set `apiBaseUrl` to the LogStreamer origin.
2. Add the exact origin serving this page to LogStreamer `server.cors_allowed_origins`.
3. Serve this directory with any static HTTP server, then open its URL. For example, from this directory run `python3 -m http.server 4173` and add `http://localhost:4173` to the allowlist.

The page fetches `/api/services` and opens one `/api/logs/stream` EventSource. Service and severity filters and Combined/Separated layouts are local to the browser. At most 500 events are held in memory. The application never persists events and renders log values as text.

Pause freezes the displayed rows while the stream and buffer continue updating. Resume shows the retained events; overflow and paused-arrival counts remain visible. Auto-scroll is enabled by default and can be disabled to keep scroll positions. Clear empties only LogLens’s browser buffer.

LogStreamer may replay its recent-history snapshot after an SSE reconnect, so events cleared in LogLens can appear again if the connection reconnects.

Search matches message text within the current buffer. Select **Show fields** on an event to inspect its structured fields; values are displayed as text.

Connection and viewing-control status changes are announced to assistive technology, while individual log rows remain available to browse without live-announcing every incoming event.

Run the unit checks with `npm test` (Node.js built-in test runner; no package installation is needed).

## Deployment

LogLens is a provider-neutral static site. For production, copy `config.example.js` to `config.js`, set `apiBaseUrl` to the public HTTPS origin of LogStreamer, upload the static files, and add the exact HTTPS origin of the LogLens site to LogStreamer’s `server.cors_allowed_origins`. See [deployment and security](docs/deployment.md) for CSP, TLS, and reverse-proxy requirements. `config.js` contains a public API URL, never a token or other secret.

Optional initial display parameters are `services` (a comma-separated list) and `view=combined|separated`. Only configured service names are selected; if none of the requested names exist, all configured services are selected. Invalid or missing views use Combined. These parameters affect local presentation only.
