export const MAX_EVENTS = 500;
export const LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR', 'UNKNOWN']);

export function createLogState(capacity = MAX_EVENTS) {
  return { capacity, events: [], paused: false, pausedCount: 0, droppedCount: 0, frozenEvents: null };
}

export function validateApiBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Set apiBaseUrl in config.js to the LogStreamer HTTP(S) origin.');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error('The LogStreamer API URL in config.js is invalid. Use an origin such as http://127.0.0.1:8080.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('The LogStreamer API URL must be an HTTP(S) origin without a path, query, or credentials.');
  }
  return parsed.origin;
}

export function normalizeServiceResponse(payload) {
  if (!payload || !Array.isArray(payload.services)) throw new Error('The services API returned an unexpected response.');
  return payload.services.filter(s => s && typeof s.name === 'string').map(s => ({
    name: s.name, type: String(s.type ?? ''), state: String(s.state ?? 'unknown'), last_error: typeof s.last_error === 'string' ? s.last_error : ''
  }));
}

export async function fetchServices(apiBaseUrl, fetchImpl = fetch) {
  const response = await fetchImpl(`${apiBaseUrl}/api/services`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Services request failed (${response.status}).`);
  return normalizeServiceResponse(await response.json());
}

export function preserveSelection(previous, services) {
  const available = new Set(services.map(s => s.name));
  if (previous === null) return new Set(available);
  return new Set([...previous].filter(name => available.has(name)));
}

export function appendBounded(events, event, capacity = MAX_EVENTS) {
  const next = [...events, event];
  if (event && typeof event._order === 'number') next.sort((a, b) => a._order - b._order);
  return next.length > capacity ? next.slice(next.length - capacity) : next;
}

export function receiveEvent(state, event) {
  const overflow = state.events.length >= state.capacity;
  state.events = appendBounded(state.events, event, state.capacity);
  if (overflow) state.droppedCount += 1;
  if (state.paused) state.pausedCount += 1;
  return { overflow, shouldRender: !state.paused };
}

export function setPaused(state, paused) {
  if (state.paused === paused) return;
  if (paused) {
    state.paused = true;
    state.pausedCount = 0;
    state.frozenEvents = [...state.events];
  } else {
    state.paused = false;
    state.frozenEvents = null;
  }
}

export function clearEvents(state) {
  state.events = [];
  state.droppedCount = 0;
  state.pausedCount = 0;
  if (state.paused) state.frozenEvents = [];
}

export function displayedEvents(state) {
  return state.paused ? state.frozenEvents : state.events;
}

export function restoreScroll(element, savedTop, autoScroll) {
  element.scrollTop = autoScroll ? element.scrollHeight : (savedTop ?? element.scrollTop);
}

export function filterEvents(events, selectedSources, level = 'ALL') {
  return events.filter(event => selectedSources.has(event.source) && (level === 'ALL' || event.level === level));
}

export function validEvent(event) {
  return event && typeof event === 'object' && !Array.isArray(event) &&
    typeof event.timestamp === 'string' && typeof event.source === 'string' &&
    typeof event.message === 'string' && typeof event.level === 'string';
}

export function parseEventData(data) {
  try {
    const event = JSON.parse(data);
    return validEvent(event) ? event : null;
  } catch {
    return null;
  }
}

export function reconnectState(readyState, states) {
  return readyState === states.CLOSED ? 'Closed' : readyState === states.CONNECTING ? 'Reconnecting' : 'Connected';
}

const byId = id => document.getElementById(id);

if (typeof document !== 'undefined') {
  const apiBase = (() => {
    try { return validateApiBaseUrl(window.LOG_LENS_CONFIG?.apiBaseUrl); }
    catch (error) { showNotice(error.message, true); return null; }
  })();
  const sourceSelect = byId('source-filter');
  const levelSelect = byId('level-filter');
  const logView = byId('log-view');
  const emptyState = byId('empty-state');
  const state = { ...createLogState(), services: [], selected: null, view: 'combined', level: 'ALL', autoScroll: true, eventSource: null, nextOrder: 0, scrollPositions: new Map() };

  function showNotice(message, error = false) {
    const notice = byId('notice'); notice.textContent = message; notice.hidden = false;
    notice.classList.toggle('error', error);
  }
  function setConnection(label, detail = '') {
    byId('connection-status').textContent = label;
    byId('connection-detail').textContent = detail;
    byId('connection-dot').className = `connection-dot ${label.toLowerCase()}`;
  }
  function selectedValues() { return new Set([...sourceSelect.options].filter(o => o.selected).map(o => o.value)); }
  function updateServiceOptions(services) {
    state.selected = preserveSelection(state.selected, services);
    state.services = services;
    sourceSelect.replaceChildren();
    for (const service of services) {
      const option = document.createElement('option');
      option.value = service.name;
      option.textContent = `${service.name} · ${service.state}`;
      option.selected = state.selected.has(service.name);
      sourceSelect.append(option);
    }
    render();
  }
  function updateControls() {
    const pause = byId('pause-toggle');
    pause.textContent = state.paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(state.paused));
    pause.classList.toggle('is-paused', state.paused);
    byId('auto-scroll').checked = state.autoScroll;
    const pausedStatus = byId('paused-status');
    pausedStatus.hidden = state.pausedCount === 0;
    pausedStatus.textContent = state.paused
      ? `Paused · ${state.pausedCount} event${state.pausedCount === 1 ? '' : 's'} received`
      : `${state.pausedCount} event${state.pausedCount === 1 ? '' : 's'} received while paused`;
    const droppedStatus = byId('dropped-status');
    droppedStatus.hidden = state.droppedCount === 0;
    droppedStatus.textContent = `${state.droppedCount} older event${state.droppedCount === 1 ? '' : 's'} dropped · buffer holds the latest ${state.capacity}`;
    byId('event-count').textContent = `${state.events.length} buffered event${state.events.length === 1 ? '' : 's'}`;
  }
  async function refreshServices() {
    try {
      updateServiceOptions(await fetchServices(apiBase));
      byId('notice').hidden = true;
    } catch (error) {
      showNotice(`Could not load services. ${error.message} Retrying shortly.`, true);
    }
  }
  function makeRow(event) {
    const row = document.createElement('article'); row.className = 'log-row';
    const meta = document.createElement('div'); meta.className = 'log-meta';
    const time = document.createElement('time'); time.textContent = formatTime(event.timestamp); time.dateTime = event.timestamp; meta.append(time);
    const source = document.createElement('span'); source.className = 'service-name'; source.textContent = event.source; source.style.setProperty('--service-hue', serviceHue(event.source)); meta.append(source);
    const level = document.createElement('span'); level.className = `level level-${safeLevel(event.level).toLowerCase()}`; level.textContent = safeLevel(event.level); meta.append(level);
    if (event.origin) { const origin = document.createElement('span'); origin.className = 'origin'; origin.textContent = event.origin; meta.append(origin); }
    const message = document.createElement('p'); message.className = 'message'; message.textContent = event.message;
    row.append(meta, message); return row;
  }
  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, fractionalSecondDigits: 3
    });
  }
  function safeLevel(value) { const upper = String(value).toUpperCase(); return LEVELS.has(upper) ? upper : 'UNKNOWN'; }
  function serviceHue(name) { let hash = 0; for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0; return Math.abs(hash) % 360; }
  function rememberScrollPositions() {
    state.scrollPositions.set(`${state.view}:outer`, logView.scrollTop);
    if (state.view === 'separated') {
      for (const panel of logView.querySelectorAll('.service-panel')) {
        const events = panel.querySelector('.panel-events');
        state.scrollPositions.set(`separated:${panel.dataset.source}`, events.scrollTop);
      }
    }
  }
  function restoreVisibleScroll() {
    restoreScroll(logView, state.scrollPositions.get(`${state.view}:outer`), state.autoScroll);
    if (state.view === 'separated') {
      for (const panel of logView.querySelectorAll('.service-panel')) {
        const events = panel.querySelector('.panel-events');
        restoreScroll(events, state.scrollPositions.get(`separated:${panel.dataset.source}`), state.autoScroll);
      }
    }
  }
  function render() {
    if (!logView) return;
    if (!state.autoScroll) rememberScrollPositions();
    const selected = state.selected ?? new Set(state.services.map(s => s.name));
    const visible = filterEvents(displayedEvents(state), selected, state.level);
    logView.replaceChildren(); logView.className = `log-view ${state.view}`;
    if (state.view === 'combined') {
      const list = document.createElement('div'); list.className = 'combined-list';
      for (const event of visible) list.append(makeRow(event));
      logView.append(list);
    } else {
      const groups = state.services.filter(s => selected.has(s.name));
      for (const service of groups) {
        const panel = document.createElement('section'); panel.className = 'service-panel';
        panel.dataset.source = service.name;
        const heading = document.createElement('header'); heading.className = 'panel-heading';
        const title = document.createElement('h2'); title.textContent = service.name;
        const serviceState = document.createElement('span'); serviceState.className = 'service-state'; serviceState.textContent = service.state;
        heading.append(title, serviceState); panel.append(heading);
        const list = document.createElement('div'); list.className = 'panel-events';
        const serviceEvents = visible.filter(event => event.source === service.name);
        if (!serviceEvents.length) { const empty = document.createElement('p'); empty.className = 'panel-empty'; empty.textContent = 'No matching events'; list.append(empty); }
        else for (const event of serviceEvents) list.append(makeRow(event));
        panel.append(list); logView.append(panel);
      }
    }
    emptyState.hidden = visible.length > 0;
    if (!state.services.length) { byId('empty-title').textContent = 'No configured services'; byId('empty-message').textContent = 'Add a source in LogStreamer configuration to see logs.'; }
    else if (state.events.length && !visible.length) { byId('empty-title').textContent = 'No matching events'; byId('empty-message').textContent = 'Adjust the service or level filters.'; }
    else { byId('empty-title').textContent = 'Waiting for log events'; byId('empty-message').textContent = 'Events from your configured services will appear here.'; }
    restoreVisibleScroll();
    updateControls();
  }
  function connect() {
    setConnection('Connecting');
    const stream = new EventSource(`${apiBase}/api/logs/stream`);
    state.eventSource = stream;
    stream.onopen = () => setConnection('Connected');
    stream.onerror = () => setConnection(reconnectState(stream.readyState, EventSource));
    stream.onmessage = message => {
      const event = parseEventData(message.data);
      if (!event) return;
      const parsedOrder = Number.parseInt(message.lastEventId, 10);
      const order = Number.isSafeInteger(parsedOrder) ? parsedOrder : state.nextOrder++;
      const result = receiveEvent(state, { ...event, _order: order });
      if (result.shouldRender) render();
      else updateControls();
    };
  }

  sourceSelect.addEventListener('change', () => { state.selected = selectedValues(); render(); });
  levelSelect.addEventListener('change', () => { state.level = levelSelect.value; render(); });
  byId('combined-view').addEventListener('click', () => setView('combined'));
  byId('separated-view').addEventListener('click', () => setView('separated'));
  byId('pause-toggle').addEventListener('click', () => {
    setPaused(state, !state.paused);
    updateControls();
    if (!state.paused) render();
  });
  byId('clear-logs').addEventListener('click', () => { clearEvents(state); render(); });
  byId('auto-scroll').addEventListener('change', event => {
    state.autoScroll = event.currentTarget.checked;
    if (state.autoScroll) restoreVisibleScroll();
  });
  function setView(view) {
    state.view = view;
    for (const [id, value] of [['combined-view', 'combined'], ['separated-view', 'separated']]) {
      const button = byId(id); button.classList.toggle('active', value === view); button.setAttribute('aria-pressed', String(value === view));
    }
    render();
  }
  if (apiBase) { refreshServices(); window.setInterval(refreshServices, 5000); connect(); }
}
