import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendBounded, clearEvents, createLogState, displayedEvents, emptyStateCopy, fetchServices, filterEvents, formatStructuredFields, hasStructuredFields, normalizeServiceResponse, parseEventData, parseInitialServices, parseInitialView, preserveSelection, receiveEvent, reconnectState, restoreScroll, setPaused, toggleExpandedEvent, validateApiBaseUrl, validEvent } from '../app.js';

test('validates runtime API origin and rejects path or non-http origins', () => {
  assert.equal(validateApiBaseUrl(' https://logs.example.com/ '), 'https://logs.example.com');
  assert.throws(() => validateApiBaseUrl('file:///tmp/api'));
  assert.throws(() => validateApiBaseUrl('https://logs.example.com/api'));
});

test('normalizes services and preserves still-configured source selections', () => {
  const services = normalizeServiceResponse({ services: [{ name: 'api', type: 'docker', state: 'running' }, { name: 'db', state: 'retrying' }] });
  assert.deepEqual([...preserveSelection(null, services)], ['api', 'db']);
  assert.deepEqual([...preserveSelection(new Set(['db', 'gone']), services)], ['db']);
  assert.throws(() => normalizeServiceResponse({}));
});

test('initial URL service selection intersects configured names and falls back to all', () => {
  const services = [{ name: 'api' }, { name: 'worker' }, { name: 'db' }];
  assert.deepEqual([...parseInitialServices('', services)], ['api', 'worker', 'db']);
  assert.deepEqual([...parseInitialServices('?services=', services)], ['api', 'worker', 'db']);
  assert.deepEqual([...parseInitialServices('?services=unknown', services)], ['api', 'worker', 'db']);
  assert.deepEqual([...parseInitialServices('?services=api,unknown,db,api', services)], ['api', 'db']);
  assert.deepEqual([...parseInitialServices('?services=%20worker%20', services)], ['worker']);
  assert.deepEqual([...parseInitialServices('?services=api', [])], []);
});

test('initial URL view accepts only combined or separated and defaults to combined', () => {
  assert.equal(parseInitialView('?view=separated'), 'separated');
  assert.equal(parseInitialView('?view=combined'), 'combined');
  assert.equal(parseInitialView('?view=SEPARATED'), 'combined');
  assert.equal(parseInitialView('?view=other'), 'combined');
  assert.equal(parseInitialView(''), 'combined');
});

test('reports services API failures and retries can consume a later good response', async () => {
  await assert.rejects(fetchServices('http://localhost:8080', async () => ({ ok: false, status: 503 })), /503/);
  const services = await fetchServices('http://localhost:8080', async url => ({
    ok: url.endsWith('/api/services'), json: async () => ({ services: [{ name: 'api', state: 'running' }] })
  }));
  assert.equal(services[0].name, 'api');
});

test('filters events locally by selected source and level', () => {
  const events = [
    { source: 'api', level: 'ERROR', message: 'request FAILED' },
    { source: 'worker', level: 'INFO', message: 'worker ready' },
    { source: 'api', level: 'INFO', message: 'request completed' }
  ];
  assert.deepEqual(filterEvents(events, new Set(['api']), 'INFO'), [events[2]]);
  assert.deepEqual(filterEvents(events, new Set(['api', 'worker'])), events);
  assert.deepEqual(filterEvents(events, new Set(['api', 'worker']), 'ALL', 'FaIl'), [events[0]]);
  assert.deepEqual(filterEvents(events, new Set(['api']), 'ERROR', 'fail'), [events[0]]);
  assert.deepEqual(filterEvents(events, new Set(['api']), 'INFO', 'missing'), []);
  assert.deepEqual(filterEvents(events, new Set(['api']), 'ALL', 'REQUEST '), [events[0], events[2]]);
});

test('bounded buffer retains latest events in incoming order', () => {
  assert.deepEqual(appendBounded([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(appendBounded([{ _order: 4 }, { _order: 5 }, { _order: 6 }], { _order: 2 }, 3), [{ _order: 4 }, { _order: 5 }, { _order: 6 }]);
  const full = appendBounded(Array.from({ length: 500 }, (_, i) => i), 500);
  assert.equal(full.length, 500);
  assert.equal(full[0], 1);
  assert.equal(full.at(-1), 500);
});

test('rejects malformed event records', () => {
  assert.equal(validEvent({ timestamp: 'now', source: 'api', level: 'INFO', message: 'ok' }), true);
  assert.equal(validEvent({ timestamp: 1, source: 'api' }), false);
  assert.equal(parseEventData('{broken'), null);
  assert.equal(parseEventData('{"source":"api"}'), null);
  assert.equal(parseEventData('{"timestamp":"now","source":"api","level":"INFO","message":"ok"}').message, 'ok');
});

test('maps EventSource reconnect and closed states', () => {
  const states = { CONNECTING: 0, OPEN: 1, CLOSED: 2 };
  assert.equal(reconnectState(states.CONNECTING, states), 'Reconnecting');
  assert.equal(reconnectState(states.CLOSED, states), 'Closed');
  assert.equal(reconnectState(states.OPEN, states), 'Connected');
});

test('pause freezes displayed rows while buffering and counting incoming events', () => {
  const state = createLogState(3);
  const events = [1, 2, 3].map(_order => ({ _order }));
  for (const event of events) receiveEvent(state, event);
  setPaused(state, true);
  receiveEvent(state, { _order: 4 });
  receiveEvent(state, { _order: 5 });

  assert.deepEqual(displayedEvents(state), events);
  assert.deepEqual(state.events.map(event => event._order), [3, 4, 5]);
  assert.equal(state.pausedCount, 2);
  assert.equal(state.droppedCount, 2);
  assert.equal(receiveEvent(state, { _order: 6 }).shouldRender, false);
  assert.equal(state.pausedCount, 3);
  setPaused(state, false);
  assert.deepEqual(displayedEvents(state).map(event => event._order), [4, 5, 6]);
});

test('clear during pause empties retained and frozen events, then accepts new arrivals', () => {
  const state = createLogState(2);
  receiveEvent(state, { _order: 1 });
  receiveEvent(state, { _order: 2 });
  receiveEvent(state, { _order: 3 });
  setPaused(state, true);
  receiveEvent(state, { _order: 4 });
  clearEvents(state);

  assert.equal(state.droppedCount, 0);
  assert.equal(state.pausedCount, 0);
  assert.deepEqual(displayedEvents(state), []);
  receiveEvent(state, { _order: 5 });
  assert.deepEqual(displayedEvents(state), []);
  assert.deepEqual(state.events.map(event => event._order), [5]);
  setPaused(state, false);
  assert.deepEqual(displayedEvents(state).map(event => event._order), [5]);
});

test('a new pause resets the paused-arrival count', () => {
  const state = createLogState();
  setPaused(state, true);
  receiveEvent(state, { _order: 1 });
  setPaused(state, false);
  setPaused(state, true);
  assert.equal(state.pausedCount, 0);
});

test('search sees incoming events in the bounded buffer and frozen rows while paused', () => {
  const state = createLogState(2);
  receiveEvent(state, { _key: 1, _order: 1, source: 'api', level: 'INFO', message: 'before' });
  setPaused(state, true);
  receiveEvent(state, { _key: 2, _order: 2, source: 'api', level: 'INFO', message: 'after' });
  assert.deepEqual(filterEvents(displayedEvents(state), new Set(['api']), 'ALL', 'after'), []);
  setPaused(state, false);
  assert.deepEqual(filterEvents(displayedEvents(state), new Set(['api']), 'ALL', 'AFTER').map(event => event._key), [2]);
});

test('structured fields omit empty values and format nested and large content as JSON text', () => {
  assert.equal(hasStructuredFields(undefined), false);
  assert.equal(hasStructuredFields(null), false);
  assert.equal(hasStructuredFields({}), false);
  assert.equal(hasStructuredFields([]), false);
  assert.equal(hasStructuredFields({ nested: {} }), true);
  const fields = { nested: { count: 3 }, markup: '<img src=x onerror=alert(1)>', large: 'x'.repeat(100_000) };
  const output = formatStructuredFields(fields);
  assert.match(output, /\n  "nested": \{/);
  assert.ok(output.includes('<img src=x onerror=alert(1)>'));
  assert.ok(output.includes('x'.repeat(100_000)));
});

test('expanded event state remains only while the corresponding event is buffered', () => {
  const state = createLogState(2);
  receiveEvent(state, { _key: 1, _order: 1 });
  receiveEvent(state, { _key: 2, _order: 2 });
  assert.equal(toggleExpandedEvent(state, 1), true);
  assert.equal(toggleExpandedEvent(state, 1), false);
  toggleExpandedEvent(state, 2);
  receiveEvent(state, { _key: 3, _order: 3 });
  assert.deepEqual([...state.expandedEventKeys], [2]);
  assert.equal(toggleExpandedEvent(state, 2), false);
  toggleExpandedEvent(state, 3);
  clearEvents(state);
  assert.deepEqual([...state.expandedEventKeys], []);
});

test('auto-scroll goes to the bottom; disabled mode restores independent panel offsets', () => {
  const panels = new Map([['api', { scrollTop: 18, scrollHeight: 240 }], ['worker', { scrollTop: 42, scrollHeight: 360 }]]);
  for (const [name, panel] of panels) restoreScroll(panel, panel.scrollTop, false);
  assert.equal(panels.get('api').scrollTop, 18);
  assert.equal(panels.get('worker').scrollTop, 42);
  for (const panel of panels.values()) restoreScroll(panel, 0, true);
  assert.equal(panels.get('api').scrollTop, 240);
  assert.equal(panels.get('worker').scrollTop, 360);
});

test('empty states distinguish service loading, missing services, filters, and stream connection', () => {
  const copy = values => emptyStateCopy({ serviceCount: 1, displayedCount: 0, visibleCount: 0, ...values });
  assert.equal(copy({ servicesLoaded: false, serviceLoadError: false, connection: 'Connecting' }).title, 'Loading services');
  assert.equal(copy({ servicesLoaded: false, serviceLoadError: true, connection: 'Connecting' }).title, 'Services unavailable');
  assert.equal(copy({ servicesLoaded: true, serviceCount: 0, connection: 'Connected' }).title, 'No configured services');
  assert.equal(copy({ servicesLoaded: true, displayedCount: 3, visibleCount: 0, connection: 'Connected' }).title, 'No matching events');
  assert.equal(copy({ servicesLoaded: true, connection: 'Connecting' }).title, 'Connecting to LogStreamer');
  assert.equal(copy({ servicesLoaded: true, connection: 'Reconnecting' }).title, 'Reconnecting to LogStreamer');
  assert.equal(copy({ servicesLoaded: true, connection: 'Closed' }).title, 'Log stream closed');
  assert.equal(copy({ servicesLoaded: true, connection: 'Connected' }).title, 'Waiting for log events');
});

test('page exposes accessible controls, focused log navigation, and concise live status', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(html, /id="service-filter-toggle"[^>]*aria-controls="service-filter-menu"/);
  assert.match(html, /id="service-filter-menu"[^>]*aria-label="Filter by services"/);
  assert.doesNotMatch(html, /<select id="source-filter"/);
  assert.match(html, /id="message-search" type="search"/);
  assert.match(html, /id="log-view" class="log-view" aria-live="off"/);
  assert.match(html, /id="empty-state" role="status" aria-live="polite"/);
  assert.match(html, /id="status-announcer"[^>]*aria-live="polite"/);
  assert.match(html, /class="connection" aria-live="polite"/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.auto-scroll-control input:focus-visible/);
  assert.match(css, /@media\(max-width:1000px\)/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(app, /details\.textContent = formatStructuredFields/);
});
