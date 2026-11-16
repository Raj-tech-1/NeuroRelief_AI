import { memo, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
import { LAYERS } from './specs'
import { SensorModel } from './models'
import { canvasTexture } from './geometry'

// A 200 mm section of the belt with its seven layers. explodeRef.current: 0 = assembled, 1 = fully separated.
// Assembled heights are visual (only the pad 1.5 mm and sensor 6 mm come from the specs).
const STACK = {
  outer: { y: 1.325, size: [20, 0.15, 10] },
  cotton: { y: 1.175, size: [20, 0.15, 10] },
  pad: { y: 1.025, size: [10, 0.15, 5] },
  sensor: { y: 0.75 },
  felt: { y: 0.6, size: [20, 0.4, 10] },
  inner: { y: 0.325, size: [20, 0.15, 10] },
  strap: { y: 0.125, size: [20, 0.25, 10] },
}
const GAP = 2.8
const PINK = new THREE.Color('#ff4fa3')

function padTexture() {
  return canvasTexture('layer-pad', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d9532a'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#f6a07a'
    ctx.lineWidth = 7
    ctx.beginPath()
    const runs = 9
    for (let k = 0; k < runs; k++) {
      const x = 30 + (w - 60) * (k / (runs - 1))
      if (k === 0) ctx.moveTo(x, 24)
      ctx.lineTo(x, k % 2 ? 24 : h - 24)
      if (k < runs - 1) ctx.lineTo(30 + (w - 60) * ((k + 1) / (runs - 1)), k % 2 ? 24 : h - 24)
    }
    ctx.stroke()
  })
}

function fabricTexture(key, base, line) {
  return canvasTexture(key, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = line
    ctx.globalAlpha = 0.35
    for (let i = 0; i < w; i += 6) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke() }
    for (let j = 0; j < h; j += 6) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(w, j); ctx.stroke() }
  })
}

function Layer({ layer, index, explodeRef, selected, onSelect }) {
  const g = useRef()
  const mats = useRef([])
  const label = useRef()
  const cfg = STACK[layer.id]
  const map = useMemo(() => {
    if (layer.id === 'pad') return padTexture()
    if (layer.id === 'strap') return fabricTexture('layer-strap', '#4a4356', '#2c2734')
    if (layer.id === 'felt') return fabricTexture('layer-felt', '#c7b4de', '#ab97c6')
    return fabricTexture(`layer-${layer.id}`, layer.color, '#ffffff')
  }, [layer])
  const lift = (LAYERS.length - 1 - index) * GAP

  useFrame(({ clock }) => {
    if (!g.current) return
    const e = explodeRef.current
    g.current.position.y = cfg.y + lift * e
    const hl = selected ? 0.5 + 0.25 * Math.sin(clock.elapsedTime * 3) : 0
    mats.current.forEach(m => { if (m?.emissive) { m.emissive.copy(PINK); m.emissiveIntensity = hl } })
    if (label.current) label.current.style.opacity = e > 0.12 || selected ? '1' : '0'
  })

  const click = (ev) => { ev.stopPropagation(); onSelect(layer.id) }
  const transparent = layer.id === 'outer' || layer.id === 'cotton'
  return (
    <group ref={g} position={[0, cfg.y, 0]} onClick={click}
      onPointerOver={(ev) => { ev.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}>
      {layer.id === 'sensor' ? (
        <group position={[-1.2, 0, 0.6]} rotation={[0, 0, Math.PI / 2]}>
          <group ref={el => { if (el) mats.current = []; el?.traverse(o => { if (o.isMesh) mats.current.push(o.material) }) }}>
            <SensorModel />
          </group>
          <mesh position={[0, -3.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 3, 10]} />
            <meshStandardMaterial color="#26252b" />
          </mesh>
        </group>
      ) : (
        <RoundedBox args={cfg.size} radius={Math.min(0.06, cfg.size[1] / 2 - 0.01)} smoothness={2} castShadow receiveShadow>
          <meshStandardMaterial ref={m => { if (m) mats.current = [m] }} map={map} roughness={0.9}
            transparent={transparent} opacity={transparent ? 0.92 : 1} />
        </RoundedBox>
      )}
      {layer.id === 'strap' && (
        <mesh position={[8.4, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3, 9.4]} />
          <meshStandardMaterial color="#6e6680" roughness={1} />
        </mesh>
      )}
      <Html position={[-10.6, 0, 5]} zIndexRange={[30, 0]}
        style={{ pointerEvents: 'none' }}>
        <button ref={label} onClick={() => onSelect(layer.id)} style={{ opacity: 0, pointerEvents: 'auto', transition: 'opacity .3s' }}
          className={`-translate-x-full -translate-y-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border pl-1 pr-2.5 py-1 text-[11px] font-semibold shadow ${
            selected ? 'bg-brand-600 text-white border-brand-600' : 'bg-white/95 text-brand-900 border-brand-100'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${selected ? 'bg-white text-brand-700' : 'bg-brand-100 text-brand-700'}`}>{index + 1}</span>
          {layer.name}
        </button>
      </Html>
    </group>
  )
}

function LayerScene({ explodeTarget, selected, onSelect }) {
  const explodeRef = useRef(explodeTarget)
  const target = useRef(explodeTarget)
  target.current = explodeTarget
  useFrame((_, delta) => {
    explodeRef.current += (target.current - explodeRef.current) * Math.min(1, delta * 5)
  })
  return (
    <group position={[0, 0.2, 0]}>
      {LAYERS.map((l, i) => (
        <Layer key={l.id} layer={l} index={i} explodeRef={explodeRef} selected={selected === l.id} onSelect={onSelect} />
      ))}
    </group>
  )
}

export default memo(LayerScene)
