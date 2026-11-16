import * as THREE from 'three'

// Scene scale: 1 unit = 10 mm. The belt (900 mm) is drawn as an elliptical loop, 100 mm tall,
// standing on the display floor (y = 0). +z faces the default camera ("front").
export const RX = 16
export const RZ = 12
export const BELT_H = 10

// Radial offsets (units) of each belt layer from the base ellipse, inner strap outwards.
// Order outermost -> base strap matches LAYERS in specs.js.
export const BAND = {
  strap: [0, 0.18],
  inner: [0.18, 0.3],
  felt: [0.3, 0.55],
  sensor: 0.62,          // probe axis (6 mm probe sits between felt and pad)
  pad: [0.92, 1.07],
  cotton: [1.07, 1.19],
  outer: [1.19, 1.33],
}

export function ellipsePoint(theta, d, y = 0) {
  return new THREE.Vector3((RX + d) * Math.cos(theta), y, (RZ + d) * Math.sin(theta))
}
export function ellipseNormal(theta) {
  return new THREE.Vector3(RZ * Math.cos(theta), 0, RX * Math.sin(theta)).normalize()
}
export function ellipseTangent(theta) {
  return new THREE.Vector3(-RX * Math.sin(theta), 0, RZ * Math.cos(theta)).normalize()
}

// A belt band between radial offsets dIn..dOut and heights y0..y1, either a full loop or an arc.
export function bandGeometry(dIn, dOut, y0, y1, th0 = 0, th1 = Math.PI * 2, segs = 160) {
  const full = Math.abs(th1 - th0 - Math.PI * 2) < 1e-6
  const shape = new THREE.Shape()
  const outer = []
  const inner = []
  const n = full ? segs : Math.max(8, Math.ceil(segs * (th1 - th0) / (Math.PI * 2)))
  for (let i = 0; i <= n; i++) {
    const th = th0 + (th1 - th0) * (i / n)
    outer.push(new THREE.Vector2((RX + dOut) * Math.cos(th), (RZ + dOut) * Math.sin(th)))
    inner.push(new THREE.Vector2((RX + dIn) * Math.cos(th), (RZ + dIn) * Math.sin(th)))
  }
  if (full) {
    shape.setFromPoints(outer.slice(0, -1))
    shape.holes.push(new THREE.Path(inner.slice(0, -1).reverse()))
  } else {
    shape.setFromPoints([...outer, ...inner.reverse()])
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 })
  // Shape (x, y) -> world (x, z); extrusion -> world height.
  g.rotateX(Math.PI / 2)
  g.translate(0, y1, 0)
  g.computeVertexNormals()
  return g
}

// Same as bandGeometry but re-centred so the part can pivot about its own centre.
export function centeredBand(...args) {
  const g = bandGeometry(...args)
  g.computeBoundingBox()
  const c = new THREE.Vector3()
  g.boundingBox.getCenter(c)
  g.translate(-c.x, -c.y, -c.z)
  return { geometry: g, center: c }
}

// Heating pad: 100 mm along the belt, 50 mm across, centred at the front of the belt.
export const PAD_SPAN = 10 / (RX + 1)               // radians for ~100 mm of arc
export const PAD_TH = [Math.PI / 2 - PAD_SPAN / 2, Math.PI / 2 + PAD_SPAN / 2]
export const PAD_Y = [2.5, 7.5]

// ---------- Fixed layout of the assembled system (world coordinates) ----------
const ENC_THETA = 0.35
const encN = ellipseNormal(ENC_THETA)
const encBase = ellipsePoint(ENC_THETA, BAND.outer[1], 5)
export const ENCLOSURE = {
  // outer shell 86 × 66 × 36 mm around the 80 × 60 × 30 mm internal space
  size: [8.6, 6.6, 3.6],
  pos: encBase.clone().add(encN.clone().multiplyScalar(2.05)),
  rotY: Math.atan2(encN.x, encN.z),
}
export const ENCLOSURE_MATRIX = new THREE.Matrix4().compose(
  ENCLOSURE.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ENCLOSURE.rotY, 0)), new THREE.Vector3(1, 1, 1))
export function encLocalToWorld(x, y, z) {
  return new THREE.Vector3(x, y, z).applyMatrix4(ENCLOSURE_MATRIX)
}

export const POWERBANK = { pos: new THREE.Vector3(28, 1.75, -3), rotY: 0 } // lies flat, ports face +z
export const POCKET = { pos: new THREE.Vector3(28, 0, -3.2) }

export const TENS_UNIT = { pos: new THREE.Vector3(-31, 5.2, -3), rotY: 0.18 }
export const ELECTRODES = [
  new THREE.Vector3(-36, 0.12, 6),
  new THREE.Vector3(-29.5, 0.12, 6),
  new THREE.Vector3(-36, 0.12, 13),
  new THREE.Vector3(-29.5, 0.12, 13),
]

// Sensor probe: lies along the belt behind the pad, lower half of the pad.
const SENSOR_THETA = Math.PI / 2 + 0.06
export const SENSOR = {
  pos: ellipsePoint(SENSOR_THETA, BAND.sensor, 3.7),
  quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ellipseTangent(SENSOR_THETA).negate()),
}
// End of the probe where its cable leaves (towards the right / pouch side)
export const SENSOR_TAIL = ellipsePoint(SENSOR_THETA - 0.1, BAND.sensor, 3.7)

// ---------- Conceptual cable routes (illustrative, not a wiring diagram) ----------
function curve(points) {
  return new THREE.CatmullRomCurve3(points, false, 'centripetal')
}

export const USB_PLUG_AT_BANK = new THREE.Vector3(27.7, 1.65, 5.55)
export const USB_PLUG_AT_ENCLOSURE = encLocalToWorld(2.6, -3.3, 0.4)
export const USB_CURVE = curve([
  new THREE.Vector3(27.7, 1.65, 7.3),
  new THREE.Vector3(27.6, 1.2, 9.6),
  new THREE.Vector3(24.5, 0.5, 10.6),
  encLocalToWorld(2.6, -4.6, 1.8),
  encLocalToWorld(2.6, -4.0, 0.6),
  USB_PLUG_AT_ENCLOSURE,
])

// Pad leads run inside the belt layers from the pad's right edge to the pouch.
function alongBelt(th0, th1, d, y, steps = 8) {
  const pts = []
  for (let i = 0; i <= steps; i++) pts.push(ellipsePoint(th0 + (th1 - th0) * (i / steps), d, y))
  return pts
}
export const PAD_LEAD_CURVE = curve([
  ...alongBelt(PAD_TH[0] + 0.02, ENC_THETA + 0.42, 1.12, 4.6),
  encLocalToWorld(-4.6, -1.6, -0.4),
  encLocalToWorld(-3.5, -1.6, -0.6),
])
export const SENSOR_LEAD_CURVE = curve([
  SENSOR_TAIL,
  ...alongBelt(SENSOR_THETA - 0.16, ENC_THETA + 0.42, BAND.sensor, 3.0).slice(1),
  encLocalToWorld(-4.6, 0.2, -0.4),
  encLocalToWorld(-3.4, 0.6, -0.6),
])

// TENS leads: two channels, each splitting to two pads. Kept entirely in the TENS zone.
const TENS_MATRIX = new THREE.Matrix4().compose(
  TENS_UNIT.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, TENS_UNIT.rotY, 0)), new THREE.Vector3(1, 1, 1))
export function tensLocalToWorld(x, y, z) {
  return new THREE.Vector3(x, y, z).applyMatrix4(TENS_MATRIX)
}
const jack1 = tensLocalToWorld(-1.4, 5.15, 0)
const jack2 = tensLocalToWorld(1.4, 5.15, 0)
function lead(jack, split, pad) {
  return curve([
    jack,
    jack.clone().add(new THREE.Vector3(0, 1.6, 0.4)),
    split,
    pad.clone().add(new THREE.Vector3(0, 1.2, -0.4)),
    pad.clone().add(new THREE.Vector3(0, 0.25, 0)),
  ])
}
const split1 = new THREE.Vector3(-35.5, 5, 2)
const split2 = new THREE.Vector3(-28, 5, 2.4)
export const TENS_LEADS = [
  { channel: 1, curve: lead(jack1, split1, ELECTRODES[0]) },
  { channel: 1, curve: lead(jack1, split1.clone().add(new THREE.Vector3(0.3, 0, 0.3)), ELECTRODES[2]) },
  { channel: 2, curve: lead(jack2, split2, ELECTRODES[1]) },
  { channel: 2, curve: lead(jack2, split2.clone().add(new THREE.Vector3(0.3, 0, 0.3)), ELECTRODES[3]) },
]

// ---------- Small canvas textures (generated locally, no network) ----------
const texCache = new Map()
export function canvasTexture(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texCache.set(key, t)
  return t
}

export function holeGridTexture(key, w, h, cols, rows, bg, hole, extra) {
  return canvasTexture(key, w, h, (ctx) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    if (extra) extra(ctx, w, h)
    ctx.fillStyle = hole
    const sx = w / cols
    const sy = h / rows
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        ctx.beginPath()
        ctx.arc(sx * (i + 0.5), sy * (j + 0.5), Math.min(sx, sy) * 0.22, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })
}

export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
export const clamp01 = (x) => Math.min(1, Math.max(0, x))
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
