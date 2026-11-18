import { VEHICLE_SVG, esc, fmtHM, fmtKg, fmtNum } from './ui.js';
import { CORRIDORS, freightRoute, pointOnRoute } from './map-network.js';
import { freightTiles } from './map-tiles.js';
import { countryRelief } from './map-relief.js';
import { hubName } from './overview-labels.js';

const NATIONAL = [[.65, 99.1], [7.5, 119.2]];
const COLORS = { road: '#3dbb68', busy: '#e5484d', air: '#2f97dc', hub: '#7c6cf0', vehicle: '#2f8cf0', loading: '#e0a030' };
const OVERVIEW_ROUTES = { road: '#299e60', busy: '#0e7547', air: '#487364' };
const CHEVRON = '<span class="network-chevron-inner"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 8.2 6 4.4l3.5 3.8"/></svg></span>';
const ARROW_SPACING = 30;
const ARROW_SPEED = 26;
const ICONS = {
  hub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l8-6 8 6v10H4zM9 20v-7h6v7M2 10l10-8 10 8"/></svg>'
};

function pinIcon(kind, svg, size, { selected = false, flat = false } = {}) {
  return L.divIcon({
    className: `network-pin pin-${kind}${selected ? ' is-selected' : ''}`,
    iconSize: [size, flat ? size : size + 7],
    iconAnchor: [size / 2, flat ? size / 2 : size + 5],
    html: `<span class="network-pin-head" style="--pin-color:${COLORS[kind]}">${svg}</span>${flat ? '' : '<span class="network-pin-stem"></span>'}`
  });
}

export class FreightMap {
  constructor(el, ctx, { onHubClick, overview = false, getViewport } = {}) {
    this.el = el;
    this.ctx = ctx;
    this.onHubClick = onHubClick;
    this.overview = overview;
    this.getViewport = getViewport;
    this.trips = [];
    this.markers = new Map();
    this.destroyed = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.classList.add('freight-map', overview ? 'overview-map' : 'is-perspective');
    el.innerHTML = '<div class="freight-map-canvas" aria-label="Malaysia freight map"></div>';
    if (!overview) {
      el.insertAdjacentHTML('beforeend', `<div class="network-info">
        <button type="button" class="network-info-toggle" aria-label="Map legend" aria-expanded="false">i</button>
        <div class="network-legend network-info-panel" aria-label="Map legend" hidden>
          <span><i class="legend-pin" style="--swatch:${COLORS.hub}"></i>Freight hubs</span>
          <span><i class="legend-pin" style="--swatch:${COLORS.vehicle}"></i>Vehicles in transit</span>
          <span><i class="legend-pin" style="--swatch:${COLORS.loading}"></i>Loading</span>
          <span><i class="legend-line" style="--swatch:${COLORS.road}"></i>Road corridors</span>
          <span><i class="legend-line" style="--swatch:${COLORS.busy}"></i>High-volume corridors</span>
          <span><i class="legend-line" style="--swatch:${COLORS.air}"></i>Air routes</span>
          <small class="network-credit">Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></small>
        </div>
      </div>`);
      this.bindControls();
    }
    this.map = L.map(el.querySelector('.freight-map-canvas'), { zoomSnap: .25, zoomDelta: overview ? .5 : 1, scrollWheelZoom: false, zoomControl: false, attributionControl: false, minZoom: overview ? 3.25 : 4, maxZoom: 12 });
    this.map.createPane('country');
    this.map.getPane('country').style.zIndex = 250;
    this.map.createPane('network');
    this.map.getPane('network').style.zIndex = 350;
    this.map.createPane('networkLabels');
    this.map.getPane('networkLabels').style.zIndex = 450;
    this.map.createPane('networkArrows');
    this.map.getPane('networkArrows').style.zIndex = 380;
    this.tiles = freightTiles({ neutral: overview }).addTo(this.map);
    this.tileErrors = 0;
    this.tiles.on('tileerror', () => {
      if (++this.tileErrors === 4) this.showTileNotice();
    });
    this.tiles.on('tileload', () => { this.el.querySelector('.network-tile-notice')?.remove(); });
    this.baseLayer = L.layerGroup().addTo(this.map);
    this.flowLayer = L.layerGroup().addTo(this.map);
    this.labelLayer = L.layerGroup().addTo(this.map);
    this.hubLayer = L.layerGroup().addTo(this.map);
    this.tripLayer = L.layerGroup().addTo(this.map);
    this.arrowLayer = L.layerGroup().addTo(this.map);
    this.arrowTracks = [];
    this.started = performance.now();
    if (!overview) this.addGrid();
    this.drawBackbone();
    this.boundaryRequest = new AbortController();
    fetch('/geo/malaysia.json', { signal: this.boundaryRequest.signal }).then((r) => {
      if (!r.ok) throw new Error('boundary unavailable');
      return r.json();
    }).then((geo) => {
      if (this.destroyed) return;
      if (overview) {
        L.geoJSON(geo, { pane: 'country', interactive: false, style: { color: '#9aaba1', opacity: .46, weight: 1, fillOpacity: .025 } }).addTo(this.baseLayer);
      } else {
        countryRelief(geo, this.tiles).addTo(this.baseLayer);
      }
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

  addGrid() {
    const style = { color: '#8fa39c', weight: .6, opacity: this.overview ? .12 : .18, dashArray: '2 9', interactive: false };
    for (let lng = 96; lng <= 123; lng += 2) L.polyline([[-5, lng], [13, lng]], style).addTo(this.baseLayer);
    for (let lat = -4; lat <= 12; lat += 2) L.polyline([[lat, 94], [lat, 126]], style).addTo(this.baseLayer);
    const label = '<span>South China Sea</span>';
    L.marker([5.8, 108.4], { interactive: false, icon: L.divIcon({ className: 'network-sea-label', iconSize: [180, 34], html: label }) }).addTo(this.baseLayer);
  }

  drawBackbone() {
    for (const edge of CORRIDORS) {
      if (this.overview) {
        L.polyline(edge.points, { pane: 'network', color: '#648674', weight: 1.5, opacity: .46, interactive: false }).addTo(this.baseLayer);
        continue;
      }
      L.polyline(edge.points, { pane: 'network', className: 'network-route-side', color: '#c9d6cf', weight: 11, interactive: false }).addTo(this.baseLayer);
      L.polyline(edge.points, { pane: 'network', className: 'network-road-base', color: '#dde8e2', weight: 8, interactive: false }).addTo(this.baseLayer);
    }
    if (this.overview) return;
    for (const i of [1, 2, 5, 6, 8, 10]) {
      const edge = CORRIDORS[i];
      L.marker(edge.label, { pane: 'networkLabels', interactive: false, icon: L.divIcon({ className: 'network-road-label', html: `<span>${esc(edge.name)}</span>`, iconSize: [120, 22], iconAnchor: [-9, 10] }) }).addTo(this.labelLayer);
    }
  }

  bindControls() {
    const button = this.el.querySelector('.network-info-toggle');
    const panel = this.el.querySelector('.network-info-panel');
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  fitScene() {
    const viewport = this.getViewport?.();
    const insetX = this.el.clientWidth > 480 ? 28 : 14;
    const bottomInset = viewport ? Math.max(0, this.el.clientHeight - viewport.height) : 0;
    this.fitting = true;
    this.map.fitBounds(NATIONAL, {
      paddingTopLeft: this.overview ? [insetX, 28] : [70, 28],
      paddingBottomRight: this.overview ? [insetX + (viewport?.rightInset ?? 0), 35 + bottomInset] : [50, 44],
      animate: false
    });
    this.fitting = false;
  }

  setHubs(hubs, selectedHubId, { showPopup = false } = {}) {
    const keepPopup = this.overview && selectedHubId === this.selectedHubId && this.selectedMarker?.isPopupOpen();
    this.hubs = hubs;
    this.selectedHubId = selectedHubId ?? null;
    this.selectedMarker = null;
    this.hubLayer.clearLayers();
    for (const h of hubs) {
      const selected = h.id === this.selectedHubId;
      const air = ['KUL', 'KCH', 'BKI'].includes(h.code);
      const size = (selected ? 30 : 24) * (this.map.getZoom() < 6.5 ? .8 : 1);
      const name = this.overview ? hubName(h) : h.name;
      const icon = pinIcon('hub', air ? VEHICLE_SVG.air : ICONS.hub, size, { selected, flat: this.overview });
      const marker = L.marker([h.lat, h.lng], { icon, zIndexOffset: selected ? 1500 : 300, keyboard: true, title: `${name} ${h.code}${this.onHubClick ? ' · Filter by origin' : ''}` });
      const left = ['PEN', 'IPH', 'KUL', 'AOR', 'MKZ'].includes(h.code);
      const permanent = !this.overview || selected || ['PEN', 'KUL', 'JHB', 'KCH', 'BKI'].includes(h.code);
      marker.bindTooltip(`<b>${esc(name)}</b><small>${esc(h.code)}</small>`, { permanent, direction: left ? 'left' : 'right', offset: [left ? -10 : 10, this.overview ? 0 : -19], className: `network-hub-label${selected ? ' selected' : ''}` });
      const counts = this.overview
        ? `Awaiting dispatch: ${fmtNum(h.pendingOutbound)}<br>Outbound: ${fmtNum(h.activeOutbound)}`
        : `Awaiting dispatch ${fmtNum(h.pendingOutbound)} shipments<br>Outbound in transit ${fmtNum(h.activeOutbound)} shipments`;
      marker.bindPopup(`<b>${esc(h.code)} · ${esc(name)}</b><br>${counts}`, { className: 'network-popup', closeButton: this.overview, autoPan: !this.overview });
      marker.on('click', () => this.onHubClick?.(h));
      marker.addTo(this.hubLayer);
      if (selected) this.selectedMarker = marker;
    }
    if (this.overview && (showPopup || keepPopup)) this.selectedMarker?.openPopup();
  }

  setFlows(lanes) {
    this.lanes = lanes ?? [];
    this.renderFlows();
  }

  renderFlows() {
    this.flowLayer.clearLayers();
    this.arrowLayer.clearLayers();
    this.arrowTracks = [];
    const roadCounts = new Map(), flights = new Map();
    for (const lane of this.lanes ?? []) {
      const origin = this.ctx.hubsById.get(lane.originId), destination = this.ctx.hubsById.get(lane.destinationId);
      if (!origin || !destination) continue;
      const route = freightRoute(origin, destination);
      const entry = { lane, origin, destination, route };
      if (route.air) continue;
      if (!route.edges.length) this.drawRoute(route.points, lane.count, false, `${esc(origin.code)} → ${esc(destination.code)} · ${fmtNum(lane.count)} shipments`);
      for (const key of route.edges) {
        const item = roadCounts.get(key) ?? { count: 0, netDirection: 0, lanes: [] };
        item.count += lane.count;
        item.netDirection += route.reversedEdges?.includes(key) ? -lane.count : lane.count;
        item.lanes.push(entry);
        roadCounts.set(key, item);
      }
    }
    const peak = Math.max(1, ...[...roadCounts.values()].map((v) => v.count));
    for (const edge of CORRIDORS) {
      const item = roadCounts.get(edge.key);
      if (!item) continue;
      const busy = item.count >= peak * .7 && item.count >= 4;
      const headline = this.overview ? (busy ? 'High-volume corridor' : 'Road corridor') : edge.name;
      const tip = `<b>${esc(headline)}</b><br>${fmtNum(item.count)} ${this.overview ? 'shipments along this corridor' : 'shipments on this segment'}<br>`
        + item.lanes.slice(0, 4).map(({ origin, destination, lane }) => `${esc(origin.code)} → ${esc(destination.code)} · ${fmtNum(lane.count)} shipments`).join('<br>');
      this.drawRoute(item.netDirection < 0 ? [...edge.points].reverse() : edge.points, 12 + 6 * Math.sqrt(item.count / peak), busy, tip, true);
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
      const tip = this.overview
        ? `<b>${esc(hubName(origin))} → ${esc(hubName(destination))}</b><br>Air route · ${vehicles} flights · ${fmtNum(count)} shipments · ${fmtKg(weightKg)}`
        : `<b>${esc(origin.name)} → ${esc(destination.name)}</b><br>Active air route · ${vehicles} aircraft · ${fmtNum(count)} shipments · ${fmtKg(weightKg)}`;
      this.drawRibbon(route.points, 'air', this.overview ? 16 : 14, tip);
    }
  }

  drawRoute(points, amount, busy, tooltip, isWeight = false) {
    const weight = isWeight ? amount : 11 + Math.min(5, Math.sqrt(amount));
    this.drawRibbon(points, busy ? 'busy' : 'road', weight, tooltip);
  }

  drawRibbon(points, kind, weight, tooltip) {
    if (this.overview) {
      const stroke = kind === 'air' ? 2.25 : weight * .23;
      L.polyline(points, { pane: 'network', color: '#fff', weight: stroke + 2.6, opacity: .9, interactive: false }).addTo(this.flowLayer);
      L.polyline(points, {
        pane: 'network', className: `network-${kind}-trace`, color: OVERVIEW_ROUTES[kind],
        dashArray: kind === 'air' ? '5 6' : null, weight: stroke, opacity: .95, lineCap: 'round'
      }).bindTooltip(tooltip, { sticky: true, className: 'network-tooltip' }).addTo(this.flowLayer);
      return;
    }
    const sides = { road: '#2a8a4e', busy: '#b73539', air: '#1d6fa6' };
    L.polyline(points, { pane: 'network', className: 'network-route-side', color: sides[kind], weight: weight + 3, opacity: 1, interactive: false }).addTo(this.flowLayer);
    L.polyline(points, { pane: 'network', className: `network-${kind}-glow`, color: COLORS[kind], weight, opacity: 1, lineCap: 'round', lineJoin: 'round' })
      .bindTooltip(tooltip, { sticky: true, className: 'network-tooltip' }).addTo(this.flowLayer);
    this.addArrows(points, weight);
  }

  addArrows(points, weight) {
    const zoom = this.map.getZoom();
    const px = points.map((p) => this.map.project(p, zoom));
    const cum = [0];
    for (let i = 1; i < px.length; i++) cum.push(cum[i - 1] + px[i].distanceTo(px[i - 1]));
    const total = cum[cum.length - 1];
    const size = Math.round(Math.max(8, Math.min(13, weight * .72)));
    const inset = size * .65;
    const usable = total - 2 * inset;
    if (usable < size) return;
    const count = Math.max(1, Math.floor(usable / ARROW_SPACING));
    const markers = [];
    for (let k = 0; k < count; k++) {
      markers.push(L.marker(points[0], {
        pane: 'networkArrows', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'network-chevron', iconSize: [size, size], html: CHEVRON })
      }).addTo(this.arrowLayer));
    }
    const track = { px, cum, inset, usable, zoom, markers };
    this.arrowTracks.push(track);
    this.placeArrows(track, this.arrowPhase());
  }

  arrowPhase() {
    return this.reducedMotion ? 0 : ((performance.now() - this.started) / 1000) * ARROW_SPEED;
  }

  placeArrows(track, phase) {
    const { px, cum, inset, usable, zoom, markers } = track;
    markers.forEach((marker, k) => {
      const d = inset + ((k + .5) * usable / markers.length + phase) % usable;
      let seg = 0;
      while (seg < px.length - 2 && cum[seg + 1] < d) seg++;
      const a = px[seg], b = px[seg + 1];
      const len = cum[seg + 1] - cum[seg] || 1;
      const t = (d - cum[seg]) / len;
      marker.setLatLng(this.map.unproject(L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), zoom));
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90;
      const inner = marker.getElement()?.firstElementChild;
      if (inner) inner.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    });
  }

  setTrips(trips) {
    this.trips = trips ?? [];
    const keep = new Set(this.trips.map((t) => t.id));
    for (const [id, marker] of this.markers) {
      if (!keep.has(id)) { this.tripLayer.removeLayer(marker); this.markers.delete(id); }
    }
    for (const trip of this.trips) {
      if (!keep.has(trip.id)) continue;
      const air = trip.vehicleType === 'AIR_CARGO';
      const kind = trip.delayReason ? 'busy' : trip.status === 'LOADING' ? 'loading' : air ? 'air' : 'vehicle';
      const size = (air ? 26 : 23) * (this.map.getZoom() < 6.5 ? .75 : 1);
      const icon = pinIcon(kind, air ? VEHICLE_SVG.air : VEHICLE_SVG.road, size, { flat: this.overview });
      let marker = this.markers.get(trip.id);
      if (!marker) {
        marker = L.marker([trip.origin.lat, trip.origin.lng], { icon, zIndexOffset: 900, title: `${trip.code} · ${trip.plateNo}` }).addTo(this.tripLayer);
        marker.bindTooltip('', { direction: 'top', offset: [0, this.overview ? -size / 2 : -30], className: 'network-tooltip' });
        this.markers.set(trip.id, marker);
      } else marker.setIcon(icon);
      marker.trip = trip;
      marker.route = freightRoute(trip.origin, trip.destination, air);
    }
    this.updatePositions(true);
    this.renderFlows();
  }

  focusTrip(trip) {
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
      if (withTooltips && this.overview) {
        marker.setTooltipContent(`<b>${esc(t.code)}</b> · ${esc(t.plateNo)}<br>${esc(t.origin.code)} → ${esc(t.destination.code)}<br>`
          + (t.status === 'LOADING' ? `Loading · ETD ${fmtHM(t.departAt)}` : `${Math.round(progress * 100)}% complete · ETA ${fmtHM(t.arriveAt)}`)
          + (t.delayReason ? '<br><span class="network-delay">Delayed</span>' : ''));
        continue;
      }
      if (withTooltips) marker.setTooltipContent(`<b>${esc(t.code)}</b> · ${esc(t.plateNo)} (${esc(t.vehicleTypeLabel)})<br>`
        + `${esc(t.origin.code)} → ${esc(t.destination.code)} · ${t.relocation ? 'Empty relocation' : `${fmtNum(t.shipmentCount)} shipments · ${fmtKg(t.loadKg)}`}<br>`
        + (t.status === 'LOADING' ? `Loading · ETD ${fmtHM(t.departAt)}` : `${Math.round(progress * 100)}% complete · ETA ${fmtHM(t.arriveAt)}`)
        + (t.delayReason ? `<br><span class="network-delay">Delay: ${esc(t.delayReason)}</span>` : ''));
    }
  }

  showTileNotice() {
    if (this.el.querySelector('.network-tile-notice')) return;
    const notice = document.createElement('div');
    notice.className = 'network-tile-notice';
    notice.textContent = this.overview ? 'Basemap unavailable. Routes remain visible.' : 'Map tiles are temporarily unavailable · Freight routes are available';
    this.el.appendChild(notice);
  }

  loop(ts) {
    this.raf = requestAnimationFrame(this.loop);
    if (ts - this.frame < (this.reducedMotion ? 1000 : 80)) return;
    this.updatePositions(Math.floor(ts / 1000) !== Math.floor(this.frame / 1000));
    if (!this.reducedMotion && !this.map._animatingZoom) {
      const phase = this.arrowPhase();
      for (const track of this.arrowTracks) this.placeArrows(track, phase);
    }
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
