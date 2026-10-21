(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StreamPlayback = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Increase this when changing the managed catalog. Saved custom entries survive updates.
  const revision = 20261021;
  const defaults = [
    { id: 'cinesrc', name: 'CineSrc', added: revision, movie: 'https://cinesrc.st/embed/movie/{id}?autoplay=true&autonext=false', tv: 'https://cinesrc.st/embed/tv/{id}?s={s}&e={e}&autoplay=true&autonext=false' },
    { id: 'moviesapi', name: 'MoviesAPI', added: revision, movie: 'https://moviesapi.to/movie/{id}', tv: 'https://moviesapi.to/tv/{id}/{s}/{e}' },
    { id: 'vixsrc', name: 'VixSrc', added: revision, movie: 'https://vixsrc.to/movie/{id}?lang=en&autoplay=true', tv: 'https://vixsrc.to/tv/{id}/{s}/{e}?lang=en&autoplay=true' },
    { id: 'videasy', name: 'VidEasy', added: 0, movie: 'https://player.videasy.net/movie/{id}?autoplay=1', tv: 'https://player.videasy.net/tv/{id}/{s}/{e}?autoplay=1' },
    { id: '111movies', name: '111Movies', added: 0, movie: 'https://111movies.net/movie/{id}?autoplay=1', tv: 'https://111movies.net/tv/{id}/{s}/{e}?autoplay=1' },
    { id: 'vidcore', name: 'VidCore', added: 0, movie: 'https://www.vidcore.org/embed/movie/{id}', tv: 'https://www.vidcore.org/embed/tv/{id}/{s}/{e}' },
    { id: 'autoembed', name: 'AutoEmbed', added: 0, movie: 'https://autoembed.co/movie/tmdb/{id}', tv: 'https://autoembed.co/tv/tmdb/{id}-{s}-{e}' },
    { id: '2embed-cc', name: '2Embed.cc', added: 0, movie: 'https://www.2embed.cc/embed/{id}', tv: 'https://www.2embed.cc/embedtv/{id}&s={s}&e={e}' },
    { id: '2embed-skin', name: '2Embed.Skin', added: 0, movie: 'https://www.2embed.skin/embed/{id}', tv: 'https://www.2embed.skin/embedtv/{id}&s={s}&e={e}' },
    { id: 'multiembed', name: 'MultiEmbed', added: 0, movie: 'https://multiembed.mov/?video_id={id}&tmdb=1', tv: 'https://multiembed.mov/?video_id={id}&tmdb=1&s={s}&e={e}' },
    { id: 'vidsrc-wtf', name: 'VidSrc WTF', added: 0, movie: 'https://www.vidsrc.wtf/api/3/movie/?id={id}', tv: 'https://vidsrc.wtf/api/3/tv/?id={id}&s={s}&e={e}' }
  ];

  function validSource(value) {
    if (!value || typeof value.name !== 'string' || !value.name.trim()) return false;
    return ['movie', 'tv'].some(key => typeof value[key] === 'string' && /^https?:\/\//i.test(value[key]));
  }

  function managedSource(source) {
    return defaults.find(item => item.id === source.id ||
      (item.name === source.name && item.movie === source.movie && item.tv === source.tv));
  }

  function migrateSources(saved, options = {}) {
    const previous = Number(options.revision) || 0;
    const removed = new Set(Array.isArray(options.removed) ? options.removed.filter(id => typeof id === 'string') : []);
    if (!Array.isArray(saved) || saved.length === 0) {
      return { revision, removed: [], sources: defaults.map(item => ({ ...item })) };
    }
    const seen = new Set();
    const sources = [];
    for (const source of saved) {
      if (!validSource(source)) continue;
      const managed = managedSource(source);
      const next = managed ? { ...managed } : { name: source.name.trim(),
        movie: typeof source.movie === 'string' && /^https?:\/\//i.test(source.movie) ? source.movie : '',
        tv: typeof source.tv === 'string' && /^https?:\/\//i.test(source.tv) ? source.tv : '' };
      const identity = managed ? managed.id : JSON.stringify([next.movie, next.tv]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      // A restored entry takes precedence over an old deletion marker.
      if (managed) removed.delete(managed.id);
      sources.push(next);
    }
    if (!sources.length) return { revision, removed: [], sources: defaults.map(item => ({ ...item })) };
    // Existing omissions are intentional; only genuinely new catalog entries are added.
    for (const item of defaults) {
      if (!seen.has(item.id) && item.added <= previous) removed.add(item.id);
    }
    const additions = defaults.filter(item => item.added > previous && !seen.has(item.id) && !removed.has(item.id));
    return { revision, removed: [...removed], sources: [...additions.map(item => ({ ...item })), ...sources] };
  }

  function providerFor(url) {
    try {
      const hostname = new URL(url).hostname;
      if (hostname === 'cinesrc.st') return 'cinesrc';
      if (hostname === 'moviesapi.to') return 'moviesapi';
      if (hostname === 'vixsrc.to') return 'vixsrc';
    } catch (_) {}
    return null;
  }

  function decodeEvent(provider, value, media) {
    let data = value;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { return null; }
    }
    if (!data || typeof data !== 'object') return null;
    if (provider === 'cinesrc' && typeof data.type === 'string' && data.type.startsWith('cinesrc:')) {
      return { type: data.type.slice(8), time: data.currentTime, duration: data.duration };
    }
    if (provider === 'moviesapi' && data.source === 'moviesapi-player') {
      return { type: data.event, time: data.currentTime, duration: data.duration };
    }
    if (provider === 'vixsrc' && data.type === 'PLAYER_EVENT' && data.data && typeof data.data === 'object') {
      if (data.data.video_id != null && String(data.data.video_id) !== String(media.id)) return null;
      return { type: data.data.event, time: data.data.currentTime, duration: data.data.duration };
    }
    return null;
  }

  // The iframe load event only confirms a document, never a playable stream.
  // Callers replace the iframe for each attempt so stale same-origin messages cannot win a race.
  function createMonitor(options) {
    const schedule = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    let active = null;
    let timer = null;
    const clear = () => { if (timer !== null) cancel(timer); timer = null; };
    function stop() { clear(); active = null; }
    function arm(delay) {
      clear();
      if (!active || !active.autoSkip || active.timeout <= 0) return;
      const attempt = active;
      timer = schedule(() => {
        if (active !== attempt) return;
        timer = null;
        if (!attempt.provider && attempt.loaded) {
          options.onState('unverified', 'If the video does not start, try the next source.');
          return;
        }
        active = null;
        options.onFailure(attempt.confirmed ? 'Playback stopped responding.' : 'No playback detected.');
      }, delay);
    }
    function start(config) {
      stop();
      active = { ...config, provider: providerFor(config.url), origin: new URL(config.url).origin,
        loaded: false, confirmed: false, paused: false, lastTime: null };
      arm(config.timeout);
    }
    function loaded() {
      if (!active || active.loaded) return;
      active.loaded = true;
      options.onState('ready', 'Press Play if the video does not start automatically.');
      // Give viewers a full startup interval after the document becomes interactive.
      arm(active.timeout);
    }
    function error() {
      if (!active) return;
      clear();
      active = null;
      options.onFailure('This source could not load.');
    }
    function message(event) {
      if (!active || !active.loaded || event.source !== active.frame.contentWindow || event.origin !== active.origin) return;
      const data = decodeEvent(active.provider, event.data, active.media);
      if (!data) return;
      if (data.type === 'error') { error(); return; }
      if (data.type === 'pause' || data.type === 'ended') {
        active.paused = true;
        clear();
        options.onState(data.type === 'pause' ? 'paused' : 'ended', '');
        return;
      }
      if (data.type === 'play') {
        active.paused = false;
        arm(active.confirmed ? Math.max(20000, active.timeout) : active.timeout);
      }
      if (data.type !== 'timeupdate' || typeof data.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) return;
      if (active.paused) return;
      const previous = active.lastTime;
      active.lastTime = data.time;
      if (previous !== null && data.time > previous + 0.05) {
        active.confirmed = true;
        options.onState('playing', '');
        if (options.onProgress) options.onProgress(data);
        arm(Math.max(20000, active.timeout));
      }
    }
    return { start, loaded, error, message, stop };
  }

  return { revision, defaults, migrateSources, providerFor, decodeEvent, createMonitor };
});
