import { VEHICLE_SVG, esc, fmtHM, fmtKg, fmtNum } from './ui.js';
import { CORRIDORS, freightRoute, pointOnRoute } from './map-network.js';
import { satelliteTiles } from './map-tiles.js';
import { hubName } from './overview-labels.js';

const NATIONAL = [[.65, 99.1], [7.5, 119.2]];
const ROUTE_COLORS = { road: '#ebf4eb', busy: '#fff', air: '#d9e7ee' };
const ICONS = {
  hub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l8-6 8 6v10H4zM9 20v-7h6v7M2 10l10-8 10 8"/></svg>'
};

function pinIcon(kind, svg, size, selected = false) {
  return L.divIcon({
    className: `network-pin pin-${kind}${selected ? ' is-selected' : ''}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="network-pin-head">${svg}</span>`
  });
}

export class FreightMap {
  constructor(el, ctx, { onHubClick, getViewport } = {}) {
    this.el = el;
    this.ctx = ctx;
    this.onHubClick = onHubClick;
    this.getViewport = getViewport;
    this.trips = [];
    this.markers = new Map();
    this.destroyed = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.classList.add('freight-map', 'overview-map');
    el.innerHTML = '<div class="freight-map-canvas" aria-label="Malaysia freight map"></div>';
    this.map = L.map(el.querySelector('.freight-map-canvas'), {
      zoomSnap: .25, zoomDelta: .5, scrollWheelZoom: false, zoomControl: false,
      attributionControl: false, minZoom: 3.25, maxZoom: 12
    });
    this.map.createPane('country');
    this.map.getPane('country').style.zIndex = 250;
    this.map.createPane('network');
    this.map.getPane('network').style.zIndex = 350;
    const tiles = satelliteTiles().addTo(this.map);
    this.tileErrors = 0;
    tiles.on('tileerror', () => {
      if (++this.tileErrors === 4) this.showTileNotice();
    });
    tiles.on('tileload', () => { this.el.querySelector('.network-tile-notice')?.remove(); });
    this.baseLayer = L.layerGroup().addTo(this.map);
    this.flowLayer = L.layerGroup().addTo(this.map);
    this.hubLayer = L.layerGroup().addTo(this.map);
    this.tripLayer = L.layerGroup().addTo(this.map);
    this.drawBackbone();
    this.boundaryRequest = new AbortController();
    fetch('/geo/malaysia.json', { signal: this.boundaryRequest.signal }).then((r) => {
      if (!r.ok) throw new Error('boundary unavailable');
      return r.json();
    }).then((geo) => {
      if (this.destroyed) return;
      L.geoJSON(geo, {
        pane: 'country', interactive: false,
        style: { color: '#c2d0c6', opacity: .3, weight: .8, dashArray: '2 4', fillColor: '#537465', fillOpacity: .13 }
      }).addTo(this.baseLayer);
    }).catch((error) => { if (error.name !== 'AbortError' && !this.destroyed) console.warn('Map boundary:', error.message); });
    this.fitScene();
    this.frame = 0;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.resizeObserver = new ResizeObserver(() => {
      this.map.invalidateSize({ pan: false });
      if (!this.userMoved) this.fitScene();
    });
    this.resizeObserver.observe(el);
    this.map.on('dragstart zoomstart', (e) => { if (!this.fitting) this.userMoved = true; });
    this.map.on('zoomend', () => {
      this.setHubs(this.hubs ?? [], this.selectedHubId);
      this.setTrips(this.trips);
    });
  }

  drawBackbone() {
    for (const edge of CORRIDORS) {
      L.polyline(edge.points, { pane: 'network', color: '#a2b6a5', weight: 1, opacity: .52, interactive: false }).addTo(this.baseLayer);
    }
  }

  fitScene() {
    const viewport = this.getViewport?.();
    const insetX = this.el.clientWidth > 480 ? 28 : 14;
    const bottomInset = viewport ? Math.max(0, this.el.clientHeight - viewport.height) : 0;
    this.fitting = true;
    this.map.fitBounds(NATIONAL, {
      paddingTopLeft: [insetX, 28],
      paddingBottomRight: [insetX + (viewport?.rightInset ?? 0), 35 + bottomInset],
      animate: false
    });
    this.fitting = false;
  }

  setHubs(hubs, selectedHubId, { showPopup = false } = {}) {
    const keepPopup = selectedHubId === this.selectedHubId && this.selectedMarker?.isPopupOpen();
    this.hubs = hubs;
    this.selectedHubId = selectedHubId ?? null;
    this.selectedMarker = null;
    this.hubLayer.clearLayers();
    for (const h of hubs) {
      const selected = h.id === this.selectedHubId;
      const air = ['KUL', 'KCH', 'BKI'].includes(h.code);
      const size = (selected ? 30 : 24) * (this.map.getZoom() < 6.5 ? .8 : 1);
      const name = hubName(h);
      const icon = pinIcon('hub', air ? VEHICLE_SVG.air : ICONS.hub, size, selected);
      const marker = L.marker([h.lat, h.lng], { icon, zIndexOffset: selected ? 1500 : 300, keyboard: true, title: `${name} ${h.code}${this.onHubClick ? ' · Filter by origin' : ''}` });
      const left = ['PEN', 'IPH', 'KUL', 'AOR', 'MKZ'].includes(h.code);
      const permanent = selected || ['PEN', 'KUL', 'JHB', 'KCH', 'BKI'].includes(h.code);
      marker.bindTooltip(`<b>${esc(name)}</b><small>${esc(h.code)}</small>`, {
        permanent, direction: left ? 'left' : 'right', offset: [left ? -10 : 10, 0],
        className: `network-hub-label${selected ? ' selected' : ''}`
      });
      const counts = `Awaiting dispatch: ${fmtNum(h.pendingOutbound)}<br>Outbound: ${fmtNum(h.activeOutbound)}`;
      marker.bindPopup(`<b>${esc(h.code)} · ${esc(name)}</b><br>${counts}`, { className: 'network-popup', autoPan: false });
      marker.on('click', () => this.onHubClick?.(h));
      marker.addTo(this.hubLayer);
      if (selected) this.selectedMarker = marker;
    }
    if (showPopup || keepPopup) this.selectedMarker?.openPopup();
  }

  setFlows(lanes) {
    this.lanes = lanes ?? [];
    this.renderFlows();
  }

  renderFlows() {
    this.flowLayer.clearLayers();
    const roadCounts = new Map(), flights = new Map();
    for (const lane of this.lanes ?? []) {
      const origin = this.ctx.hubsById.get(lane.originId), destination = this.ctx.hubsById.get(lane.destinationId);
      if (!origin || !destination) continue;
      const route = freightRoute(origin, destination);
      if (route.air) continue;
      if (!route.edges.length) {
        const weight = (11 + Math.min(5, Math.sqrt(lane.count))) * .15;
        this.drawRoute(route.points, 'road', weight, `${esc(origin.code)} → ${esc(destination.code)} · ${fmtNum(lane.count)} shipments`);
      }
      for (const key of route.edges) {
        const item = roadCounts.get(key) ?? { count: 0, lanes: [] };
        item.count += lane.count;
        item.lanes.push({ lane, origin, destination });
        roadCounts.set(key, item);
      }
    }
    const peak = Math.max(1, ...[...roadCounts.values()].map((v) => v.count));
    for (const edge of CORRIDORS) {
      const item = roadCounts.get(edge.key);
      if (!item) continue;
      const busy = item.count >= peak * .7 && item.count >= 4;
      const headline = busy ? 'High-volume corridor' : 'Road corridor';
      const tip = `<b>${headline}</b><br>${fmtNum(item.count)} shipments along this corridor<br>`
        + item.lanes.slice(0, 4).map(({ origin, destination, lane }) => `${esc(origin.code)} → ${esc(destination.code)} · ${fmtNum(lane.count)} shipments`).join('<br>');
      const weight = (12 + 6 * Math.sqrt(item.count / peak)) * .15;
      this.drawRoute(edge.points, busy ? 'busy' : 'road', weight, tip);
    }
    for (const trip of this.trips) {
      if (trip.vehicleType !== 'AIR_CARGO') continue;
      const key = `${trip.origin.id}-${trip.destination.id}`;
      const item = flights.get(key) ?? { origin: trip.origin, destination: trip.destination, count: 0, weightKg: 0, vehicles: 0 };
      item.count += trip.shipmentCount;
      item.weightKg += trip.loadKg;
      item.vehicles++;
      flights.set(key, item);
    }
    for (const { origin, destination, count, weightKg, vehicles } of flights.values()) {
      const route = freightRoute(origin, destination, true);
      const tip = `<b>${esc(hubName(origin))} → ${esc(hubName(destination))}</b><br>Air route · ${vehicles} flights · ${fmtNum(count)} shipments · ${fmtKg(weightKg)}`;
      this.drawRoute(route.points, 'air', 1.8, tip);
    }
  }

  drawRoute(points, kind, weight, tooltip) {
    const air = kind === 'air';
    L.polyline(points, {
      pane: 'network', className: `network-${kind}-trace`, color: ROUTE_COLORS[kind],
      dashArray: air ? '2 6' : null, weight, opacity: air ? .82 : .96,
      lineCap: 'round', lineJoin: 'round'
    }).bindTooltip(tooltip, { sticky: true, className: 'network-tooltip' }).addTo(this.flowLayer);
  }

  setTrips(trips) {
    this.trips = trips ?? [];
    const keep = new Set(this.trips.map((t) => t.id));
    for (const [id, marker] of this.markers) {
      if (!keep.has(id)) { this.tripLayer.removeLayer(marker); this.markers.delete(id); }
    }
    for (const trip of this.trips) {
      const air = trip.vehicleType === 'AIR_CARGO';
      const kind = trip.delayReason ? 'busy' : trip.status === 'LOADING' ? 'loading' : air ? 'air' : 'vehicle';
      const size = (air ? 26 : 23) * (this.map.getZoom() < 6.5 ? .75 : 1);
      const icon = pinIcon(kind, air ? VEHICLE_SVG.air : VEHICLE_SVG.road, size);
      let marker = this.markers.get(trip.id);
      if (!marker) {
        marker = L.marker([trip.origin.lat, trip.origin.lng], { icon, zIndexOffset: 900, title: `${trip.code} · ${trip.plateNo}` }).addTo(this.tripLayer);
        marker.bindTooltip('', { direction: 'top', offset: [0, -size / 2], className: 'network-tooltip' });
        this.markers.set(trip.id, marker);
      } else marker.setIcon(icon);
      marker.trip = trip;
      marker.route = freightRoute(trip.origin, trip.destination, air);
    }
    this.updatePositions(true);
    this.renderFlows();
  }

  focusTrip(trip) {
    this.userMoved = true;
    const marker = this.markers.get(trip.id);
    const location = marker?.getLatLng() ?? [trip.destination.lat, trip.destination.lng];
    const viewport = this.getViewport?.();
    if (viewport) {
      const offset = L.point(viewport.rightInset, this.map.getSize().y - viewport.height).divideBy(2);
      this.map.panTo(this.map.unproject(this.map.project(location).add(offset)), { animate: false });
    } else {
      this.map.panTo(location, { animate: false });
    }
    marker?.openTooltip();
  }

  updatePositions(withTooltips) {
    const now = this.ctx.simNow();
    for (const marker of this.markers.values()) {
      const t = marker.trip, depart = Date.parse(t.departAt), arrive = Date.parse(t.arriveAt);
      const progress = t.status === 'LOADING' || now <= depart ? 0 : Math.max(0, Math.min(1, (now - depart) / Math.max(1, arrive - depart)));
      marker.setLatLng(pointOnRoute(marker.route.points, progress));
      if (withTooltips) {
        marker.setTooltipContent(`<b>${esc(t.code)}</b> · ${esc(t.plateNo)}<br>${esc(t.origin.code)} → ${esc(t.destination.code)}<br>`
          + (t.status === 'LOADING' ? `Loading · ETD ${fmtHM(t.departAt)}` : `${Math.round(progress * 100)}% complete · ETA ${fmtHM(t.arriveAt)}`)
          + (t.delayReason ? '<br><span class="network-delay">Delayed</span>' : ''));
      }
    }
  }

  showTileNotice() {
    if (this.el.querySelector('.network-tile-notice')) return;
    const notice = document.createElement('div');
    notice.className = 'network-tile-notice';
    notice.textContent = 'Basemap unavailable. Routes remain visible.';
    this.el.appendChild(notice);
  }

  loop(ts) {
    this.raf = requestAnimationFrame(this.loop);
    if (ts - this.frame < (this.reducedMotion ? 1000 : 80)) return;
    this.updatePositions(Math.floor(ts / 1000) !== Math.floor(this.frame / 1000));
    this.frame = ts;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.boundaryRequest.abort();
    this.resizeObserver.disconnect();
    this.map.remove();
  }
}
