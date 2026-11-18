import { freightRoute, pointOnRoute } from './map-network.js';
import { satelliteTiles, streetTiles } from './map-tiles.js';
import { esc } from './ui.js';

const MALAYSIA = [[.65, 99.1], [7.5, 119.2]];

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
      const current = this.pins.get(id);
      const selected = id === selectedOrigin;
      const label = `${origin.name} · ${count} outbound ${count === 1 ? 'result' : 'results'}`;
      if (current?.count === count && current.selected === selected) continue;
      const icon = L.divIcon({
        className: `dispatch-pin${selected ? ' is-selected' : ''}`,
        html: `<span>${esc(origin.code)} <b>${count}</b></span>`,
        iconSize: [60, 29], iconAnchor: [30, 29]
      });
      const marker = current?.marker ?? L.marker([origin.lat, origin.lng], { title: label })
        .on('click', () => this.onHubSelect(origin.id)).addTo(this.map);
      marker.options.title = label;
      marker.setIcon(icon).setZIndexOffset(selected ? 450 : 0);
      marker.getElement()?.setAttribute('aria-label', label);
      this.pins.set(id, { marker, count, selected });
    }
  }

  showRoute(item) {
    this.routes.clearLayers();
    this.tripMarker = null;
    this.points = item ? freightRoute(item.origin, item.destination, item.air ?? item.vehicleType === 'AIR_CARGO').points : [];
    if (!item) return;
    const dashed = item.air ?? item.vehicleType === 'AIR_CARGO';
    L.polyline(this.points, { color: '#fff', weight: 7, opacity: .94, interactive: false }).addTo(this.routes);
    L.polyline(this.points, { color: '#1a1a1a', weight: 3, opacity: .95, dashArray: dashed ? '5 6' : null, interactive: false }).addTo(this.routes);
    L.circleMarker([item.destination.lat, item.destination.lng], {
      radius: 6, color: '#181818', fillColor: '#fff', fillOpacity: 1, weight: 2
    }).bindTooltip(esc(item.destination.code), { className: 'dispatch-destination', permanent: true, direction: 'top', offset: [0, -6] }).addTo(this.routes);
    if (item.status) {
      this.tripMarker = L.circleMarker(this.points[0], {
        radius: 5, color: '#fff', fillColor: '#151515', fillOpacity: 1, weight: 2, interactive: false
      }).addTo(this.routes);
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
