import { VEHICLE_SVG, cssVar, esc } from './ui.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CURVE = 0.18;

export function arc(a, b, t) {
  const dLng = b[1] - a[1];
  const dLat = b[0] - a[0];
  const c = [(a[0] + b[0]) / 2 - dLng * CURVE, (a[1] + b[1]) / 2 + dLat * CURVE];
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

export { FreightMap } from './freight-map.js';

const PARCEL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10"/></svg>';

export class RouteMap {
  constructor(el, now) {
    this.now = now;
    this.map = L.map(el, { zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILE_URL, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 12
    }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    this.marker = null;
    this.leg = null;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize());
    this.resizeObserver.observe(el);
    this.map.setView([4.2, 108], 5);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.map.remove();
  }

  show(view) {
    this.layer.clearLayers();
    this.marker = null;
    const accent = cssVar('--accent');
    const muted = cssVar('--muted');
    const ring = cssVar('--surface');
    const ink = cssVar('--text');
    const route = view.route;
    const reached = Math.max(0, route.findIndex((h) => h.id === view.currentHub.id));
    const delivered = view.status === 'DELIVERED' || view.status === 'ARRIVED_HUB' || view.status === 'OUT_FOR_DELIVERY';
    for (let i = 0; i + 1 < route.length; i++) {
      const a = [route[i].lat, route[i].lng];
      const b = [route[i + 1].lat, route[i + 1].lng];
      const done = delivered || i < reached;
      const pts = Array.from({ length: 33 }, (_, k) => arc(a, b, k / 32));
      L.polyline(pts, { color: ring, weight: 7, opacity: 0.9, interactive: false }).addTo(this.layer);
      L.polyline(pts, { color: done ? accent : muted, weight: 4, opacity: done ? 0.95 : 0.7, dashArray: done ? null : '6 8' }).addTo(this.layer);
    }
    route.forEach((h, i) => {
      const end = i === 0 || i === route.length - 1;
      L.circleMarker([h.lat, h.lng], { radius: end ? 7 : 5, color: ring, weight: 2, fillColor: ink, fillOpacity: 1 })
        .bindTooltip(`${esc(h.code)} ${esc(h.name)}${i === 0 ? ' (Origin)' : i === route.length - 1 ? ' (Destination)' : ' (Transfer)'}`,
          { permanent: true, direction: 'right', offset: [8, 0], className: 'hub-label' })
        .addTo(this.layer);
    });
    this.leg = view.leg && view.leg.status !== 'ARRIVED' ? view.leg : null;
    const icon = (svg, extra = '') => L.divIcon({
      className: `vehicle-icon${extra}`, iconSize: [26, 26],
      html: `<div class="dot" style="width:26px;height:26px;background:${accent}">${svg}</div>`
    });
    const start = this.leg ? [this.leg.from.lat, this.leg.from.lng] : [view.currentHub.lat, view.currentHub.lng];
    const svg = this.leg ? (this.leg.vehicleType === 'AIR_CARGO' ? VEHICLE_SVG.air : VEHICLE_SVG.road) : PARCEL_SVG;
    this.marker = L.marker(start, { icon: icon(svg, this.leg && this.leg.status === 'LOADING' ? ' loading' : ''), zIndexOffset: 1000 })
      .addTo(this.layer);
    this.update();
    this.map.fitBounds(L.latLngBounds(route.map((h) => [h.lat, h.lng])).pad(0.35), { maxZoom: 8 });
  }

  update() {
    if (!this.marker || !this.leg) return;
    const depart = Date.parse(this.leg.departAt);
    const arrive = Date.parse(this.leg.arriveAt);
    const now = this.now();
    const p = this.leg.status === 'LOADING' || now < depart ? 0 : Math.min(1, (now - depart) / Math.max(1, arrive - depart));
    this.marker.setLatLng(arc([this.leg.from.lat, this.leg.from.lng], [this.leg.to.lat, this.leg.to.lng], p));
    this.progress = p;
  }

  loop(ts) {
    this.raf = requestAnimationFrame(this.loop);
    if (ts - (this.frame ?? 0) < 60) return;
    this.frame = ts;
    this.update();
  }
}
