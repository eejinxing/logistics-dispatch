import { get } from './api.js';

export function createClock() {
  const c = { nowMs: Date.now(), scale: 1, paused: false, at: performance.now() };
  return {
    now: () => (c.paused ? c.nowMs : c.nowMs + (performance.now() - c.at) * c.scale),
    set(s) {
      c.nowMs = Date.parse(s.now);
      c.scale = s.scale ?? s.timeScale ?? 1;
      c.paused = Boolean(s.paused);
      c.at = performance.now();
    },
    async sync() {
      try {
        this.set(await get('/api/public/clock'));
      } catch {
      }
    }
  };
}
