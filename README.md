# LogLens

A dependency-free static dashboard for live LogStreamer events.

## Run locally

1. Copy `config.example.js` to `config.js` and set `apiBaseUrl` to the LogStreamer origin.
2. Add the exact origin serving this page to LogStreamer `server.cors_allowed_origins`.
3. Serve this directory with any static HTTP server, then open its URL.

The page fetches `/api/services` and opens one `/api/logs/stream` EventSource. Service and severity filters and Combined/Separated layouts are local to the browser. At most 500 events are held in memory. The application never persists events and renders log values as text.

Run the unit checks with `npm test` (Node.js built-in test runner; no package installation is needed).
