export const MAX_EVENTS = 500;
export const LEVELS = new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'UNKNOWN']);
export const DEFAULT_LEVELS = new Set(['INFO', 'WARN', 'ERROR']);

export function createLogState(capacity = MAX_EVENTS) {
  return { capacity, events: [], paused: false, pausedCount: 0, droppedCount: 0, frozenEvents: null, expandedEventKeys: new Set() };
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

export function parseInitialView(search = '') {
  return new URLSearchParams(search).get('view') === 'separated' ? 'separated' : 'combined';
}

export function parseInitialServices(search = '', services = []) {
  const available = new Set(services.map(service => service.name));
  const requested = (new URLSearchParams(search).get('services') ?? '')
    .split(',').map(name => name.trim()).filter(Boolean);
  const selected = new Set(requested.filter(name => available.has(name)));
  return selected.size ? selected : new Set(available);
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
  const retainedKeys = new Set(state.events.map(item => item._key).filter(key => key !== undefined));
  for (const key of state.expandedEventKeys) {
    if (!retainedKeys.has(key)) state.expandedEventKeys.delete(key);
  }
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
  state.expandedEventKeys.clear();
  if (state.paused) state.frozenEvents = [];
}

export function displayedEvents(state) {
  return state.paused ? state.frozenEvents : state.events;
}

export function restoreScroll(element, savedTop, autoScroll) {
  element.scrollTop = autoScroll ? element.scrollHeight : (savedTop ?? element.scrollTop);
}

export function filterEvents(events, selectedSources, levels = DEFAULT_LEVELS, search = '') {
  const query = search.trim().toLowerCase();
  const selectedLevels = levels instanceof Set ? levels : levels === 'ALL' ? null : new Set([levels]);
  return events.filter(event => selectedSources.has(event.source) &&
    (!selectedLevels || selectedLevels.has(event.level)) &&
    (!query || event.message.toLowerCase().includes(query)));
}

export function hasStructuredFields(fields) {
  return fields !== null && typeof fields === 'object' && Object.keys(fields).length > 0;
}

export function formatStructuredFields(fields) {
  return JSON.stringify(fields, null, 2);
}

export function toggleExpandedEvent(state, key) {
  if (state.expandedEventKeys.has(key)) {
    state.expandedEventKeys.delete(key);
    return false;
  }
  state.expandedEventKeys.add(key);
  return true;
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

export function emptyStateCopy({ servicesLoaded, serviceLoadError, serviceCount, displayedCount, visibleCount, connection }) {
  if (!servicesLoaded) {
    return serviceLoadError
      ? { title: 'Services unavailable', message: 'Could not load configured services. LogLens will retry shortly.' }
      : { title: 'Loading services', message: 'Fetching configured sources from LogStreamer.' };
  }
  if (serviceCount === 0) return { title: 'No configured services', message: 'Add a source in LogStreamer configuration to start viewing logs.' };
  if (displayedCount > 0 && visibleCount === 0) return { title: 'No matching events', message: 'Adjust the service, level, or message search filters.' };
  if (connection === 'Reconnecting') return { title: 'Reconnecting to LogStreamer', message: 'The stream was interrupted. LogStreamer will reconnect automatically.' };
  if (connection === 'Closed') return { title: 'Log stream closed', message: 'The stream has closed. Reload LogLens to start a new connection.' };
  if (connection === 'Connecting') return { title: 'Connecting to LogStreamer', message: 'New log events will appear here when the stream connects.' };
  return { title: 'Waiting for log events', message: 'Connected to LogStreamer. Waiting for new log events.' };
}

const byId = id => document.getElementById(id);

if (typeof document !== 'undefined') {
  const apiBase = (() => {
    try { return validateApiBaseUrl(window.LOG_LENS_CONFIG?.apiBaseUrl); }
    catch (error) { showNotice(error.message, true); return null; }
  })();
  const serviceFilterContainer = byId('service-filter-container');
  const serviceFilterToggle = byId('service-filter-toggle');
  const serviceFilterMenu = byId('service-filter-menu');
  const serviceFilterSummary = byId('service-filter-summary');
  const levelFilters = [...document.querySelectorAll('[name="level-filter"]')];
  const levelFilterContainer = byId('level-filter-container');
  const levelFilterToggle = byId('level-filter-toggle');
  const levelFilterMenu = byId('level-filter-menu');
  const levelFilterSummary = byId('level-filter-summary');
  const logView = byId('log-view');
  const emptyState = byId('empty-state');
  const state = { ...createLogState(), services: [], servicesLoaded: false, serviceLoadError: false, initialSelectionApplied: false, selected: null, view: parseInitialView(window.location.search), levels: new Set(DEFAULT_LEVELS), search: '', autoScroll: true, connection: 'Connecting', eventSource: null, nextOrder: 0, nextEventKey: 0, scrollPositions: new Map() };

  function showNotice(message, error = false) {
    const notice = byId('notice'); notice.textContent = message; notice.hidden = false;
    notice.classList.toggle('error', error);
  }
  function setConnection(label, detail = '') {
    state.connection = label;
    byId('connection-status').textContent = label;
    byId('connection-detail').textContent = detail;
    byId('connection-dot').className = `connection-dot ${label.toLowerCase()}`;
    updateEmptyState();
  }
  function announceStatus(message) {
    byId('status-announcer').textContent = message;
  }
  function selectedServiceValues() {
    return new Set([...serviceFilterMenu.querySelectorAll('input[name="service-filter"]')]
      .filter(input => input.checked).map(input => input.value));
  }
  function updateServiceFilterSummary() {
    const selectedCount = state.selected?.size ?? 0;
    serviceFilterSummary.textContent = state.services.length > 0 && selectedCount === state.services.length
      ? 'All services'
      : selectedCount === 0 ? 'No services' : `${selectedCount} selected`;
  }
  function renderServiceOptions() {
    serviceFilterMenu.replaceChildren();
    for (const service of state.services) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'service-filter';
      checkbox.value = service.name;
      checkbox.checked = state.selected.has(service.name);
      const name = document.createElement('span');
      name.className = 'service-option-name';
      name.textContent = service.name;
      const status = document.createElement('span');
      status.className = 'service-option-state';
      status.textContent = service.state;
      label.append(checkbox, name, status);
      serviceFilterMenu.append(label);
    }
    updateServiceFilterSummary();
  }
  function updateServiceOptions(services) {
    state.selected = state.initialSelectionApplied
      ? preserveSelection(state.selected, services)
      : parseInitialServices(window.location.search, services);
    state.initialSelectionApplied = true;
    state.services = services;
    renderServiceOptions();
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
      const services = await fetchServices(apiBase);
      state.servicesLoaded = true;
      state.serviceLoadError = false;
      updateServiceOptions(services);
      byId('notice').hidden = true;
    } catch (error) {
      if (!state.servicesLoaded) state.serviceLoadError = true;
      showNotice(`Could not load services. ${error.message} Retrying shortly.`, true);
      updateEmptyState();
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
    row.append(meta, message);
    if (hasStructuredFields(event.fields)) {
      const detailsID = `event-fields-${event._key}`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'fields-toggle';
      toggle.setAttribute('aria-controls', detailsID);
      const details = document.createElement('pre');
      details.id = detailsID;
      details.className = 'fields-details';
      const expanded = state.expandedEventKeys.has(event._key);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Hide fields' : 'Show fields';
      toggle.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} structured fields for ${event.source} event`);
      details.hidden = !expanded;
      if (expanded) details.textContent = formatStructuredFields(event.fields);
      toggle.addEventListener('click', () => {
        const open = toggleExpandedEvent(state, event._key);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide fields' : 'Show fields';
        toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} structured fields for ${event.source} event`);
        details.hidden = !open;
        details.textContent = open ? formatStructuredFields(event.fields) : '';
      });
      row.append(toggle, details);
    }
    return row;
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
    if (state.view === 'combined') {
      restoreScroll(logView, state.scrollPositions.get('combined:outer'), state.autoScroll);
      return;
    }
    restoreScroll(logView, state.scrollPositions.get('separated:outer'), false);
    for (const panel of logView.querySelectorAll('.service-panel')) {
      const events = panel.querySelector('.panel-events');
      restoreScroll(events, state.scrollPositions.get(`separated:${panel.dataset.source}`), state.autoScroll);
    }
  }
  function updateEmptyState() {
    if (!emptyState) return;
    const displayed = displayedEvents(state);
    const selected = state.selected ?? new Set(state.services.map(s => s.name));
    const visibleCount = filterEvents(displayed, selected, state.levels, state.search).length;
    const copy = emptyStateCopy({
      servicesLoaded: state.servicesLoaded, serviceLoadError: state.serviceLoadError,
      serviceCount: state.services.length, displayedCount: displayed.length,
      visibleCount, connection: state.connection
    });
    emptyState.hidden = visibleCount > 0;
    byId('empty-title').textContent = copy.title;
    byId('empty-message').textContent = copy.message;
  }
  function render() {
    if (!logView) return;
    if (!state.autoScroll) rememberScrollPositions();
    const selected = state.selected ?? new Set(state.services.map(s => s.name));
    const displayed = displayedEvents(state);
    const visible = filterEvents(displayed, selected, state.levels, state.search);
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
    updateEmptyState();
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
      const result = receiveEvent(state, { ...event, _order: order, _key: state.nextEventKey++ });
      if (result.overflow && state.droppedCount === 1) announceStatus('The log buffer is full. Older events are being dropped.');
      if (result.shouldRender) render();
      else updateControls();
    };
  }

  serviceFilterToggle.addEventListener('click', () => {
    const isOpen = serviceFilterToggle.getAttribute('aria-expanded') === 'true';
    serviceFilterToggle.setAttribute('aria-expanded', String(!isOpen));
    serviceFilterMenu.hidden = isOpen;
  });
  serviceFilterMenu.addEventListener('change', event => {
    if (!event.target.matches('input[name="service-filter"]')) return;
    state.selected = selectedServiceValues();
    updateServiceFilterSummary();
    render();
  });
  function updateLevelFilterSummary() {
    const count = state.levels.size;
    levelFilterSummary.textContent = count === LEVELS.size ? 'All levels' : count === 0 ? 'No levels' : `${count} selected`;
  }
  levelFilterToggle.addEventListener('click', () => {
    const isOpen = levelFilterToggle.getAttribute('aria-expanded') === 'true';
    levelFilterToggle.setAttribute('aria-expanded', String(!isOpen));
    levelFilterMenu.hidden = isOpen;
  });
  for (const levelFilter of levelFilters) {
    levelFilter.addEventListener('change', () => {
      state.levels = new Set(levelFilters.filter(input => input.checked).map(input => input.value));
      updateLevelFilterSummary();
      render();
    });
  }
  document.addEventListener('click', event => {
    if (!serviceFilterContainer.contains(event.target)) {
      serviceFilterMenu.hidden = true;
      serviceFilterToggle.setAttribute('aria-expanded', 'false');
    }
    if (!levelFilterContainer.contains(event.target)) {
      levelFilterMenu.hidden = true;
      levelFilterToggle.setAttribute('aria-expanded', 'false');
    }
  });
  serviceFilterContainer.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      serviceFilterMenu.hidden = true;
      serviceFilterToggle.setAttribute('aria-expanded', 'false');
      serviceFilterToggle.focus();
    }
  });
  levelFilterContainer.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      levelFilterMenu.hidden = true;
      levelFilterToggle.setAttribute('aria-expanded', 'false');
      levelFilterToggle.focus();
    }
  });
  byId('message-search').addEventListener('input', event => { state.search = event.currentTarget.value; render(); });
  byId('combined-view').addEventListener('click', () => setView('combined'));
  byId('separated-view').addEventListener('click', () => setView('separated'));
  byId('pause-toggle').addEventListener('click', () => {
    setPaused(state, !state.paused);
    announceStatus(state.paused ? 'Log display paused. New events are still being received.' : 'Log display resumed.');
    updateControls();
    if (!state.paused) render();
  });
  byId('clear-logs').addEventListener('click', () => {
    clearEvents(state);
    announceStatus('Log display cleared. New events are still being received.');
    render();
  });
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
  setView(state.view);
  if (apiBase) { refreshServices(); window.setInterval(refreshServices, 5000); connect(); }
}
