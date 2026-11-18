import { freightRoute, pointOnRoute } from './map-network.js';
import { satelliteTiles, streetTiles } from './map-tiles.js';
import { esc, VEHICLE_SVG } from './ui.js';

const MALAYSIA = [[.65, 99.1], [7.5, 119.2]];
const ROUTE_STROKE = '#1a1a1a';
const VAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2 17V6h13l4 4 3 3v4h-4M7 17h7M14 7v5h6M2 17h2"/><circle cx="5.5" cy="17.5" r="1.5"/><circle cx="16" cy="17.5" r="1.5"/></svg>';
const LORRY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2 16V5h12v11M14 9h4l4 4v3h-3M2 16h3m3 0h8M16 10v3h5"/><circle cx="6.5" cy="17" r="1.5"/><circle cx="17.5" cy="17" r="1.5"/></svg>';
const TRIP_ICONS = { VAN: VAN_ICON, LORRY: LORRY_ICON, TRAILER: LORRY_ICON, AIR_CARGO: VEHICLE_SVG.air };

export class DispatchMap {
  constructor(el, onHubSelect) {
    this.onHubSelect = onHubSelect;
    this.pins = new Map();
    this.map = L.map(el, { zoomControl: false, attributionControl: false, zoomSnap: .25, zoomDelta: .5, maxZoom: 12 });
    this.map.createPane('dispatch-boundary').style.zIndex = 190;
    this.routes = L.layerGroup().addTo(this.map);
    this.streets = streetTiles().addTo(this.map);
    this.reset();
    this.observer = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
    this.observer.observe(el);
    this.boundary = new AbortController();
    fetch('/geo/malaysia.json', { signal: this.boundary.signal })
      .then(response => response.ok ? response.json() : null)
      .then(geo => {
        if (!geo || this.boundary.signal.aborted) return;
        L.geoJSON(geo, {
          pane: 'dispatch-boundary',
          interactive: false,
          style: { color: '#aaa', opacity: .75, weight: 1, fillColor: '#f6f6f6', fillOpacity: .65 }
        }).addTo(this.map).bringToBack();
      }).catch(() => {});
  }

  setOrigins(items, selectedOrigin) {
    const origins = new Map();
    for (const { origin } of items) {
      const group = origins.get(origin.id) ?? { origin, count: 0 };
      group.count += 1;
      origins.set(origin.id, group);
    }
    for (const [id, pin] of this.pins) {
      if (origins.has(id)) continue;
      pin.marker.remove();
      this.pins.delete(id);
    }
    for (const [id, { origin, count }] of origins) {
      let current = this.pins.get(id);
      const selected = id === selectedOrigin;
      const label = `${origin.name} · ${count} outbound ${count === 1 ? 'result' : 'results'}`;
      if (current?.count === count && current.selected === selected) continue;
      if (!current) {
        const button = document.createElement('button');
        const badge = document.createElement('b');
        button.type = 'button';
        button.append(origin.code, badge);
        L.DomEvent.disableClickPropagation(button);
        button.addEventListener('click', () => this.onHubSelect(id));
        const icon = L.divIcon({ className: 'dispatch-pin', html: button, iconSize: [60, 29], iconAnchor: [30, 29] });
        const marker = L.marker([origin.lat, origin.lng], { icon, keyboard: false }).addTo(this.map);
        current = { marker, button, badge };
        this.pins.set(id, current);
      }
      current.count = count;
      current.selected = selected;
      current.badge.textContent = count;
      current.button.title = label;
      current.button.setAttribute('aria-label', label);
      current.marker.setZIndexOffset(selected ? 450 : 0);
      current.marker.getElement()?.classList.toggle('is-selected', selected);
    }
  }

  showRoute(item) {
    this.routes.clearLayers();
    this.tripMarker = null;
    this.points = item ? freightRoute(item.origin, item.destination, item.air ?? item.vehicleType === 'AIR_CARGO').points : [];
    if (!item) return;
    const dashed = item.air ?? item.vehicleType === 'AIR_CARGO';
    L.polyline(this.points, { color: '#fff', weight: 7, opacity: .94, interactive: false }).addTo(this.routes);
    L.polyline(this.points, { color: ROUTE_STROKE, weight: 3, opacity: .95, dashArray: dashed ? '5 6' : null, interactive: false }).addTo(this.routes);
    L.circleMarker([item.destination.lat, item.destination.lng], {
      radius: 5, color: ROUTE_STROKE, fillColor: '#fff', fillOpacity: 1, weight: 2
    }).bindTooltip(esc(item.destination.code), { className: 'dispatch-destination', permanent: true, direction: 'top', offset: [0, -6] }).addTo(this.routes);
    const symbol = item.status ? TRIP_ICONS[item.vehicleType] : null;
    if (symbol) {
      const label = `${item.vehicleTypeLabel} · ${item.plateNo}`;
      const icon = L.divIcon({
        className: 'dispatch-trip-pin',
        html: `<span role="img" aria-label="${esc(label)}">${symbol}</span>`,
        iconSize: [31, 31], iconAnchor: [15, 15]
      });
      this.tripMarker = L.marker(this.points[0], { icon, title: label, keyboard: false, zIndexOffset: 800 }).addTo(this.routes);
    }
  }

  setTripProgress(progress) {
    if (this.tripMarker) this.tripMarker.setLatLng(pointOnRoute(this.points, progress));
  }

  setBasemap(mode) {
    this.map.removeLayer(this.basemap ?? this.streets);
    this.basemap = mode === 'satellite' ? (this.satellite ??= satelliteTiles()) : this.streets;
    this.basemap.addTo(this.map);
  }

  focusRoute() {
    if (this.points?.length) {
      this.map.fitBounds(this.points, { padding: [45, 40], maxZoom: 8, animate: false });
    }
  }

  reset() {
    this.map.fitBounds(MALAYSIA, { padding: [28, 36], animate: false });
  }

  zoom(delta) {
    this.map.setZoom(this.map.getZoom() + delta);
  }

  destroy() {
    this.observer.disconnect();
    this.boundary.abort();
    this.map.remove();
  }
}
