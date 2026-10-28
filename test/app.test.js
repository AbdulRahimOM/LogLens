import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBounded, fetchServices, filterEvents, normalizeServiceResponse, parseEventData, preserveSelection, reconnectState, validateApiBaseUrl, validEvent } from '../app.js';

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

test('reports services API failures and retries can consume a later good response', async () => {
  await assert.rejects(fetchServices('http://localhost:8080', async () => ({ ok: false, status: 503 })), /503/);
  const services = await fetchServices('http://localhost:8080', async url => ({
    ok: url.endsWith('/api/services'), json: async () => ({ services: [{ name: 'api', state: 'running' }] })
  }));
  assert.equal(services[0].name, 'api');
});

test('filters events locally by selected source and level', () => {
  const events = [{ source: 'api', level: 'ERROR' }, { source: 'worker', level: 'INFO' }, { source: 'api', level: 'INFO' }];
  assert.deepEqual(filterEvents(events, new Set(['api']), 'INFO'), [events[2]]);
  assert.deepEqual(filterEvents(events, new Set(['api', 'worker'])), events);
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
