import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useSim } from './simContext'
import { easeInOut, clamp01 } from './geometry'

const PINK = new THREE.Color('#ff4fa3')
const tmpP = new THREE.Vector3()
const tmpR = new THREE.Vector3()

function toVec(v) {
  return v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(...v)
}

// A track moves a part from an exploded pose to its assembled pose between t0 and t1 (sim seconds)
// along a gentle arc. Poses are { p: [x,y,z] | Vector3, r: [x,y,z] }.
export function makeTrack(from, to, t0, t1, arc = 0) {
  return {
    from: { p: toVec(from.p), r: toVec(from.r || [0, 0, 0]) },
    to: { p: toVec(to.p), r: toVec(to.r || [0, 0, 0]) },
    t0, t1, arc,
    phase: Math.random() * Math.PI * 2,
  }
}

function trackProgress(track, t) {
  return easeInOut(clamp01((t - track.t0) / (track.t1 - track.t0)))
}

// Collect this part's own meshes (not those of nested parts or indicator lights)
function collectMeshes(root) {
  const out = []
  const walk = (o) => {
    if (o !== root && o.userData?.isPart) return
    if (o.isMesh && !o.userData?.noHighlight) out.push(o)
    o.children.forEach(walk)
  }
  walk(root)
  return out
}

function baseOf(mat) {
  if (!mat.userData.base) {
    mat.userData.base = {
      opacity: mat.opacity,
      transparent: mat.transparent,
      depthWrite: mat.depthWrite,
      emissive: mat.emissive ? mat.emissive.clone() : null,
      ei: mat.emissiveIntensity ?? 1,
    }
  }
  return mat.userData.base
}

/**
 * One selectable hardware part.
 *  id      – component id (selection / details); several parts may share one id
 *  name    – label text
 *  main    – label shown in "all labels" mode (minor parts only label while moving or selected)
 *  track   – optional assembly track; without it the part stays at `position`/`rotation`
 *  ghost   – optional (t) => 0..1 fade used to reveal hidden parts
 */
export function Part({
  id, name, sub, main = false, secondary = false, showAfter = -Infinity, track, ghost, children,
  labelOffset = [0, 2, 0], position, rotation, quaternion, selectable = true,
}) {
  const { timeRef, selectedId, dimOthers, labels, labelFilter, onSelect, registry } = useSim()
  const group = useRef()
  const labelEl = useRef()
  const meshes = useRef([])
  const frame = useRef(0)
  const amt = useRef({ hl: 0, dim: 0, ghost: 0, first: true })
  const ud = useMemo(() => ({ isPart: true, partId: id }), [id])

  useEffect(() => {
    if (!registry || !group.current) return
    if (!registry.has(id)) registry.set(id, group.current)
    const g = group.current
    return () => { if (registry.get(id) === g) registry.delete(id) }
  }, [registry, id])

  useEffect(() => () => { document.body.style.cursor = '' }, [])

  useFrame(({ clock }, delta) => {
    const g = group.current
    if (!g) return
    const t = timeRef.current
    const dt = Math.min(delta, 0.1)
    const a = amt.current

    // ---- pose ----
    let e = 1
    if (track) {
      e = trackProgress(track, t)
      tmpP.copy(track.from.p).lerp(track.to.p, e)
      tmpP.y += Math.sin(Math.PI * e) * track.arc
      if (e < 1) {
        // exploded parts float gently, settling as they arrive
        const f = (1 - e) * 0.18
        tmpP.y += Math.sin((timeRef.fx ?? clock.elapsedTime) * 1.3 + track.phase) * f
      }
      tmpR.copy(track.from.r).lerp(track.to.r, e)
      if (a.first) {
        g.position.copy(tmpP)
        g.rotation.set(tmpR.x, tmpR.y, tmpR.z)
      } else {
        const k = 1 - Math.exp(-dt * 4.2)
        g.position.lerp(tmpP, k)
        g.rotation.set(
          g.rotation.x + (tmpR.x - g.rotation.x) * k,
          g.rotation.y + (tmpR.y - g.rotation.y) * k,
          g.rotation.z + (tmpR.z - g.rotation.z) * k,
        )
      }
    }
    const moving = !!track && t > track.t0 - 0.15 && t < track.t1 + 0.5

    // ---- highlight / dim / ghost ----
    if (frame.current++ % 30 === 0) {
      meshes.current = collectMeshes(g)
      meshes.current.forEach(m => { if (!m.userData.noShadow) m.castShadow = true })
    }
    const selected = selectedId === id
    const hlTarget = selected ? 0.55 + 0.25 * Math.sin(clock.elapsedTime * 3.2)
      : moving ? 0.45 * Math.sin(Math.PI * clamp01((t - track.t0) / (track.t1 - track.t0 + 0.4))) : 0
    const dimTarget = dimOthers && selectedId && !selected ? 1 : 0
    const ghostTarget = ghost ? ghost(t) : 0
    const k2 = a.first ? 1 : 1 - Math.exp(-dt * 6)
    a.hl += (hlTarget - a.hl) * (selected ? 1 : k2)
    a.dim += (dimTarget - a.dim) * k2
    a.ghost += (ghostTarget - a.ghost) * k2
    a.first = false

    const fade = (1 - 0.82 * a.dim) * (1 - 0.8 * a.ghost)
    for (const m of meshes.current) {
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        const b = baseOf(mat)
        const wantT = b.transparent || fade < 0.995
        if (mat.transparent !== wantT) { mat.transparent = wantT; mat.needsUpdate = true }
        mat.opacity = b.opacity * fade
        mat.depthWrite = b.depthWrite && fade >= 0.995
        if (b.emissive) {
          mat.emissive.copy(b.emissive).lerp(PINK, Math.max(0, a.hl))
          mat.emissiveIntensity = a.hl > 0.01 ? Math.max(b.ei, 1) : b.ei
        }
      }
    }

    // ---- label visibility ----
    const el = labelEl.current
    if (el) {
      const placed = (!track || e >= 0.999) && t >= showAfter
      const sel = selected && !secondary && t >= showAfter
      let show
      if (labels === 'none') show = sel
      else if (labels === 'active') show = sel || moving
      else {
        const allowed = labelFilter ? labelFilter(t) : null
        show = sel || moving || (main && placed && (!labelFilter || (allowed && allowed.includes(id))))
      }
      const target = show && fade > 0.3 ? 1 : 0
      const cur = parseFloat(el.style.opacity || '0')
      const next = cur + (target - cur) * Math.min(1, dt * 8)
      el.style.opacity = next.toFixed(3)
      el.style.pointerEvents = next > 0.5 && selectable ? 'auto' : 'none'
      el.style.transform = `translate(-50%, -100%) scale(${0.92 + 0.08 * next})`
    }
  })

  const handlers = selectable && onSelect ? {
    onClick: (ev) => { ev.stopPropagation(); onSelect(id) },
    onPointerOver: (ev) => { ev.stopPropagation(); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { document.body.style.cursor = '' },
  } : {}

  return (
    <group ref={group} userData={ud} position={track ? undefined : position} rotation={track ? undefined : rotation}
      quaternion={track ? undefined : quaternion} {...handlers}>
      {children}
      {name && (
        <Html position={labelOffset} zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={labelEl} style={{ opacity: 0, transform: 'translate(-50%, -100%)', transformOrigin: 'bottom center' }}
            onClick={() => onSelect && onSelect(id)}
            className={`select-none whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-left shadow-lg backdrop-blur cursor-pointer transition-colors ${
              selectedId === id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white/90 border-brand-100 text-brand-900'}`}>
            <p className="text-[11px] sm:text-xs font-semibold leading-tight">{name}</p>
            {sub && <p className={`text-[10px] leading-tight mt-0.5 ${selectedId === id ? 'text-brand-100' : 'text-gray-500'}`}>{sub}</p>}
          </div>
        </Html>
      )}
    </group>
  )
}
