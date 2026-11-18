export function freightTiles({ neutral = false } = {}) {
  const FreightTiles = L.TileLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, 256, 256);
        try {
          const pixels = context.getImageData(0, 0, 256, 256);
          const data = pixels.data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const light = (r + g + b) / 765;
            const water = b > r + 12 && g > r + 8;
            const vegetation = g > r + 5 && g > b + 8;
            let color;
            if (neutral) {
              const v = 250 - (1 - light) * 140;
              if (water) color = [218, 222, 222];
              else if (vegetation) color = [227, 229, 224];
              else color = [v, v, v - 2];
            } else if (water) {
              color = [226 + light * 8, 234 + light * 8, 240 + light * 8];
            } else if (vegetation) {
              color = [236 + light * 10, 242 + light * 10, 237 + light * 10];
            } else {
              const v = 250 - (1 - light) * 70;
              color = [v, v + 1, v];
            }
            data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
          }
          context.putImageData(pixels, 0, 0);
        } catch {
          canvas.style.filter = neutral ? 'grayscale(1) contrast(.82) brightness(1.08)' : 'grayscale(1) brightness(1.15) contrast(.75)';
        }
        done(null, canvas);
      };
      image.onerror = () => done(new Error('Map tile unavailable'), canvas);
      image.src = this.getTileUrl(coords);
      return canvas;
    }
  });
  return new FreightTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, keepBuffer: 2 });
}
