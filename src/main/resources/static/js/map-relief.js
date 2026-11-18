export function countryRelief(geo, tiles) {
  const thickness = 7;
  const Relief = L.Layer.extend({
    onAdd(map) {
      this.map = map;
      this.canvas = L.DomUtil.create('canvas', 'network-country-relief');
      map.getPane('country').appendChild(this.canvas);
      this.render = this.render.bind(this);
      this.queue = this.queue.bind(this);
      map.on('move zoom viewreset resize', this.queue);
      tiles.on('tileload', this.queue);
      this.queue();
    },
    onRemove(map) {
      cancelAnimationFrame(this.frame);
      map.off('move zoom viewreset resize', this.queue);
      tiles.off('tileload', this.queue);
      this.canvas.remove();
    },
    queue() {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(this.render);
    },
    render() {
      const map = this.map, size = map.getSize();
      const scale = Math.min(devicePixelRatio || 1, 2);
      const canvas = this.canvas;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const pixelWidth = Math.round(size.x * scale), pixelHeight = Math.round(size.y * scale);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      }
      const context = canvas.getContext('2d');
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, size.x, size.y);
      const outline = new Path2D();
      const features = geo.type === 'FeatureCollection' ? geo.features : [geo];
      for (const feature of features) {
        const geometry = feature.geometry;
        const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
        for (const polygon of polygons) for (const ring of polygon) {
          ring.forEach(([lng, lat], i) => {
            const point = map.latLngToContainerPoint([lat, lng]);
            if (i) outline.lineTo(point.x, point.y);
            else outline.moveTo(point.x, point.y);
          });
          outline.closePath();
        }
      }
      context.save();
      context.translate(0, thickness + 3);
      context.shadowColor = '#1f3a3030';
      context.shadowBlur = 16;
      context.fillStyle = '#e4e9e6';
      context.fill(outline, 'evenodd');
      context.restore();
      for (let depth = thickness; depth >= 1; depth--) {
        context.save();
        context.translate(0, depth);
        const level = 1 - depth / thickness;
        context.fillStyle = `rgb(${200 + 22 * level}, ${206 + 22 * level}, ${203 + 22 * level})`;
        context.fill(outline, 'evenodd');
        context.restore();
      }
      context.save();
      context.clip(outline, 'evenodd');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.x, size.y);
      for (const tile of Object.values(tiles._tiles ?? {})) {
        if (!tile.loaded || !tile.current) continue;
        const { x, y, z } = tile.coords;
        const topLeft = map.latLngToContainerPoint(map.unproject([x * 256, y * 256], z));
        const bottomRight = map.latLngToContainerPoint(map.unproject([(x + 1) * 256, (y + 1) * 256], z));
        context.drawImage(tile.el, topLeft.x, topLeft.y, bottomRight.x - topLeft.x + .5, bottomRight.y - topLeft.y + .5);
      }
      context.fillStyle = '#ffffff8c';
      context.fillRect(0, 0, size.x, size.y);
      context.restore();
      context.strokeStyle = '#b6c3bd';
      context.lineWidth = 1.2;
      context.stroke(outline);
    }
  });
  return new Relief();
}
