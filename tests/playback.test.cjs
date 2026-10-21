const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const appRoot = fs.existsSync(path.join(__dirname, '../dist/index.html')) ? path.join(__dirname, '../dist') : path.join(__dirname, '..');
const playback = require(path.join(appRoot, 'playback.js'));

const legacy = playback.defaults.filter(source => source.added === 0).map(({ name, movie, tv }) => ({ name, movie, tv }));
const custom = { name: 'My server', movie: 'https://custom.example/movie/{id}', tv: '' };

test('old saved lists gain the new leaders, retain custom sources and intentional omissions', () => {
  const result = playback.migrateSources([legacy[1], custom]);
  assert.deepEqual(result.sources.slice(0, 3).map(source => source.id), ['cinesrc', 'moviesapi', 'vixsrc']);
  assert.equal(result.sources[3].id, '111movies');
  assert.deepEqual(result.sources[4], custom);
  assert.ok(result.removed.includes('videasy'));
  assert.equal(result.sources.filter(source => source.id === 'videasy').length, 0);
  assert.deepEqual(playback.migrateSources(result.sources, result), result);
});

test('current user order and deletions survive reloads, and malformed profiles recover', () => {
  const sources = [custom, playback.defaults[2], ...legacy];
  const result = playback.migrateSources(sources, { revision: playback.revision, removed: ['cinesrc', 'moviesapi'] });
  assert.deepEqual(result.sources[0], custom);
  assert.equal(result.sources[1].id, 'vixsrc');
  assert.equal(result.sources.some(source => source.id === 'cinesrc'), false);
  for (const saved of [null, {}, [], [null, 42, { name: 'broken' }]]) {
    assert.equal(playback.migrateSources(saved).sources[0].id, 'cinesrc');
  }
});

function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const until = now + ms;
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        timers.delete(entry[0]); now = entry[1].at; entry[1].fn();
      }
      now = until;
    }
  };
}

function fixture(host = 'cinesrc.st', config = {}) {
  const timer = clock(), failures = [], states = [];
  const frame = { contentWindow: {} };
  const monitor = playback.createMonitor({ ...timer, onFailure: reason => failures.push(reason), onState: state => states.push(state) });
  monitor.start({ url: `https://${host}/movie/123`, media: { id: 123 }, frame, timeout: 8000, autoSkip: true, ...config });
  function send(data, overrides = {}) { monitor.message({ source: frame.contentWindow, origin: `https://${host}`, data, ...overrides }); }
  function progress(time) { send({ type: 'cinesrc:timeupdate', currentTime: time, duration: 3600 }); }
  return { timer, failures, states, frame, monitor, send, progress };
}

test('a loaded iframe with no video still times out for an observable provider', () => {
  const f = fixture(); f.monitor.loaded(); f.timer.tick(8000);
  assert.equal(f.failures.length, 1);
  assert.equal(f.states.includes('playing'), false);
});

test('actual advancing media time replaces the startup deadline with stall detection', () => {
  const f = fixture(); f.monitor.loaded(); f.progress(0); f.progress(1);
  f.timer.tick(8000); assert.equal(f.failures.length, 0);
  f.progress(9); f.timer.tick(19000); assert.equal(f.failures.length, 0);
  f.timer.tick(1000); assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0], 'Playback stopped responding.');
});

test('pause and close cancel fallback; a new play without progress can still fail', () => {
  const f = fixture(); f.monitor.loaded(); f.progress(0); f.progress(1);
  f.send({ type: 'cinesrc:pause' }); f.timer.tick(60000);
  assert.equal(f.failures.length, 0);
  f.send({ type: 'cinesrc:play' }); f.monitor.stop(); f.timer.tick(60000);
  assert.equal(f.failures.length, 0);
  f.send({ type: 'cinesrc:error' }); assert.equal(f.failures.length, 0);
});

test('spoofed origins, old frames, events before navigation, and invalid payloads cannot confirm playback', () => {
  const f = fixture(); f.progress(0); f.progress(1); // before load: ignored
  f.monitor.loaded();
  for (const overrides of [{ origin: 'https://other.example' }, { source: {} }]) {
    f.send({ type: 'cinesrc:timeupdate', currentTime: 1 }, overrides);
    f.send({ type: 'cinesrc:timeupdate', currentTime: 2 }, overrides);
  }
  f.send('not json'); f.send(null); f.send({ type: 'cinesrc:timeupdate', currentTime: '2' });
  f.timer.tick(8000); assert.equal(f.failures.length, 1);
});

test('legacy players are not interrupted just because they lack playback events', () => {
  const f = fixture('custom.example'); f.monitor.loaded(); f.timer.tick(30000);
  assert.equal(f.failures.length, 0); assert.ok(f.states.includes('unverified'));
  const missing = fixture('custom.example'); missing.timer.tick(8000);
  assert.equal(missing.failures.length, 1);
});

test('timeout Off and auto-skip Off disable automatic deadlines', () => {
  for (const config of [{ timeout: 0 }, { autoSkip: false }]) {
    const f = fixture('cinesrc.st', config); f.monitor.loaded(); f.timer.tick(60000);
    assert.equal(f.failures.length, 0);
  }
});

test('MoviesAPI and VixSrc event formats are accepted only for the active media', () => {
  const movies = fixture('moviesapi.to'); movies.monitor.loaded();
  for (const currentTime of [0, 1]) movies.send({ source: 'moviesapi-player', event: 'timeupdate', currentTime });
  assert.ok(movies.states.includes('playing'));
  const vix = fixture('vixsrc.to'); vix.monitor.loaded();
  for (const currentTime of [0, 1]) vix.send({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', video_id: 999, currentTime } });
  assert.equal(vix.states.includes('playing'), false);
  for (const currentTime of [0, 1]) vix.send(JSON.stringify({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', video_id: 123, currentTime } }));
  assert.ok(vix.states.includes('playing'));
});

const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
function actualFunction(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`));
  assert.ok(match, name); return match[0];
}

test('real application migration also handles old cloud sync and exports the updated revision', async () => {
  const storage = new Map([['aether_v4_sources', JSON.stringify(legacy)], ['aether_v2_last_source', 'VidEasy']]);
  const context = vm.createContext({
    StreamPlayback: playback, DEFAULT_SOURCES: playback.defaults, SOURCES: [], currentSrc: 0, currentUser: { id: 'user' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    renderSourceSettings() {}, updateProfileButton() {}, syncToServer() {},
    supabaseClient: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { app_data: { sources: [...legacy, custom] } } }) }) }) }) }
  });
  vm.runInContext(['readSourceSetting', 'persistSourceCatalog', 'loadSources', 'getAppData', 'loadFromServer'].map(actualFunction).join('\n'), context);
  vm.runInContext('loadSources()', context);
  assert.equal(storage.has('aether_v2_last_source'), false);
  assert.equal(context.SOURCES[0].id, 'cinesrc');
  await vm.runInContext('loadFromServer()', context);
  assert.equal(context.SOURCES[0].id, 'cinesrc');
  assert.equal(context.SOURCES.at(-1).name, custom.name);
  assert.equal(vm.runInContext('getAppData().sources_revision', context), playback.revision);
});

test('real app preserves timeout Off and compiles every inline script', () => {
  const context = vm.createContext({ localStorage: { getItem: () => '0' } });
  vm.runInContext(actualFunction('getSkipTimeout'), context);
  assert.equal(vm.runInContext('getSkipTimeout()', context), 0);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});

test('real automatic fallback tries each source once, stops, and does not remember failures', () => {
  const visited = [], writes = [], notices = [];
  const button = {};
  const context = vm.createContext({
    SOURCES: playback.defaults.slice(0, 3), currentSrc: 0, triedPlaybackSources: new Set([0]),
    playbackMonitor: { stop() {} }, stopNextEpTracking() {}, renderPlayerPanel() {},
    localStorage: { setItem: (...args) => writes.push(args) },
    document: { getElementById: () => ({ style: {} }), querySelector: () => button },
    showPlaybackNotice: text => notices.push(text),
    loadEmbed() { visited.push(context.currentSrc); context.triedPlaybackSources.add(context.currentSrc); }
  });
  vm.runInContext(['tryNextPlaybackSource', 'switchSource'].map(actualFunction).join('\n'), context);
  for (let index = 0; index < 3; index++) vm.runInContext('tryNextPlaybackSource("failed")', context);
  assert.deepEqual(visited, [1, 2]);
  assert.equal(writes.length, 0);
  assert.match(notices[0], /No source started/);
  assert.equal(button.textContent, 'Try again');
});

test('renamed/custom endpoints are retained instead of being replaced by a same-name default', () => {
  const source = { ...custom, name: 'VidEasy' };
  const result = playback.migrateSources([source]);
  assert.deepEqual(result.sources.at(-1), source);
});
