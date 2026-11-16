import { memo, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { SimContext, useSim } from './simContext'
import { Part, makeTrack } from './Part'
import {
  BeltLayer, beltBand, HeatingPadModel, padGeometry, padTraceCurve, SensorModel, ESP32Model, MosfetModel,
  ResistorsModel, TerminalModel, FuseModel, PerfboardModel, EnclosureShell, PowerBankModel, PocketModel,
  TensUnitModel, ElectrodeModel, UsbPlug,
} from './models'
import {
  ENCLOSURE, POWERBANK, POCKET, TENS_UNIT, ELECTRODES, SENSOR, USB_CURVE, USB_PLUG_AT_BANK, PAD_LEAD_CURVE,
  SENSOR_LEAD_CURVE, TENS_LEADS, BAND, PAD_TH, PAD_Y, bandGeometry, ellipsePoint, smooth, clamp01,
} from './geometry'
import { SIM_END, stageIndexAt } from './specs'

// ---------------------------------------------------------------------------------------------
// Camera shots for the cinematic Working Simulation: [startTime, shot]
// ---------------------------------------------------------------------------------------------
const S = (key, target, dir, r, drift = 0.1) => ({ key, target, dir, r, drift })
const SHOTS = [
  [0, S('exploded', [-2, 10, 2], [0, 0.45, 1], 42, 0.1)],
  [1.5, S('layers', [0, 11, 0], [0.3, 0.42, 1], 22)],
  [5.2, S('sensor', [0, 5, 11], [0.35, 0.35, 1], 10, 0.15)],
  [6.8, S('pad', [0, 5.5, 12], [0.15, 0.32, 1], 11, 0.15)],
  [8.6, S('closing', [0, 8, 1], [0.3, 0.55, 1], 21)],
  [10.6, S('pouch', [ENCLOSURE.pos.x, 6.5, ENCLOSURE.pos.z], [0.6, 0.5, 1], 8, 0.16)],
  [16.6, S('bank', [27, 2.5, -1], [0.45, 0.75, 0.9], 12)],
  [18, S('tens-kit', [-31, 4, 4], [-0.2, 0.6, 1], 14)],
  [20, S('power', [23, 2.5, 5], [0.55, 0.6, 1], 12)],
  [23.5, S('power-path', [10, 4, 6], [0.35, 0.55, 1], 20)],
  [27, S('sensing', [7, 4.5, 9], [0.4, 0.4, 1], 11, 0.12)],
  [34, S('heating', [1.5, 5, 12], [0.12, 0.32, 1], 8, 0.15)],
  [42, S('tens', [-31, 3, 5], [-0.15, 0.62, 1], 14)],
  [50, S('complete', [-1, 4, 2], [0, 0.6, 1], 37, 0.16)],
]
// Which component labels the simulation shows in each stage (moving / selected parts always show)
const STAGE_LABELS = [
  [],
  ['powerbank', 'usb', 'enclosure', 'pad'],
  ['sensor', 'enclosure', 'pad'],
  ['pad', 'sensor', 'enclosure'],
  ['tens', 'electrodes', 'leads'],
  ['tens', 'electrodes', 'belt', 'enclosure', 'powerbank'],
]
export function simLabelFilter(t) {
  return STAGE_LABELS[stageIndexAt(t)]
}
// Zone captions are shown in the wide shots only
const zoneLabelsAt = (t) => t < 1.5 || (t >= 18 && t < 20.5) || t >= 42

export function shotAt(t) {
  let s = SHOTS[0][1]
  for (const [t0, shot] of SHOTS) if (t >= t0) s = shot
  return s
}

// ---------------------------------------------------------------------------------------------
// Assembly tracks: exploded pose -> assembled pose
// ---------------------------------------------------------------------------------------------
// Label above the probe, expressed in the probe's rotated local frame
const SENSOR_LABEL = new THREE.Vector3(-4.5, -0.6, 2.2).applyQuaternion(SENSOR.quat.clone().invert()).toArray()

const up = (v, x, y, z) => v.clone().add(new THREE.Vector3(x, y, z))

function buildTracks() {
  const c = (id) => beltBand(id).center
  const pad = padGeometry().center
  const sensorRot = new THREE.Euler().setFromQuaternion(SENSOR.quat)
  const sr = [sensorRot.x, sensorRot.y, sensorRot.z]
  const encR = [0, ENCLOSURE.rotY, 0]
  const T = {
    strap: makeTrack({ p: up(c('strap'), 0, 9, 0), r: [0, 0.7, 0] }, { p: c('strap') }, 1.5, 3.5, 0),
    inner: makeTrack({ p: up(c('inner'), 0, 12.5, 0), r: [0, -0.6, 0] }, { p: c('inner') }, 2.3, 4.4, 0),
    felt: makeTrack({ p: up(c('felt'), 0, 16, 0), r: [0, 0.5, 0] }, { p: c('felt') }, 3.1, 5.2, 0),
    sensor: makeTrack({ p: up(SENSOR.pos, -5, 9, 12), r: [sr[0] + 1.2, sr[1] + 2, sr[2]] }, { p: SENSOR.pos, r: sr }, 5.2, 6.9, 2),
    pad: makeTrack({ p: up(pad, 2, 9, 15), r: [-0.6, 0.5, 0.15] }, { p: pad }, 6.8, 8.7, 2.5),
    cotton: makeTrack({ p: up(c('cotton'), 0, 19.5, 0), r: [0, -0.4, 0] }, { p: c('cotton') }, 8.6, 10.0, 0),
    outer: makeTrack({ p: up(c('outer'), 0, 23, 0), r: [0, 0.35, 0] }, { p: c('outer') }, 9.2, 10.7, 0),
    enclosure: makeTrack({ p: up(ENCLOSURE.pos, 6, 10, 8), r: [0.35, ENCLOSURE.rotY + 0.9, 0.2] }, { p: ENCLOSURE.pos, r: encR }, 10.6, 12.0, 1.5),
    // board-frame tracks (board lies in the pouch; +y = out of the board, -z = up)
    perfboard: makeTrack({ p: [0, 6, -7], r: [0.7, 0.2, 0.3] }, { p: [0, 0, 0] }, 11.6, 12.8, 1.5),
    esp32: makeTrack({ p: [-4, 8, -10], r: [0.6, 1.2, 0.3] }, { p: [-0.6, 0.75, -1.0] }, 12.4, 13.8, 2),
    mosfet: makeTrack({ p: [5, 7, -10], r: [1, -0.8, 0.4] }, { p: [2.6, 1.85, -1.1] }, 13.2, 14.4, 2),
    resistors: makeTrack({ p: [-6, 6, -8], r: [0.4, 0.9, -0.6] }, { p: [-2.1, 0.4, 1.4] }, 13.8, 15.0, 2),
    terminal: makeTrack({ p: [6, 6, -7], r: [0.8, -1.2, 0.2] }, { p: [2.6, 0.6, 1.5], r: [0, Math.PI, 0] }, 14.4, 15.6, 2),
    fuse: makeTrack({ p: [1, 8, -11], r: [0.5, 1.4, 0.8] }, { p: [0.2, 0.32, 1.65] }, 15.0, 16.4, 2),
    powerbank: makeTrack({ p: up(POWERBANK.pos, 7, 10, 7), r: [0.55, 0.9, 0.3] }, { p: POWERBANK.pos }, 16.6, 18.0, 2),
    tens: makeTrack({ p: up(TENS_UNIT.pos, -3, 9, 9), r: [0.35, -1.1, -0.2] }, { p: TENS_UNIT.pos, r: [0, TENS_UNIT.rotY, 0] }, 18.0, 19.4, 2),
    electrodes: ELECTRODES.map((p, i) => makeTrack(
      { p: up(p, (i % 2 ? 3 : -3), 7 + i * 1.3, 7), r: [0.9 - i * 0.3, 0.6 * i, 0.5] },
      { p }, 18.4 + i * 0.32, 19.7 + i * 0.25, 1.5)),
  }
  return T
}

// ---------------------------------------------------------------------------------------------
// Animated pieces
// ---------------------------------------------------------------------------------------------
const fx = (clock) => clock.fx || 0

// Cable revealed from its start; an optional plug rides on the growing tip.
function AnimatedCable({ curve, radius, color, progress, tip, segments = 200 }) {
  const { timeRef } = useSim()
  const geo = useMemo(() => new THREE.TubeGeometry(curve, segments, radius, 8, false), [curve, segments, radius])
  const mesh = useRef()
  const tipRef = useRef()
  const q = useMemo(() => new THREE.Quaternion(), [])
  useFrame(() => {
    const p = clamp01(progress(timeRef.current))
    if (mesh.current) {
      mesh.current.geometry.setDrawRange(0, Math.floor((geo.index.count * p) / 6) * 6)
      mesh.current.visible = p > 0.002
    }
    if (tipRef.current) {
      const u = Math.max(0.001, p)
      tipRef.current.position.copy(curve.getPointAt(u))
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(Math.min(0.999, u)))
      tipRef.current.quaternion.copy(q)
      tipRef.current.visible = p > 0.002
    }
  })
  return (
    <group>
      <mesh ref={mesh} geometry={geo}>
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {tip && <group ref={tipRef}>{tip}</group>}
    </group>
  )
}

// Glowing particles travelling along a curve (power, data, TENS pulses).
function FlowParticles({ curve, color, count = 10, speed = 0.35, size = 0.16, intensity, reverse = false, cube = false }) {
  const { timeRef } = useSim()
  const core = useRef()
  const halo = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const level = useRef(0)
  useFrame((_, delta) => {
    const target = intensity(timeRef.current)
    level.current += (target - level.current) * Math.min(1, delta * 5)
    const lv = level.current
    const tt = fx(timeRef)
    for (let i = 0; i < count; i++) {
      let u = (tt * speed + i / count) % 1
      if (reverse) u = 1 - u
      const pnt = curve.getPointAt(u)
      // fade near the ends so particles appear to enter and leave
      const edge = Math.min(1, u * 8, (1 - u) * 8)
      const s = lv < 0.01 ? 0.0001 : size * lv * (0.6 + 0.4 * edge)
      dummy.position.copy(pnt)
      dummy.rotation.set(tt * 2 + i, tt * 3, 0)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      core.current.setMatrixAt(i, dummy.matrix)
      dummy.scale.setScalar(s * 2.4)
      dummy.updateMatrix()
      halo.current.setMatrixAt(i, dummy.matrix)
    }
    core.current.instanceMatrix.needsUpdate = true
    halo.current.instanceMatrix.needsUpdate = true
    core.current.visible = halo.current.visible = lv > 0.01
  })
  return (
    <group userData={{ noHighlight: true }}>
      <instancedMesh ref={core} args={[null, null, count]} frustumCulled={false} userData={{ noHighlight: true }}>
        {cube ? <boxGeometry args={[1.2, 1.2, 1.2]} /> : <sphereGeometry args={[1, 12, 12]} />}
        <meshBasicMaterial color={color} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halo} args={[null, null, count]} frustumCulled={false} userData={{ noHighlight: true }}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

const heatLevel = (t) => smooth(34.4, 37.6, t)

function HeatEffect() {
  const { timeRef } = useSim()
  const glow = useRef()
  const trace = useRef()
  const shells = useRef([])
  const glowGeo = useMemo(() => bandGeometry(BAND.pad[1] + 0.01, BAND.pad[1] + 0.03, PAD_Y[0] - 0.15, PAD_Y[1] + 0.15, PAD_TH[0] - 0.01, PAD_TH[1] + 0.01, 300), [])
  const shellGeo = useMemo(() => bandGeometry(BAND.outer[1] + 0.05, BAND.outer[1] + 0.08, PAD_Y[0] + 0.2, PAD_Y[1] - 0.2, PAD_TH[0] + 0.03, PAD_TH[1] - 0.03, 300), [])
  const traceGeo = useMemo(() => new THREE.TubeGeometry(padTraceCurve(BAND.pad[1] + 0.03), 500, 0.075, 6, false), [])
  useFrame(() => {
    const h = heatLevel(timeRef.current)
    const tt = fx(timeRef)
    if (glow.current) {
      glow.current.material.opacity = h * (0.42 + 0.12 * Math.sin(tt * 2.2))
      glow.current.visible = h > 0.01
    }
    if (trace.current) {
      trace.current.material.opacity = h * (0.75 + 0.25 * Math.sin(tt * 3.1))
      trace.current.visible = h > 0.01
    }
    // warmth shells drift outwards from the pad and fade (illustrative)
    shells.current.forEach((m, i) => {
      if (!m) return
      const ph = (tt * 0.45 + i / 3) % 1
      m.position.set(0, 0, ph * 2.2)
      m.scale.set(1 + ph * 0.06, 1 + ph * 0.1, 1)
      m.material.opacity = h * 0.32 * Math.sin(Math.PI * ph)
      m.visible = h > 0.01
    })
  })
  return (
    <group userData={{ noHighlight: true }}>
      <mesh ref={glow} geometry={glowGeo} userData={{ noHighlight: true }}>
        <meshBasicMaterial color="#ff7a2f" transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={trace} geometry={traceGeo} userData={{ noHighlight: true }}>
        <meshBasicMaterial color="#ffc061" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {[0, 1, 2].map(i => (
        <mesh key={i} ref={el => { shells.current[i] = el }} geometry={shellGeo} userData={{ noHighlight: true }}>
          <meshBasicMaterial color="#ff9a4d" transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <FlowParticles curve={padTraceCurve(BAND.pad[1] + 0.05)} color="#ffd27a" count={26} speed={0.06} size={0.12} intensity={heatLevel} />
    </group>
  )
}

// Simulated temperature readout (never a hardware measurement)
function simTemp(t) {
  const base = 26 + 10 * smooth(34.5, 41.5, t)
  return base + 0.15 * Math.sin(t * 1.7)
}
function TempReadout() {
  const { timeRef } = useSim()
  const box = useRef()
  const val = useRef()
  const state = useRef()
  useFrame(() => {
    const t = timeRef.current
    const on = t >= 28.6
    if (box.current) box.current.style.opacity = on ? '1' : '0'
    if (on && val.current) val.current.textContent = `${simTemp(t).toFixed(1)} °C`
    if (on && state.current) state.current.textContent = t >= 34.4 ? 'Heating: ON (simulated)' : 'Heating: standby (simulated)'
  })
  return (
    <Html position={ellipsePoint(Math.PI / 2 - 0.5, 3.5, 9.2)} zIndexRange={[45, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={box} style={{ opacity: 0, transition: 'opacity .4s', transform: 'translate(-50%, -100%)' }}
        className="rounded-2xl bg-white/95 border border-orange-200 shadow-lg px-3 py-2 min-w-[150px]">
        <p className="text-[10px] font-bold tracking-wider text-orange-600">SIMULATED</p>
        <p ref={val} className="text-xl font-extrabold text-gray-900 leading-tight">-- °C</p>
        <p ref={state} className="text-[10px] text-gray-600"></p>
        <p className="text-[9px] text-gray-400 mt-0.5">Illustrative value, not a hardware reading</p>
      </div>
    </Html>
  )
}

const tensLevel = (t) => smooth(45, 46, t)

function TensPulses() {
  const { timeRef } = useSim()
  const rings = useRef([])
  const glows = useRef([])
  useFrame(() => {
    const lv = tensLevel(timeRef.current)
    const tt = fx(timeRef)
    ELECTRODES.forEach((_, i) => {
      const ch = i % 2 === 0 ? 0 : 0.5 // channel 1 pads 0,2; channel 2 pads 1,3
      const ph = (tt * 0.9 + ch) % 1
      const r = rings.current[i]
      if (r) {
        r.scale.setScalar(1 + ph * 0.9)
        r.material.opacity = lv * 0.7 * (1 - ph)
        r.visible = lv > 0.01
      }
      const g = glows.current[i]
      if (g) {
        g.material.opacity = lv * (0.25 + 0.3 * Math.max(0, Math.sin((tt * 0.9 + ch) * Math.PI * 2)))
        g.visible = lv > 0.01
      }
    })
  })
  return (
    <group userData={{ noHighlight: true }}>
      {ELECTRODES.map((p, i) => (
        <group key={i} position={[p.x, 0.04, p.z]}>
          <mesh ref={el => { rings.current[i] = el }} rotation={[-Math.PI / 2, 0, 0]} userData={{ noHighlight: true }}>
            <ringGeometry args={[2.75, 3.05, 48]} />
            <meshBasicMaterial color="#4f8dff" transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh ref={el => { glows.current[i] = el }} position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]} userData={{ noHighlight: true }}>
            <circleGeometry args={[2.6, 40]} />
            <meshBasicMaterial color="#7fb2ff" transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {TENS_LEADS.map((l, i) => (
        <FlowParticles key={i} curve={l.curve} color="#3f7bff" count={6} speed={0.5} size={0.13}
          intensity={tensLevel} />
      ))}
    </group>
  )
}

// Floor zones that make the two independent systems obvious
function roundedRect(w, h, r) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -h / 2)
  s.lineTo(w / 2 - r, -h / 2)
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  s.lineTo(w / 2, h / 2 - r)
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  s.lineTo(-w / 2 + r, h / 2)
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  s.lineTo(-w / 2, -h / 2 + r)
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  return new THREE.ShapeGeometry(s, 8)
}

function Zones({ showTens, labels, when }) {
  const { timeRef } = useSim()
  const heat = useMemo(() => roundedRect(56, 33, 3), [])
  const tens = useMemo(() => roundedRect(19, 29, 3), [])
  const showText = labels !== 'none'
  const texts = useRef([])
  useFrame(() => {
    const on = !when || when(timeRef.current)
    texts.current.forEach(el => { if (el) el.style.opacity = on ? '1' : '0' })
  })
  const keep = (i) => (el) => { texts.current[i] = el }
  return (
    <group userData={{ noHighlight: true }}>
      <mesh geometry={heat} rotation={[-Math.PI / 2, 0, 0]} position={[7.5, 0.01, 2.5]} receiveShadow userData={{ noHighlight: true }}>
        <meshStandardMaterial color="#fde3ee" transparent opacity={0.75} roughness={1} depthWrite={false} />
      </mesh>
      {showText && (
        <Html position={[35, 0.1, 18.4]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={keep(0)} style={{ transition: 'opacity .4s' }} className="-translate-x-full -translate-y-full whitespace-nowrap rounded-lg bg-brand-600/90 text-white text-[10px] sm:text-[11px] font-semibold px-2 py-1 shadow">
            Heating system (our prototype)
          </div>
        </Html>
      )}
      {showTens && (
        <>
          <mesh geometry={tens} rotation={[-Math.PI / 2, 0, 0]} position={[-32, 0.01, 3.5]} receiveShadow userData={{ noHighlight: true }}>
            <meshStandardMaterial color="#e2ebff" transparent opacity={0.85} roughness={1} depthWrite={false} />
          </mesh>
          {Array.from({ length: 15 }, (_, i) => (
            <mesh key={i} position={[-21.6, 0.03, -13 + i * 2.2]} userData={{ noHighlight: true }}>
              <boxGeometry args={[0.18, 0.04, 1.2]} />
              <meshBasicMaterial color="#a690c9" />
            </mesh>
          ))}
          {showText && (
            <>
              <Html position={[-41, 0.1, 18.4]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                <div ref={keep(1)} style={{ transition: 'opacity .4s' }} className="-translate-y-full whitespace-nowrap rounded-lg bg-blue-600/90 text-white text-[10px] sm:text-[11px] font-semibold px-2 py-1 shadow">
                  Commercial TENS (separate device)
                </div>
              </Html>
              <Html position={[-21.6, 0.1, 20]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                <div ref={keep(2)} style={{ transition: 'opacity .4s' }} className="-translate-x-1/2 whitespace-nowrap rounded-full bg-white/95 border border-violet-200 text-violet-800 text-[10px] font-semibold px-2 py-0.5 shadow">
                  No electrical connection between systems
                </div>
              </Html>
            </>
          )}
        </>
      )}
    </group>
  )
}

// Advances the simulation clock while playing.
function TimeDriver({ clock, onTick }) {
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    if (clock.playing) {
      clock.current = Math.min(SIM_END, clock.current + dt * clock.speed)
      clock.fx = (clock.fx || 0) + dt * clock.speed
    }
    if (onTick) onTick()
  })
  return null
}

// ---------------------------------------------------------------------------------------------
// The whole system. mode: 'sim' (timeline + effects) or 'static' (assembled, no effects).
// ---------------------------------------------------------------------------------------------
function SystemScene({ clock, effects = false, showTens = true, selectedId = null, dimOthers = false,
  labels = 'all', onSelect, registry, onTick }) {
  const tracks = useMemo(buildTracks, [])
  const labelFilter = effects ? simLabelFilter : null
  const ctx = useMemo(() => ({ timeRef: clock, effects, selectedId, dimOthers, labels, labelFilter, onSelect, registry }),
    [clock, effects, selectedId, dimOthers, labels, labelFilter, onSelect, registry])

  // Sensing stage: fade the pad and outer fabric so the probe behind the pad is visible
  const reveal = (t) => (effects ? smooth(27.2, 28.2, t) * (1 - smooth(33.4, 34.2, t)) : 0)
  const padGhost = (t) => reveal(t) * 0.75

  const usbProgress = (t) => smooth(20.4, 22.6, t)
  const padLeadProgress = (t) => smooth(21.8, 23.4, t)
  const sensorLeadProgress = (t) => smooth(27.4, 28.6, t)
  const leadProgress = (i) => (t) => smooth(42.3 + i * 0.35, 44.4 + i * 0.35, t)
  const power = (t) => (effects ? smooth(22.8, 23.6, t) : 0)
  const data = (t) => (effects ? smooth(28.6, 29.3, t) : 0)

  const minor = (id) => ({ id, main: false })

  return (
    <SimContext.Provider value={ctx}>
      {onTick !== undefined && <TimeDriver clock={clock} onTick={onTick} />}
      <Zones showTens={showTens} labels={labels} when={effects ? zoneLabelsAt : null} />

      {/* ---------------- Heating subsystem (our prototype) ---------------- */}
      <Part id="belt" secondary name="Elastic Velcro belt" sub="Layer 7 · base strap" track={tracks.strap} labelOffset={[-15, 5, 4]}>
        <BeltLayer id="strap" />
      </Part>
      <Part id="belt" secondary name="Inner cotton layer" sub="Layer 6" track={tracks.inner} labelOffset={[-15, 7, 4]}>
        <BeltLayer id="inner" />
      </Part>
      <Part id="belt" secondary name="Felt / foam insulation" sub="Layer 5" track={tracks.felt} labelOffset={[-15, 9, 4]}>
        <BeltLayer id="felt" />
      </Part>
      <Part id="sensor" name="DS18B20 temperature sensor" sub="6 × 30 mm, attached to pad" main track={tracks.sensor}
        labelOffset={SENSOR_LABEL}>
        <SensorModel />
      </Part>
      <Part id="pad" name="5 V silicone heating pad" sub="50 × 100 mm, inside belt" main track={tracks.pad}
        ghost={padGhost} labelOffset={[2.5, 3.4, 0.5]}>
        <HeatingPadModel />
      </Part>
      <Part id="belt" secondary name="Cotton layer" sub="Layer 2" track={tracks.cotton} ghost={reveal} labelOffset={[-15, 7, 4]}>
        <BeltLayer id="cotton" />
      </Part>
      <Part id="belt" name="Adjustable wearable belt" sub="100 × 900 mm · outer fabric" main track={tracks.outer}
        ghost={reveal} labelOffset={[-15, 7, 4]}>
        <BeltLayer id="outer" />
      </Part>

      <Part id="enclosure" name="ESP32 + MOSFET + resistors" sub="Electronics pouch beside belt" main track={tracks.enclosure}
        labelOffset={[-2.2, 5, 0]}>
        <EnclosureShell />
        <group position={[0, 0, -1.3]} rotation={[Math.PI / 2, 0, 0]}>
          <Part {...minor('perfboard')} name="Perfboard" sub="50 × 70 mm" track={tracks.perfboard} labelOffset={[0, 0.5, -3]}>
            <PerfboardModel />
          </Part>
          <Part {...minor('esp32')} name="ESP32 NodeMCU-32S" sub="51 × 28 × 13 mm" track={tracks.esp32} labelOffset={[0, 1, -1.8]}>
            <ESP32Model />
          </Part>
          <Part {...minor('mosfet')} name="IRLZ44N MOSFET" track={tracks.mosfet} labelOffset={[0, 1.2, -0.6]}>
            <MosfetModel />
          </Part>
          <Part {...minor('resistors')} name="Resistors" track={tracks.resistors} labelOffset={[0, 0.6, -0.6]}>
            <ResistorsModel />
          </Part>
          <Part {...minor('terminal')} name="Screw terminal" track={tracks.terminal} labelOffset={[0, 0.9, 0]}>
            <TerminalModel />
          </Part>
          <Part {...minor('fuse')} name="Thermal fuse" track={tracks.fuse} labelOffset={[0, 0.5, 0]}>
            <FuseModel />
          </Part>
        </group>
      </Part>

      <Part id="powerbank" name="Mi Power Bank 3i" sub="20000 mAh · separate pocket" main track={tracks.powerbank} labelOffset={[2.5, 1.8, 1]}>
        <PowerBankModel />
      </Part>
      <Part id="powerbank" position={POCKET.pos}>
        <PocketModel />
      </Part>

      <Part id="usb" name="USB power cable (5 V)" main showAfter={22.6} labelOffset={[24.2, 2.2, 10.8]}>
        <group>
          <AnimatedCable curve={USB_CURVE} radius={0.16} color="#2b2a31" progress={usbProgress}
            tip={<UsbPlug type="C" scale={0.8} />} />
          <AnimatedPlug progress={usbProgress} position={USB_PLUG_AT_BANK} />
        </group>
      </Part>
      <Part id="pad" selectable>
        <AnimatedCable curve={PAD_LEAD_CURVE} radius={0.075} color="#8a2331" progress={padLeadProgress} />
      </Part>
      <Part id="sensor">
        <AnimatedCable curve={SENSOR_LEAD_CURVE} radius={0.06} color="#26252b" progress={sensorLeadProgress} />
      </Part>

      {effects && (
        <>
          <FlowParticles curve={USB_CURVE} color="#ff3d55" count={9} speed={0.42} size={0.2} intensity={power} />
          <FlowParticles curve={PAD_LEAD_CURVE} color="#ff3d55" count={8} speed={0.42} size={0.15} intensity={power} reverse />
          <FlowParticles curve={SENSOR_LEAD_CURVE} color="#8f6bff" count={7} speed={0.32} size={0.13} intensity={data} cube />
          <HeatEffect />
          <TempReadout />
        </>
      )}

      {/* ---------------- Commercial TENS subsystem (separate device) ---------------- */}
      {showTens && (
        <>
          <Part id="tens" name="Commercial 2-channel TENS unit" sub="Separate device · own power" main track={tracks.tens}
            labelOffset={[0, 6.6, 0]}>
            <TensUnitModel />
          </Part>
          {tracks.electrodes.map((tr, i) => (
            <Part key={i} id="electrodes" secondary={i !== 3} name={i === 3 ? 'TENS electrode pads (× 4)' : `Electrode pad ${i + 1}`}
              sub={i === 3 ? '50 × 50 mm each' : undefined} main={i === 3} track={tr} labelOffset={[0, 1.2, 2.6]}>
              <ElectrodeModel />
            </Part>
          ))}
          <Part id="leads" name="TENS lead wires" sub="2 channels → 4 pads" main showAfter={44.6} labelOffset={[-24.5, 6, 2.4]}>
            {TENS_LEADS.map((l, i) => (
              <AnimatedCable key={i} curve={l.curve} radius={0.085} color={l.channel === 1 ? '#3d3846' : '#5a5168'}
                progress={leadProgress(i)} tip={<PinPlug />} />
            ))}
          </Part>
          {effects && <TensPulses />}
        </>
      )}
    </SimContext.Provider>
  )
}

function PinPlug() {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.2, 0.2, 0.55, 14]} />
      <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.25} />
    </mesh>
  )
}

// USB-A plug that seats itself into the power bank port as the cable connects
function AnimatedPlug({ progress, position }) {
  const { timeRef } = useSim()
  const g = useRef()
  useFrame(() => {
    if (!g.current) return
    const p = clamp01(progress(timeRef.current) * 6)
    g.current.visible = p > 0.001
    g.current.position.set(position.x, position.y, position.z + (1 - p) * 1.5)
  })
  return (
    <group ref={g}>
      <UsbPlug type="A" rotation={[0, Math.PI, 0]} scale={0.8} />
    </group>
  )
}

export default memo(SystemScene)
