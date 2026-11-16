import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Edges } from '@react-three/drei'
import {
  BAND, PAD_TH, PAD_Y, BELT_H, centeredBand, bandGeometry, ellipsePoint,
  canvasTexture, holeGridTexture,
} from './geometry'
import { LAYERS } from './specs'
import { useSim } from './simContext'

// Procedural hardware models. Units: 1 = 10 mm. Every model is centred on its own origin.
// Meshes flagged userData.noHighlight are indicator lights driven by the simulation, not by selection.

const NO_HL = { noHighlight: true }

// ---------- Small indicator light driven by simulated time ----------
export function Led({ on, color = '#ff3355', size = 0.09, blink = 0, ...props }) {
  const { timeRef, effects } = useSim()
  const mat = useRef()
  useFrame(() => {
    if (!mat.current) return
    const active = effects && on(timeRef.current)
    const pulse = blink ? 0.55 + 0.45 * Math.sin((timeRef.fx || 0) * blink * Math.PI * 2) : 1
    mat.current.emissiveIntensity = active ? 2.2 * pulse : 0.05
  })
  return (
    <mesh userData={NO_HL} {...props}>
      <sphereGeometry args={[size, 12, 12]} />
      <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.05} toneMapped={false} />
    </mesh>
  )
}

function textTexture(key, text, { w = 256, h = 64, bg = null, fg = '#e8e8ee', font = 'bold 30px Inter, Arial, sans-serif' } = {}) {
  return canvasTexture(key, w, h, (ctx) => {
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h) } else ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = fg
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2)
  })
}

// ---------- Belt layers (one band each) ----------
const BAND_STYLE = {
  outer: { color: '#efb3c9', opacity: 0.5, roughness: 0.9 },
  cotton: { color: '#fbefe3', opacity: 0.45, roughness: 0.95 },
  felt: { color: '#c7b4de', opacity: 1, roughness: 1 },
  inner: { color: '#fff7ee', opacity: 1, roughness: 0.95 },
  strap: { color: '#6a5f79', opacity: 1, roughness: 0.8 },
}

export function beltBand(id) {
  const [dIn, dOut] = BAND[id]
  return centeredBand(dIn, dOut, 0, BELT_H)
}

export function BeltLayer({ id }) {
  const { geometry } = useMemo(() => beltBand(id), [id])
  const s = BAND_STYLE[id]
  const extras = useMemo(() => {
    if (id === 'outer') {
      // Edge binding along the top and bottom of the outer fabric
      const c = beltBand('outer').center
      const top = bandGeometry(BAND.outer[1] - 0.02, BAND.outer[1] + 0.07, BELT_H - 0.3, BELT_H)
      const bot = bandGeometry(BAND.outer[1] - 0.02, BAND.outer[1] + 0.07, 0, 0.3)
      top.translate(-c.x, -c.y, -c.z)
      bot.translate(-c.x, -c.y, -c.z)
      return { top, bot }
    }
    if (id === 'strap') {
      // Velcro overlap flap at the back of the strap
      const c = beltBand('strap').center
      const flap = bandGeometry(BAND.outer[1] + 0.02, BAND.outer[1] + 0.22, 1, BELT_H - 1, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.25)
      flap.translate(-c.x, -c.y, -c.z)
      return { flap }
    }
    return null
  }, [id])
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={s.color} roughness={s.roughness} transparent={s.opacity < 1}
          opacity={s.opacity} depthWrite={s.opacity >= 1} side={THREE.DoubleSide} />
      </mesh>
      {extras?.top && (
        <>
          <mesh geometry={extras.top}><meshStandardMaterial color="#d66b95" roughness={0.7} /></mesh>
          <mesh geometry={extras.bot}><meshStandardMaterial color="#d66b95" roughness={0.7} /></mesh>
        </>
      )}
      {extras?.flap && (
        <mesh geometry={extras.flap}><meshStandardMaterial color="#5c5368" roughness={1} /></mesh>
      )}
    </group>
  )
}

// Whole belt (used in the isolated Component View)
export function BeltModel() {
  return (
    <group>
      {['strap', 'inner', 'felt', 'cotton', 'outer'].map(id => {
        const { center } = beltBand(id)
        return <group key={id} position={center}><BeltLayer id={id} /></group>
      })}
      <group position={padGeometry().center}><HeatingPadModel /></group>
    </group>
  )
}

// ---------- Heating pad ----------
let padCache = null
export function padGeometry() {
  if (!padCache) padCache = centeredBand(BAND.pad[0], BAND.pad[1], PAD_Y[0], PAD_Y[1], PAD_TH[0], PAD_TH[1], 400)
  return padCache
}

// Serpentine heating-wire trace on the outer face of the pad (world coordinates)
let traceCache = null
export function padTraceCurve(d = BAND.pad[1] + 0.012) {
  if (traceCache && d === BAND.pad[1] + 0.012) return traceCache
  const pts = []
  const runs = 7
  const m = 0.035
  const y0 = PAD_Y[0] + 0.45
  const y1 = PAD_Y[1] - 0.45
  for (let k = 0; k < runs; k++) {
    const th = PAD_TH[1] - m - (PAD_TH[1] - PAD_TH[0] - 2 * m) * (k / (runs - 1))
    const up = k % 2 === 0
    for (let s = 0; s <= 6; s++) {
      const y = up ? y0 + (y1 - y0) * (s / 6) : y1 - (y1 - y0) * (s / 6)
      const wobble = Math.sin(s * 1.3 + k) * 0.006
      pts.push(ellipsePoint(th + wobble, d, y))
    }
  }
  const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2)
  if (d === BAND.pad[1] + 0.012) traceCache = c
  return c
}

export function HeatingPadModel() {
  const { geometry, center } = padGeometry()
  const trace = useMemo(() => {
    const g = new THREE.TubeGeometry(padTraceCurve(), 400, 0.035, 6, false)
    g.translate(-center.x, -center.y, -center.z)
    return g
  }, [center])
  const tab = useMemo(() => ellipsePoint(PAD_TH[0] - 0.012, BAND.pad[1], 4.6).sub(center), [center])
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#d9532a" roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={trace}>
        <meshStandardMaterial color="#f29a6e" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={tab}>
        <boxGeometry args={[0.35, 0.6, 0.35]} />
        <meshStandardMaterial color="#b9411d" roughness={0.6} />
      </mesh>
    </group>
  )
}

// ---------- DS18B20 probe (6 mm × 30 mm), axis along +y ----------
export function SensorModel() {
  return (
    <group>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 2.3, 24]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, -1.15, 0]}>
        <cylinderGeometry args={[0.32, 0.27, 0.7, 20]} />
        <meshStandardMaterial color="#202024" roughness={0.6} />
      </mesh>
      <mesh position={[0, -1.6, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.4, 12]} />
        <meshStandardMaterial color="#2b2b30" roughness={0.7} />
      </mesh>
    </group>
  )
}

// ---------- ESP32 NodeMCU-32S (51 × 28 × 13 mm incl. header pins), board flat, +y up ----------
export function ESP32Model() {
  const pinMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d8c27a', metalness: 0.9, roughness: 0.3 }), [])
  const shieldTex = useMemo(() => textTexture('esp32-shield', 'ESP32-WROOM-32', { w: 256, h: 96, bg: '#c4c8ce', fg: '#4a4d55', font: 'bold 26px Inter, Arial' }), [])
  const pins = []
  for (let i = 0; i < 19; i++) {
    const x = -2.29 + i * 0.254
    pins.push([x, 1.27], [x, -1.27])
  }
  return (
    <group>
      {/* PCB */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[5.1, 0.16, 2.8]} />
        <meshStandardMaterial color="#1f2126" roughness={0.6} />
      </mesh>
      {/* Header strips + pins below the board */}
      {[1.27, -1.27].map(z => (
        <mesh key={z} position={[0, -0.18, z]}>
          <boxGeometry args={[4.9, 0.25, 0.25]} />
          <meshStandardMaterial color="#141416" roughness={0.8} />
        </mesh>
      ))}
      {pins.map(([x, z], i) => (
        <mesh key={i} position={[x, -0.42, z]} material={pinMat}>
          <boxGeometry args={[0.064, 0.46, 0.064]} />
        </mesh>
      ))}
      {/* WROOM module: PCB, RF shield and antenna area */}
      <mesh position={[0.95, 0.15, 0]}>
        <boxGeometry args={[2.55, 0.08, 1.8]} />
        <meshStandardMaterial color="#232a33" roughness={0.6} />
      </mesh>
      <mesh position={[0.6, 0.34, 0]}>
        <boxGeometry args={[1.75, 0.3, 1.6]} />
        <meshStandardMaterial color="#c4c8ce" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0.6, 0.495, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.6, 0.6]} />
        <meshStandardMaterial map={shieldTex} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[1.98, 0.2, 0]}>
        <boxGeometry args={[0.5, 0.02, 1.6]} />
        <meshStandardMaterial color="#b8962e" metalness={0.8} roughness={0.4} />
      </mesh>
      {/* Micro-USB port, buttons, regulator */}
      <mesh position={[-2.42, 0.25, 0]}>
        <boxGeometry args={[0.55, 0.28, 0.78]} />
        <meshStandardMaterial color="#d0d3d8" metalness={0.9} roughness={0.25} />
      </mesh>
      {[-0.75, 0.75].map(z => (
        <group key={z} position={[-1.85, 0.16, z]}>
          <mesh><boxGeometry args={[0.36, 0.14, 0.36]} /><meshStandardMaterial color="#d6d8dc" metalness={0.7} roughness={0.3} /></mesh>
          <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.1, 0.1, 0.08, 12]} /><meshStandardMaterial color="#222" /></mesh>
        </group>
      ))}
      <mesh position={[-1.1, 0.16, 0.2]}>
        <boxGeometry args={[0.4, 0.14, 0.3]} />
        <meshStandardMaterial color="#111" roughness={0.5} />
      </mesh>
      <Led on={t => t >= 23} color="#ff2d4a" position={[-1.3, 0.14, -0.9]} size={0.07} />
      <Led on={t => t >= 28.5} color="#4da3ff" position={[-1.05, 0.14, -0.9]} size={0.07} blink={1.5} />
    </group>
  )
}

// ---------- IRLZ44N, TO-220 (10 × 16 × 4.5 mm body + tab), standing, legs down ----------
export function MosfetModel() {
  const tex = useMemo(() => textTexture('irlz44n', 'IRLZ44N', { w: 128, h: 48, bg: '#17171a', fg: '#cfcfd6', font: 'bold 22px Inter, Arial' }), [])
  return (
    <group>
      <mesh position={[0, -0.34, 0]}>
        <boxGeometry args={[1.0, 0.92, 0.45]} />
        <meshStandardMaterial color="#17171a" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.34, 0.226]}>
        <planeGeometry args={[0.85, 0.3]} />
        <meshStandardMaterial map={tex} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.46, -0.16]}>
        <boxGeometry args={[1.0, 0.68, 0.13]} />
        <meshStandardMaterial color="#cfd3d9" metalness={0.95} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.5, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.15, 20]} />
        <meshStandardMaterial color="#5a5a62" />
      </mesh>
      {[-0.254, 0, 0.254].map(x => (
        <mesh key={x} position={[x, -1.3, 0]}>
          <boxGeometry args={[0.08, 1.0, 0.04]} />
          <meshStandardMaterial color="#d7d9de" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

// ---------- Axial resistor, lying along x ----------
function Resistor({ bands, ...props }) {
  return (
    <group {...props}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.11, 0.11, 0.62, 16]} />
        <meshStandardMaterial color="#d9c49b" roughness={0.6} />
      </mesh>
      {bands.map((c, i) => (
        <mesh key={i} position={[-0.2 + i * 0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.115, 0.115, 0.05, 16]} />
          <meshStandardMaterial color={c} roughness={0.5} />
        </mesh>
      ))}
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[s * 0.45, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.022, 0.022, 0.3, 6]} />
            <meshStandardMaterial color="#cfd2d8" metalness={0.9} roughness={0.3} />
          </mesh>
          <mesh position={[s * 0.6, -0.2, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.4, 6]} />
            <meshStandardMaterial color="#cfd2d8" metalness={0.9} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
// Generic colour bands only; real values are not represented.
export function ResistorsModel() {
  return (
    <group>
      <Resistor position={[0, 0, -0.45]} bands={['#7a4a1f', '#111', '#d12a2a', '#c9a227']} />
      <Resistor position={[0, 0, 0]} bands={['#e3c64a', '#7a2bc4', '#d12a2a', '#c9a227']} />
      <Resistor position={[0, 0, 0.45]} bands={['#7a4a1f', '#111', '#e47a19', '#c9a227']} />
    </group>
  )
}

// ---------- 2-way PCB screw terminal ----------
export function TerminalModel() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[1.0, 1.0, 0.8]} />
        <meshStandardMaterial color="#2e9e57" roughness={0.55} />
      </mesh>
      {[-0.25, 0.25].map(x => (
        <group key={x}>
          <mesh position={[x, 0.51, -0.05]}>
            <cylinderGeometry args={[0.17, 0.17, 0.05, 20]} />
            <meshStandardMaterial color="#cfd3d9" metalness={0.9} roughness={0.25} />
          </mesh>
          <mesh position={[x, 0.54, -0.05]}>
            <boxGeometry args={[0.28, 0.02, 0.05]} />
            <meshStandardMaterial color="#555" />
          </mesh>
          <mesh position={[x, 0.05, 0.41]}>
            <boxGeometry args={[0.3, 0.3, 0.02]} />
            <meshStandardMaterial color="#173d25" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ---------- Thermal fuse (axial) ----------
export function FuseModel() {
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.9, 20]} />
        <meshStandardMaterial color="#b9bec6" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[-0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.2, 0.2, 20]} />
        <meshStandardMaterial color="#e9e4d6" roughness={0.7} />
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.85, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.7, 6]} />
          <meshStandardMaterial color="#cfd2d8" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

// ---------- Perfboard 50 × 70 × 2 mm, flat ----------
export function PerfboardModel() {
  const tex = useMemo(() => holeGridTexture('perf', 512, 366, 27, 19, '#c99a5b', '#3d2a14', (ctx, w, h) => {
    ctx.fillStyle = '#d7aa69'
    ctx.fillRect(4, 4, w - 8, h - 8)
  }), [])
  return (
    <group>
      <mesh>
        <boxGeometry args={[7, 0.2, 5]} />
        <meshStandardMaterial color="#c08f52" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.101, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6.96, 4.96]} />
        <meshStandardMaterial map={tex} roughness={0.7} />
      </mesh>
    </group>
  )
}

// ---------- Breadboard 165 × 55 × 10 mm (bench prototyping only) ----------
export function BreadboardModel() {
  const tex = useMemo(() => holeGridTexture('bread', 1024, 342, 63, 21, '#f4f4f1', '#4b4b50', (ctx, w, h) => {
    ctx.fillStyle = '#e5e5e1'
    ctx.fillRect(0, h * 0.47, w, h * 0.06)
    ctx.fillStyle = '#d93c3c'
    ctx.fillRect(10, h * 0.02, w - 20, 3)
    ctx.fillRect(10, h * 0.9, w - 20, 3)
    ctx.fillStyle = '#3c6ad9'
    ctx.fillRect(10, h * 0.105, w - 20, 3)
    ctx.fillRect(10, h * 0.98, w - 20, 3)
  }), [])
  return (
    <group>
      <RoundedBox args={[16.5, 1.0, 5.5]} radius={0.12} smoothness={3}>
        <meshStandardMaterial color="#f1f1ee" roughness={0.6} />
      </RoundedBox>
      <mesh position={[0, 0.505, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16.2, 5.3]} />
        <meshStandardMaterial map={tex} roughness={0.6} />
      </mesh>
    </group>
  )
}

// ---------- Electronics pouch: translucent enclosure (80 × 60 × 30 mm inside) on a fabric back panel ----------
// Local frame: x = width (80 mm), y = height (60 mm), z = depth (30 mm, +z faces away from the belt).
export function EnclosureShell() {
  return (
    <group>
      <mesh position={[0, 0, -1.98]}>
        <boxGeometry args={[9.4, 7.4, 0.3]} />
        <meshStandardMaterial color="#3d3647" roughness={1} />
      </mesh>
      {/* belt loops on the back panel */}
      {[2.4, -2.4].map(y => (
        <mesh key={y} position={[0, y, -2.2]}>
          <boxGeometry args={[9.6, 1.1, 0.18]} />
          <meshStandardMaterial color="#2e2836" roughness={1} />
        </mesh>
      ))}
      <RoundedBox args={[8.6, 6.6, 3.6]} radius={0.35} smoothness={3}>
        <meshStandardMaterial color="#f7ecff" transparent opacity={0.16} roughness={0.08} metalness={0.1} depthWrite={false} />
      </RoundedBox>
      <mesh>
        <boxGeometry args={[8.6, 6.6, 3.6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges color="#a46b93" threshold={15} />
      </mesh>
    </group>
  )
}

// ---------- Mi Power Bank 3i (150 × 74 × 27 mm), lying flat, ports facing +z ----------
export function PowerBankModel() {
  const tex = useMemo(() => textTexture('pb-label', '20000 mAh', { w: 256, h: 64, fg: '#8e8e98', font: '600 26px Inter, Arial' }), [])
  return (
    <group>
      <RoundedBox args={[7.4, 2.7, 15]} radius={0.6} smoothness={4}>
        <meshStandardMaterial color="#26262b" roughness={0.45} metalness={0.25} />
      </RoundedBox>
      <mesh position={[0, 1.352, -3.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.2, 0.8]} />
        <meshStandardMaterial map={tex} transparent roughness={0.5} />
      </mesh>
      {/* ports */}
      {[-1.9, -0.3].map(x => (
        <group key={x} position={[x, -0.1, 7.48]}>
          <mesh><boxGeometry args={[1.25, 0.5, 0.08]} /><meshStandardMaterial color="#0c0c0e" /></mesh>
          <mesh position={[0, 0.06, 0.02]}><boxGeometry args={[1.0, 0.12, 0.06]} /><meshStandardMaterial color="#3b6fd8" /></mesh>
        </group>
      ))}
      <mesh position={[1.4, -0.1, 7.48]}>
        <boxGeometry args={[0.95, 0.34, 0.08]} />
        <meshStandardMaterial color="#0c0c0e" />
      </mesh>
      {[0, 1, 2, 3].map(i => (
        <Led key={i} on={t => t >= 21.5} color="#bfe3ff" size={0.08} position={[-0.6 + i * 0.4, 1.33, 6.2]} />
      ))}
    </group>
  )
}

// Separate fabric pocket the power bank sits in (outside the belt)
export function PocketModel() {
  const c = '#cdb8e6'
  return (
    <group>
      <mesh position={[0, 0.15, 0]}><boxGeometry args={[8.4, 0.3, 15.8]} /><meshStandardMaterial color={c} roughness={1} /></mesh>
      {[-4.15, 4.15].map(x => (
        <mesh key={x} position={[x, 1.25, 0]}><boxGeometry args={[0.18, 2.2, 15.8]} /><meshStandardMaterial color={c} roughness={1} /></mesh>
      ))}
      <mesh position={[0, 1.25, -7.85]}><boxGeometry args={[8.4, 2.2, 0.18]} /><meshStandardMaterial color={c} roughness={1} /></mesh>
      {[-3.5, 2.5].map(z => (
        <mesh key={z} position={[0, 3.25, z]}><boxGeometry args={[8.5, 0.14, 1.6]} /><meshStandardMaterial color="#9d86bd" roughness={1} /></mesh>
      ))}
    </group>
  )
}

// ---------- Commercial 2-channel TENS unit (approx. 100 × 60 × 30 mm), standing ----------
export function TensUnitModel() {
  const { timeRef, effects } = useSim()
  const screen = useRef()
  const scrOn = useMemo(() => canvasTexture('tens-screen', 320, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#2e6fe0')
    g.addColorStop(1, '#1b3f9c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#d7e8ff'
    ctx.font = 'bold 30px Inter, Arial'
    ctx.textAlign = 'center'
    ctx.fillText('CH1', w * 0.27, 52)
    ctx.fillText('CH2', w * 0.73, 52)
    ctx.font = 'bold 64px Inter, Arial'
    ctx.fillText('DEMO', w / 2, 150)
    ctx.font = '600 24px Inter, Arial'
    ctx.fillText('simulated display', w / 2, 210)
  }), [])
  const label = useMemo(() => textTexture('tens-label', '2-CH TENS', { w: 256, h: 56, fg: '#8a7f97', font: '700 30px Inter, Arial' }), [])
  useFrame(() => {
    if (!screen.current) return
    const on = effects && timeRef.current >= 43
    const k = on ? 0.85 + 0.15 * Math.sin((timeRef.fx || 0) * 3) : 0.28
    screen.current.color.setScalar(k)
  })
  return (
    <group>
      <RoundedBox args={[6, 10, 3]} radius={0.9} smoothness={5}>
        <meshStandardMaterial color="#f3eff6" roughness={0.35} metalness={0.05} />
      </RoundedBox>
      <RoundedBox args={[4.9, 4.0, 0.2]} radius={0.09} smoothness={3} position={[0, 2.35, 1.45]}>
        <meshStandardMaterial color="#2c2833" roughness={0.3} />
      </RoundedBox>
      <mesh position={[0, 2.35, 1.56]} userData={NO_HL}>
        <planeGeometry args={[4.3, 3.4]} />
        <meshBasicMaterial ref={screen} map={scrOn} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.05, 1.505]}>
        <planeGeometry args={[2.4, 0.52]} />
        <meshStandardMaterial map={label} transparent />
      </mesh>
      {/* buttons */}
      <mesh position={[0, -2.4, 1.48]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.72, 0.72, 0.22, 32]} />
        <meshStandardMaterial color="#d5ccde" roughness={0.4} />
      </mesh>
      {[[-1.7, -1.25], [1.7, -1.25], [-1.7, -3.55], [1.7, -3.55]].map(([x, y]) => (
        <mesh key={`${x}${y}`} position={[x, y, 1.48]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.2, 28]} />
          <meshStandardMaterial color="#bfb4cb" roughness={0.4} />
        </mesh>
      ))}
      {/* output jacks on top */}
      {[-1.4, 1.4].map(x => (
        <mesh key={x} position={[x, 5.02, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.14, 20]} />
          <meshStandardMaterial color="#2b2730" />
        </mesh>
      ))}
      {/* belt clip on the back */}
      <mesh position={[0, 1.5, -1.62]}>
        <boxGeometry args={[2.2, 5, 0.25]} />
        <meshStandardMaterial color="#d9d2e2" roughness={0.5} />
      </mesh>
    </group>
  )
}

// ---------- One electrode pad (50 × 50 mm), lying flat ----------
let electrodeGeo = null
function electrodeGeometry() {
  if (electrodeGeo) return electrodeGeo
  const s = 2.5
  const r = 0.6
  const shape = new THREE.Shape()
  shape.moveTo(-s + r, -s)
  shape.lineTo(s - r, -s)
  shape.quadraticCurveTo(s, -s, s, -s + r)
  shape.lineTo(s, s - r)
  shape.quadraticCurveTo(s, s, s - r, s)
  shape.lineTo(-s + r, s)
  shape.quadraticCurveTo(-s, s, -s, s - r)
  shape.lineTo(-s, -s + r)
  shape.quadraticCurveTo(-s, -s, -s + r, -s)
  const top = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 8 })
  top.rotateX(-Math.PI / 2)
  const gel = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 8 })
  gel.rotateX(-Math.PI / 2)
  gel.scale(0.95, 1, 0.95)
  electrodeGeo = { top, gel }
  return electrodeGeo
}

export function ElectrodeModel() {
  const { top, gel } = electrodeGeometry()
  return (
    <group>
      <mesh geometry={gel} position={[0, -0.06, 0]}>
        <meshStandardMaterial color="#a9d1f0" roughness={0.3} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={top}>
        <meshStandardMaterial color="#f6f6fb" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.28, 0.32, 0.18, 20]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  )
}

// Four pads in a 2 × 2 grid (isolated Component View)
export function ElectrodeSetModel() {
  return (
    <group>
      {[[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}><ElectrodeModel /></group>
      ))}
    </group>
  )
}

// ---------- Cables ----------
// A tube along a curve; `progress` (0..1, optional ref) reveals it from start to end.
export function CableTube({ curve, radius = 0.14, color = '#2a2a30', segments = 160, progressRef }) {
  const geo = useMemo(() => new THREE.TubeGeometry(curve, segments, radius, 8, false), [curve, segments, radius])
  const mesh = useRef()
  useFrame(() => {
    if (!progressRef || !mesh.current) return
    const p = Math.min(1, Math.max(0, progressRef.current))
    const count = geo.index.count
    mesh.current.geometry.setDrawRange(0, Math.floor((count * p) / 6) * 6)
    mesh.current.visible = p > 0.001
  })
  return (
    <mesh ref={mesh} geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.55} />
    </mesh>
  )
}

export function UsbPlug({ type = 'A', ...props }) {
  return (
    <group {...props}>
      <mesh position={[0, 0, -0.9]}>
        <boxGeometry args={type === 'A' ? [1.45, 0.75, 1.8] : [1.1, 0.55, 1.6]} />
        <meshStandardMaterial color="#2a2a30" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.35]}>
        <boxGeometry args={type === 'A' ? [1.2, 0.45, 1.0] : [0.85, 0.28, 0.8]} />
        <meshStandardMaterial color="#d3d6db" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  )
}

export function UsbCableModel() {
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(-7, 0, 0), new THREE.Vector3(-3, 1.8, 1.5), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(3, 1.6, -1.5), new THREE.Vector3(7, 0, 0),
  ]), [])
  return (
    <group>
      <CableTube curve={curve} radius={0.16} />
      <UsbPlug type="A" position={[-8.1, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <UsbPlug type="C" position={[8.1, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
    </group>
  )
}

export function TensLeadsModel() {
  const curves = useMemo(() => {
    const mk = (pts) => new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)))
    return [
      mk([[-1, 5, 0], [-1.5, 2, 0.3], [-3, 0, 0], [-5.5, -2.5, 0.5], [-6, -4.5, 0]]),
      mk([[-3, 0, 0], [-1.5, -2.5, -0.5], [-1.5, -4.5, 0]]),
      mk([[1, 5, 0], [1.5, 2, -0.3], [3, 0, 0], [5.5, -2.5, -0.5], [6, -4.5, 0]]),
      mk([[3, 0, 0], [1.5, -2.5, 0.5], [1.5, -4.5, 0]]),
    ]
  }, [])
  return (
    <group>
      {curves.map((c, i) => <CableTube key={i} curve={c} radius={0.09} color={i < 2 ? '#3b3540' : '#4a4352'} />)}
      {[[-6, -4.7], [-1.5, -4.7], [1.5, -4.7], [6, -4.7]].map(([x, y]) => (
        <mesh key={x} position={[x, y, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.5, 16]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
      {[-1, 1].map(x => (
        <mesh key={x} position={[x, 5.3, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.7, 16]} />
          <meshStandardMaterial color="#2b2730" />
        </mesh>
      ))}
    </group>
  )
}

export const LAYER_COLORS = Object.fromEntries(LAYERS.map(l => [l.id, l.color]))
