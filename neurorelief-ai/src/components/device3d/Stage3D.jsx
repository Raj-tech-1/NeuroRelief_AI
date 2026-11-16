import { Component, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer } from '@react-three/drei'
import { canvasTexture } from './geometry'

// A "shot" frames a point: { key, target: [x,y,z], dir: [x,y,z], r: radius to fit }.
const v3 = (a) => (a instanceof THREE.Vector3 ? a.clone() : new THREE.Vector3(...a))

// Distance so that a subject of half-width r fills the view horizontally (with some vertical margin).
function fitDistance(camera, r) {
  const tv = Math.tan((camera.fov * Math.PI) / 360)
  const th = tv * camera.aspect
  return Math.max(r / th, (r * 0.62) / tv) * 1.08
}

function shotPose(camera, shot, drift = 0) {
  const target = v3(shot.target)
  const dir = v3(shot.dir).normalize()
  if (drift) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), drift)
  const pos = target.clone().add(dir.multiplyScalar(fitDistance(camera, shot.r)))
  return { pos, target }
}

/**
 * Camera rig. In "auto" mode it glides the camera to the current shot (cinematic camera).
 * Any manual orbit/zoom takes over until the shot changes or the view is reset.
 */
function CameraRig({ apiRef, shotRef, homeShot, autoCamRef }) {
  const { camera, controls, clock } = useThree()
  const goal = useRef(null)
  const user = useRef(false)
  const lastKey = useRef(null)
  const first = useRef(true)

  useEffect(() => {
    if (!controls) return
    const onStart = () => { user.current = true; goal.current = null }
    controls.addEventListener('start', onStart)
    return () => controls.removeEventListener('start', onStart)
  }, [controls])

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      zoom(f) {
        if (!controls) return
        const target = goal.current ? goal.current.target.clone() : controls.target.clone()
        const from = goal.current ? goal.current.pos : camera.position
        const off = from.clone().sub(target).multiplyScalar(f)
        const d = THREE.MathUtils.clamp(off.length(), controls.minDistance || 1, controls.maxDistance || 500)
        off.setLength(d)
        goal.current = { pos: target.clone().add(off), target }
        user.current = true
      },
      reset() {
        if (controls) controls.autoRotate = false
        user.current = false
        goal.current = shotRef?.current ? null : shotPose(camera, homeShot)
      },
      setAutoRotate(on) {
        if (!controls) return
        controls.autoRotate = on
        controls.autoRotateSpeed = 1.1
        if (on) { user.current = true; goal.current = null }
      },
      isAutoRotating() { return !!controls?.autoRotate },
      focus(object, extra = 1.25) {
        if (!object) return
        const box = new THREE.Box3().setFromObject(object)
        if (box.isEmpty()) return
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const dir = camera.position.clone().sub(controls ? controls.target : sphere.center).normalize()
        if (dir.y < 0.25) { dir.y = 0.35; dir.normalize() }
        const r = Math.max(sphere.radius * extra, 3.5)
        goal.current = { pos: sphere.center.clone().add(dir.multiplyScalar(fitDistance(camera, r))), target: sphere.center.clone() }
        user.current = true
      },
      frame(shot) {
        goal.current = shotPose(camera, shot)
        user.current = true
      },
    }
  }, [apiRef, camera, controls, homeShot, shotRef])

  useFrame((_, delta) => {
    if (!controls) return
    const dt = Math.min(delta, 0.1)
    const shot = shotRef?.current
    const auto = !autoCamRef || autoCamRef.current

    if (first.current) {
      const p = shotPose(camera, shot || homeShot)
      camera.position.copy(p.pos)
      controls.target.copy(p.target)
      first.current = false
      lastKey.current = shot?.key
      return
    }

    if (shot && shot.key !== lastKey.current) {
      lastKey.current = shot.key
      if (auto && !controls.autoRotate) { user.current = false; goal.current = null }
    }

    let dest = goal.current
    let k = 1 - Math.exp(-dt * 3.5)
    if (!dest && shot && auto && !user.current) {
      // slow cinematic drift around the subject
      dest = shotPose(camera, shot, Math.sin(clock.elapsedTime * 0.18) * (shot.drift ?? 0.1))
      k = 1 - Math.exp(-dt * 1.5)
    }
    if (dest) {
      camera.position.lerp(dest.pos, k)
      controls.target.lerp(dest.target, k)
      if (goal.current && camera.position.distanceTo(dest.pos) < 0.05) goal.current = null
    }
  })
  return null
}

function Floor() {
  const alpha = useMemo(() => canvasTexture('floor-alpha', 256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.55, '#ffffff')
    g.addColorStop(1, '#000000')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }), [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow userData={{ noHighlight: true }}>
      <circleGeometry args={[95, 64]} />
      <meshStandardMaterial color="#f8f1fb" roughness={0.95} alphaMap={alpha} transparent depthWrite={false} />
    </mesh>
  )
}

class GLBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="text-sm text-gray-600 max-w-sm">The 3D view could not start on this device (WebGL is unavailable or was blocked). Try another browser or enable hardware acceleration.</p>
        </div>
      )
    }
    return this.props.children
  }
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

/** Canvas with lights, local environment lighting (no downloads), floor, orbit controls and camera rig. */
export default function Stage3D({ children, apiRef, shotRef, homeShot, autoCamRef, onPointerMissed, minDistance = 3, maxDistance = 170, floor = true }) {
  return (
    <GLBoundary>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 36, near: 0.3, far: 800, position: [0, 30, 70] }}
        gl={{ antialias: true, alpha: true }} onPointerMissed={onPointerMissed}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05 }}>
        <ambientLight intensity={0.45} color="#fff3fa" />
        <hemisphereLight args={['#ffffff', '#e6d6f2', 0.55]} />
        <directionalLight castShadow position={[18, 42, 28]} intensity={1.7} color="#fffaf5"
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
          shadow-camera-left={-55} shadow-camera-right={55} shadow-camera-top={45} shadow-camera-bottom={-45}
          shadow-camera-near={1} shadow-camera-far={140} />
        <directionalLight position={[-30, 18, -25]} intensity={0.55} color="#d9ccff" />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[0, 12, 6]} scale={[24, 8, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={1.2} position={[-14, 5, -6]} rotation-y={Math.PI / 2} scale={[18, 6, 1]} color="#ffd6ea" />
          <Lightformer form="rect" intensity={1.0} position={[14, 5, -6]} rotation-y={-Math.PI / 2} scale={[18, 6, 1]} color="#dcd2ff" />
          <Lightformer form="ring" intensity={0.8} position={[0, -6, 0]} rotation-x={Math.PI / 2} scale={10} color="#ffffff" />
        </Environment>
        {floor && <Floor />}
        {children}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={minDistance} maxDistance={maxDistance}
          maxPolarAngle={Math.PI * 0.49} />
        <CameraRig apiRef={apiRef} shotRef={shotRef} homeShot={homeShot} autoCamRef={autoCamRef} />
      </Canvas>
    </GLBoundary>
  )
}
