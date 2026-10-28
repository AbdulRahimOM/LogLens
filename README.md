# LogLens

A dependency-free static dashboard for live LogStreamer events.

## Run locally

1. Copy `config.example.js` to `config.js` and set `apiBaseUrl` to the LogStreamer origin.
2. Add the exact origin serving this page to LogStreamer `server.cors_allowed_origins`.
3. Serve this directory with any static HTTP server, then open its URL.

The page fetches `/api/services` and opens one `/api/logs/stream` EventSource. Service and severity filters and Combined/Separated layouts are local to the browser. At most 500 events are held in memory. The application never persists events and renders log values as text.

Pause freezes the displayed rows while the stream and buffer continue updating. Resume shows the retained events; overflow and paused-arrival counts remain visible. Auto-scroll is enabled by default and can be disabled to keep scroll positions. Clear empties only LogLens’s browser buffer.

LogStreamer may replay its recent-history snapshot after an SSE reconnect, so events cleared in LogLens can appear again if the connection reconnects.

Run the unit checks with `npm test` (Node.js built-in test runner; no package installation is needed).
