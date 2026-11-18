const STREET_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SATELLITE_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';

export function streetTiles() {
  return L.tileLayer(STREET_TILES, { maxZoom: 19, keepBuffer: 2 });
}

export function satelliteTiles() {
  const SatelliteTiles = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      tile.onload = () => done(null, tile);
      tile.onerror = () => {
        if (tile.classList.contains('street-fallback-tile')) {
          done(new Error('Basemap tile unavailable'), tile);
          return;
        }
        tile.classList.add('street-fallback-tile');
        tile.src = L.Util.template(STREET_TILES, { x: coords.x, y: coords.y, z: coords.z });
      };
      tile.src = this.getTileUrl(coords);
      return tile;
    }
  });
  return new SatelliteTiles(SATELLITE_TILES, { className: 'overview-imagery', maxZoom: 12, keepBuffer: 2 });
}
