import test from 'node:test';
import assert from 'node:assert/strict';
import { CORRIDORS, freightRoute, pointOnRoute } from '../../main/resources/static/js/map-network.js';

const hub = (code, landmass = 'PENINSULAR') => {
  const edge = CORRIDORS.find((e) => e.from === code || e.to === code);
  const point = edge.from === code ? edge.points[0] : edge.points.at(-1);
  return { code, lat: point[0], lng: point[1], landmass };
};

test('Kuala Lumpur to Johor follows the connected southern road corridors', () => {
  const route = freightRoute(hub('KUL'), hub('JHB'));
  assert.equal(route.air, false);
  assert.deepEqual(route.edges, ['KUL-SRB', 'SRB-MKZ', 'MKZ-JHB']);
  assert.deepEqual(route.points[0], [3.139, 101.6869]);
  assert.deepEqual(route.points.at(-1), [1.4927, 103.7414]);
  assert.ok(route.points.some(([lat, lng]) => lat === 2.1896 && lng === 102.2501));
});

test('reverse road trips follow the same geometry in reverse', () => {
  const outgoing = freightRoute(hub('AOR'), hub('JHB'));
  const incoming = freightRoute(hub('JHB'), hub('AOR'));
  assert.deepEqual(incoming.points, [...outgoing.points].reverse());
  assert.deepEqual(incoming.edges, [...outgoing.edges].reverse());
});

test('cross-sea freight gets a continuous air route, not a land road', () => {
  const a = hub('KUL'), b = hub('KCH', 'BORNEO');
  const route = freightRoute(a, b);
  assert.equal(route.air, true);
  assert.deepEqual(route.edges, []);
  assert.deepEqual(pointOnRoute(route.points, 0), [a.lat, a.lng]);
  assert.deepEqual(pointOnRoute(route.points, 1), [b.lat, b.lng]);
  assert.ok(route.points.length > 2);
});

test('Borneo road vehicles follow the coastal corridor', () => {
  const route = freightRoute(hub('KCH', 'BORNEO'), hub('BKI', 'BORNEO'));
  assert.deepEqual(route.edges, ['KCH-BKI']);
  assert.ok(route.points.length > 10);
});

test('distance interpolation does not jump at vertices or overshoot endpoints', () => {
  const points = [[0, 0], [0, 1], [0, 4]];
  assert.deepEqual(pointOnRoute(points, .5), [0, 2]);
  assert.deepEqual(pointOnRoute(points, .25), [0, 1]);
  assert.deepEqual(pointOnRoute(points, -1), [0, 0]);
  assert.deepEqual(pointOnRoute(points, 2), [0, 4]);
  assert.deepEqual(pointOnRoute([[3, 100], [3, 100]], .5), [3, 100]);
});

test('edited and newly created hubs keep their actual coordinates', () => {
  const edited = { ...hub('KUL'), lat: 3.16, lng: 101.70 };
  const route = freightRoute(edited, hub('JHB'));
  assert.deepEqual(route.points[0], [3.16, 101.70]);
  const newHub = { code: 'NEW', lat: 3.21, lng: 102.1, landmass: 'PENINSULAR' };
  assert.deepEqual(freightRoute(newHub, edited).points, [[3.21, 102.1], [3.16, 101.70]]);
  assert.deepEqual(CORRIDORS.find((e) => e.from === 'KUL').points[0], [3.139, 101.6869]);
});
