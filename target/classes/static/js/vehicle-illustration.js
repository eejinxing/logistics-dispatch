import { esc } from './ui.js';

const positions = { VAN: 'van', LORRY: 'lorry', TRAILER: 'trailer', AIR_CARGO: 'air' };

export function vehicleIllustration(type, label) {
  const position = positions[type];
  return position ? `<span class="vehicle-illustration is-${position}" role="img" aria-label="${esc(label)}"></span>` : '';
}
