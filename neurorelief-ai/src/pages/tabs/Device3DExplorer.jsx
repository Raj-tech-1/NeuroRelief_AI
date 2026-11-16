import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Stage3D, { webglAvailable } from '../../components/device3d/Stage3D'
import SystemScene, { shotAt } from '../../components/device3d/SystemScene'
import LayerScene from '../../components/device3d/LayerScene'
import ComponentViewer from '../../components/device3d/ComponentViewer'
import {
  XIcon, DisclaimerCard, ViewToolbar, DetailsPanel, FlowLegend, SystemBadge, VIEWPORT_BG,
} from '../../components/device3d/ui'
import {
  COMPONENTS, COMPONENT_BY_ID, LAYERS, STAGES, SIM_END, ASSEMBLY_STEPS, stageIndexAt, DISCLAIMER,
} from '../../components/device3d/specs'

// Device 3D Explorer: an educational, offline 3D visualisation of the NeuroRelief prototype.
// English only by design. Nothing here talks to hardware or to the backend.

const TABS = [
  { id: 'wearable', label: 'Wearable View', icon: 'cube' },
  { id: 'components', label: 'Component View', icon: 'gear' },
  { id: 'layers', label: 'Layer Exploded View', icon: 'layers' },
  { id: 'simulation', label: 'Working Simulation', icon: 'play' },
]

const shot = (key, target, dir, r) => ({ key, target, dir, r })
const WEARABLE_HOME = shot('wear', [9, 4, 3], [0.35, 0.55, 1], 24)
const ASSEMBLY_HOME = shot('all', [-2, 5, 2], [0, 0.6, 1], 40)
const ISO_HOME = shot('iso', [0, 3, 0], [0.7, 0.55, 1], 7.5)
const LAYER_HOME = shot('layers', [-2.5, 8, 0], [0.75, 0.5, 1], 19)
const STATIC_CLOCK = { current: SIM_END, fx: 0 }

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function Viewport({ className = '', children }) {
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-brand-100 shadow-sm ${VIEWPORT_BG} ${className}`}>
      {children}
    </div>
  )
}

// Calls api.focus once the canvas has mounted and the object exists (the 3D scene can take a moment to start).
function focusWhenReady(api, getObject, extra) {
  let tries = 0
  let id = 0
  const attempt = () => {
    const obj = getObject()
    if (api.current && obj) { api.current.focus(obj, extra); return }
    if (tries++ < 80) id = setTimeout(attempt, 60)
  }
  id = setTimeout(attempt, 30)
  return () => clearTimeout(id)
}

function useViewControls() {
  const api = useRef(null)
  const [rotating, setRotating] = useState(false)
  return {
    api,
    rotating,
    toolbarProps: {
      rotating,
      onRotate: () => { const on = !rotating; api.current?.setAutoRotate(on); setRotating(on) },
      onZoomIn: () => api.current?.zoom(0.75),
      onZoomOut: () => api.current?.zoom(1.33),
      onReset: () => { api.current?.reset(); setRotating(false) },
    },
  }
}

// ============================== A. Wearable View ==============================
function WearableTab() {
  const [selected, setSelected] = useState('belt')
  const [labels, setLabels] = useState(true)
  const registry = useMemo(() => new Map(), [])
  const { api, toolbarProps } = useViewControls()
  const onSelect = useCallback((id) => setSelected(id), [])

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
      <Viewport className="h-[420px] sm:h-[520px] lg:h-[600px]">
        <div className="absolute left-4 top-3 z-10 pointer-events-none">
          <h2 className="text-lg sm:text-xl font-bold text-brand-900">Wearable View</h2>
          <p className="text-xs sm:text-sm text-gray-600">Assembled heating belt, side pouch and external power bank</p>
        </div>
        <button onClick={() => setLabels(l => !l)} aria-pressed={labels}
          className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-xl bg-white/90 border border-brand-100 px-3 py-1.5 text-xs font-medium text-brand-800 shadow-sm hover:bg-brand-50">
          <XIcon name="tag" size={16} /> {labels ? 'Hide labels' : 'Show labels'}
        </button>
        <ViewToolbar {...toolbarProps} />
        <Stage3D apiRef={api} homeShot={WEARABLE_HOME} onPointerMissed={() => setSelected(null)}>
          <SystemScene clock={STATIC_CLOCK} showTens={false} selectedId={selected} labels={labels ? 'all' : 'none'}
            onSelect={onSelect} registry={registry} />
        </Stage3D>
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-full bg-white/85 px-3 py-1 text-[11px] text-gray-600 shadow-sm pointer-events-none">
          Click a part for details · drag to rotate · scroll or pinch to zoom
        </p>
      </Viewport>
      <div className="space-y-3">
        <DetailsPanel id={selected} onFocus={selected ? () => api.current?.focus(registry.get(selected)) : null} />
        <div className="rounded-2xl border border-brand-100 bg-white/80 p-4 text-[13px] text-gray-600 space-y-1.5">
          <p className="font-semibold text-gray-900">Placement rules shown</p>
          <p>• The electronics pouch sits beside the belt, never under the heating pad.</p>
          <p>• The power bank stays outside the belt in its own pocket.</p>
          <p>• Outer fabric layers are drawn semi-transparent so the pad is visible.</p>
        </div>
      </div>
    </div>
  )
}

// ============================== B. Component View ==============================
function ComponentsTab() {
  const [selected, setSelected] = useState('esp32')
  const [mode, setMode] = useState('isolated')
  const [scale, setScale] = useState(1)
  const registry = useMemo(() => new Map(), [])
  const { api, toolbarProps } = useViewControls()
  const comp = COMPONENT_BY_ID[selected]
  const inAssembly = comp?.inAssembly
  const view = inAssembly ? mode : 'isolated'
  const onSelect = useCallback((id) => setSelected(id), [])

  // In assembly mode, glide the camera to the selected part
  useEffect(() => {
    if (view !== 'assembly') return
    return focusWhenReady(api, () => registry.get(selected), 1.6)
  }, [selected, view, api, registry])

  // Isolated mode: frame the model once it has been scaled to fit
  const isoObject = useRef(null)
  const onReady = useCallback((obj) => { isoObject.current = obj }, [])
  useEffect(() => {
    if (view !== 'isolated') return
    return focusWhenReady(api, () => isoObject.current, 1.0)
  }, [selected, view, api])

  const groups = [
    ['heating', COMPONENTS.filter(c => c.group === 'heating')],
    ['tens', COMPONENTS.filter(c => c.group === 'tens')],
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-100 bg-white/90 p-3 space-y-2">
        {groups.map(([g, list]) => (
          <div key={g} className="flex flex-wrap items-center gap-1.5">
            <SystemBadge group={g} />
            {list.map(c => (
              <button key={c.id} onClick={() => setSelected(c.id)} aria-pressed={selected === c.id}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  selected === c.id ? 'bg-brand-600 border-brand-600 text-white shadow' : 'bg-white border-brand-100 text-gray-700 hover:bg-brand-50'}`}>
                {c.name}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <Viewport className="h-[400px] sm:h-[480px] lg:h-[540px]">
          <div className="absolute left-4 top-3 z-10 pointer-events-none max-w-[60%]">
            <h2 className="text-lg sm:text-xl font-bold text-brand-900 leading-tight">{comp?.name}</h2>
            <p className="text-xs sm:text-sm text-gray-600">{view === 'isolated' ? 'Individual component' : 'Highlighted in the full assembly'}</p>
          </div>
          <div className="absolute right-3 top-3 z-10 flex rounded-xl bg-white/90 border border-brand-100 p-0.5 shadow-sm text-xs font-medium">
            {['isolated', 'assembly'].map(m => (
              <button key={m} onClick={() => setMode(m)} disabled={m === 'assembly' && !inAssembly}
                className={`rounded-lg px-3 py-1.5 transition disabled:opacity-40 ${view === m ? 'bg-brand-600 text-white' : 'text-brand-800 hover:bg-brand-50'}`}>
                {m === 'isolated' ? 'Isolated' : 'In assembly'}
              </button>
            ))}
          </div>
          <ViewToolbar {...toolbarProps} />
          {view === 'isolated' ? (
            <Stage3D key="iso" apiRef={api} homeShot={ISO_HOME} minDistance={2}>
              <ComponentViewer id={selected} spin={!toolbarProps.rotating} onScale={setScale} onReady={onReady} />
            </Stage3D>
          ) : (
            <Stage3D key="asm" apiRef={api} homeShot={ASSEMBLY_HOME} onPointerMissed={() => {}}>
              <SystemScene clock={STATIC_CLOCK} selectedId={selected} dimOthers labels="none" onSelect={onSelect} registry={registry} />
            </Stage3D>
          )}
          {view === 'isolated' && (
            <p className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-full bg-white/85 px-3 py-1 text-[11px] text-gray-600 shadow-sm pointer-events-none">
              {scale > 1.3 ? `Enlarged about ×${scale.toFixed(scale < 10 ? 1 : 0)} to show detail · ` : scale < 0.77 ? 'Scaled down to fit · ' : ''}Real size: {comp?.dims}
            </p>
          )}
        </Viewport>
        <DetailsPanel id={selected}
          note={!inAssembly ? 'Not part of the wearable assembly, so it cannot be highlighted there.' : null} />
      </div>
    </div>
  )
}

// ============================== C. Layer Exploded View ==============================
function LayersTab() {
  const [explode, setExplode] = useState(0.85)
  const [selected, setSelected] = useState('pad')
  const { api, toolbarProps } = useViewControls()
  const layer = LAYERS.find(l => l.id === selected)
  const idx = LAYERS.findIndex(l => l.id === selected)
  const linked = selected === 'pad' ? 'pad' : selected === 'sensor' ? 'sensor' : selected === 'strap' ? 'belt' : null

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="space-y-3">
        <Viewport className="h-[400px] sm:h-[480px] lg:h-[540px]">
          <div className="absolute left-4 top-3 z-10 pointer-events-none">
            <h2 className="text-lg sm:text-xl font-bold text-brand-900">Layer Exploded View</h2>
            <p className="text-xs sm:text-sm text-gray-600">A 200 mm section of the belt, 100 mm wide</p>
          </div>
          <ViewToolbar {...toolbarProps} />
          <Stage3D apiRef={api} homeShot={LAYER_HOME} minDistance={4} maxDistance={80}>
            <LayerScene explodeTarget={explode} selected={selected} onSelect={setSelected} />
          </Stage3D>
        </Viewport>
        <div className="rounded-2xl border border-brand-100 bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button onClick={() => setExplode(0)} className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 hover:bg-brand-100">Assemble</button>
          <label className="flex-1 flex items-center gap-3 text-sm text-gray-700">
            <span className="whitespace-nowrap">Assembled</span>
            <input type="range" min="0" max="1" step="0.01" value={explode} onChange={e => setExplode(Number(e.target.value))}
              className="flex-1 accent-brand-600" aria-label="Layer separation" />
            <span className="whitespace-nowrap">Exploded</span>
          </label>
          <button onClick={() => setExplode(1)} className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">Disassemble</button>
        </div>
      </div>
      <div className="space-y-3">
        <ol className="rounded-2xl border border-brand-100 bg-white p-2">
          {LAYERS.map((l, i) => (
            <li key={l.id}>
              <button onClick={() => setSelected(l.id)} aria-pressed={selected === l.id}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${selected === l.id ? 'bg-brand-100 text-brand-900' : 'hover:bg-brand-50 text-gray-700'}`}>
                <span className="w-6 h-6 shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span className="w-3 h-3 shrink-0 rounded-sm border border-black/10" style={{ background: l.color }} />
                <span className="font-medium">{l.name}</span>
              </button>
            </li>
          ))}
        </ol>
        {layer && (
          <div className="rounded-2xl border border-brand-100 bg-white p-4">
            <p className="text-xs font-semibold text-brand-600">Layer {idx + 1} of 7</p>
            <h3 className="text-lg font-bold text-brand-900">{layer.name}</h3>
            <p className="mt-1 text-sm text-gray-700">{layer.desc}</p>
            {linked && <p className="mt-2 text-xs text-gray-500">{COMPONENT_BY_ID[linked].purpose}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================== D. Working Simulation ==============================
function useClockValue(clock, select) {
  const subscribe = useCallback((cb) => { clock.listeners.add(cb); return () => clock.listeners.delete(cb) }, [clock])
  return useSyncExternalStore(subscribe, () => select(clock))
}

function SimulationTab() {
  const clock = useMemo(() => ({ current: 0, fx: 0, playing: false, speed: 1, listeners: new Set(), last: 0 }), [])
  const emit = useCallback(() => clock.listeners.forEach(f => f()), [clock])
  const onTick = useCallback(() => {
    const now = performance.now()
    if (now - clock.last > 90) { clock.last = now; emit() }
  }, [clock, emit])
  const t = useClockValue(clock, c => Math.round(c.current * 10) / 10)
  const playing = useClockValue(clock, c => c.playing)
  const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState(null)
  const [labels, setLabels] = useState(true)
  const [cinematic, setCinematic] = useState(true)
  const autoCamRef = useRef(true)
  const registry = useMemo(() => new Map(), [])
  const { api, toolbarProps } = useViewControls()
  const shotRef = useMemo(() => ({ get current() { return shotAt(clock.current) } }), [clock])
  const stage = stageIndexAt(t)
  const onSelect = useCallback((id) => setSelected(id), [])

  const play = useCallback(() => { clock.playing = true; emit() }, [clock, emit])
  const pause = useCallback(() => { clock.playing = false; emit() }, [clock, emit])
  const goStage = useCallback((i) => {
    const s = STAGES[Math.max(0, Math.min(STAGES.length - 1, i))]
    clock.current = s.start + 0.001
    clock.playing = true
    api.current?.reset()
    emit()
  }, [clock, emit, api])
  const reset = useCallback(() => {
    clock.current = 0
    clock.fx = 0
    clock.playing = false
    setSelected(null)
    toolbarProps.onReset()
    emit()
  }, [clock, emit, toolbarProps])

  // Start the assembly automatically when the tab opens (unless the user prefers reduced motion)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const id = setTimeout(() => { clock.playing = true; emit() }, 700)
    return () => clearTimeout(id)
  }, [clock, emit])

  useEffect(() => { clock.speed = speed }, [clock, speed])
  useEffect(() => { autoCamRef.current = cinematic }, [cinematic])

  const scene = useMemo(() => (
    <SystemScene clock={clock} effects selectedId={selected} labels={labels ? 'all' : 'active'}
      onSelect={onSelect} registry={registry} onTick={onTick} />
  ), [clock, selected, labels, onSelect, registry, onTick])

  const caption = stage === 0
    ? (ASSEMBLY_STEPS.find(([a, b]) => t >= a && t < b) || ASSEMBLY_STEPS[ASSEMBLY_STEPS.length - 1])[2]
    : STAGES[stage].title.replace(/^Stage \d — /, '')
  const finished = t >= SIM_END - 0.05
  const pct = (t / SIM_END) * 100

  return (
    <div className="space-y-3">
      <Viewport className="h-[460px] sm:h-[560px] lg:h-[640px]">
        <div className="absolute left-4 top-3 z-10 pointer-events-none max-w-[55%] md:max-w-[50%]">
          <h2 className="text-lg sm:text-2xl font-bold text-brand-900">Working Simulation</h2>
          <p className="text-xs sm:text-sm text-gray-600">All components assembling and working together (3D view)</p>
        </div>
        <FlowLegend />
        <ViewToolbar {...toolbarProps}
          extra={
            <button onClick={() => setCinematic(c => !c)} aria-pressed={cinematic} title="Cinematic camera follows each stage"
              className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[10px] font-medium hover:bg-brand-50 ${cinematic ? 'bg-brand-100 text-brand-800' : 'text-gray-700'}`}>
              <XIcon name="camera" /> <span className="hidden sm:block">Auto cam</span>
            </button>
          } />
        <Stage3D apiRef={api} shotRef={shotRef} homeShot={ASSEMBLY_HOME} autoCamRef={autoCamRef}>
          {scene}
        </Stage3D>

        {/* caption + simulated badge */}
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-2 pointer-events-none">
          <div className="rounded-2xl bg-white/90 backdrop-blur border border-brand-100 shadow-sm px-3 py-2 max-w-xl">
            <p className="text-[10px] font-bold tracking-wider text-brand-600">STAGE {stage + 1} OF 6 · {STAGES[stage].name.toUpperCase()}</p>
            <p key={caption} className="text-sm font-semibold text-gray-900">{caption}</p>
          </div>
          <p className="self-start sm:self-auto rounded-full bg-gray-900/80 text-white text-[10px] font-semibold px-3 py-1">
            EDUCATIONAL DEMO · NOT CONNECTED TO HARDWARE
          </p>
        </div>

        {selected && (
          <div className="hidden md:block absolute right-3 top-32 z-20 w-[290px]">
            <DetailsPanel id={selected} compact onClose={() => setSelected(null)} />
          </div>
        )}
      </Viewport>

      {/* Stage stepper */}
      <div className="rounded-2xl border border-brand-100 bg-white p-2 overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {STAGES.map((s, i) => (
            <button key={s.id} onClick={() => goStage(i)} aria-current={stage === i ? 'step' : undefined}
              className={`flex-1 min-w-[150px] flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                stage === i ? 'bg-brand-600 text-white shadow' : t >= s.end ? 'bg-brand-50 text-brand-800 hover:bg-brand-100' : 'text-gray-600 hover:bg-brand-50'}`}>
              <span className={`w-6 h-6 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${
                stage === i ? 'bg-white text-brand-700' : 'bg-brand-100 text-brand-700'}`}>{i + 1}</span>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Transport controls */}
      <div className="rounded-2xl border border-brand-100 bg-white p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {playing ? (
            <button onClick={pause} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-brand-700">
              <XIcon name="pause" size={18} /> Pause
            </button>
          ) : (
            <button onClick={finished ? () => { reset(); setTimeout(play, 50) } : play}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-brand-700">
              <XIcon name="play" size={18} /> {finished ? 'Replay' : t > 0 ? 'Resume' : 'Play Simulation'}
            </button>
          )}
          <button onClick={() => goStage(stage - 1)} disabled={stage === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-40">
            <XIcon name="prev" size={16} /> <span className="hidden sm:inline">Previous Stage</span><span className="sm:hidden">Prev</span>
          </button>
          <button onClick={() => goStage(stage + 1)} disabled={stage === STAGES.length - 1}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-40">
            <span className="hidden sm:inline">Next Stage</span><span className="sm:hidden">Next</span> <XIcon name="next" size={16} />
          </button>
          <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-100">
            <XIcon name="reset" size={16} /> Reset
          </button>
          <button onClick={() => setLabels(l => !l)} aria-pressed={labels}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-100">
            <XIcon name="tag" size={16} /> {labels ? 'Labels on' : 'Labels off'}
          </button>
          <label className="ml-auto flex items-center gap-3 text-sm text-gray-700 w-full sm:w-auto">
            <span className="whitespace-nowrap">Animation speed</span>
            <input type="range" min="0.25" max="2" step="0.25" value={speed} onChange={e => setSpeed(Number(e.target.value))}
              className="flex-1 sm:w-36 accent-brand-600" aria-label="Animation speed" />
            <span className="w-10 text-right font-semibold text-brand-800">{speed.toFixed(2).replace(/0$/, '')}×</span>
          </label>
        </div>
        {/* timeline: click or drag to scrub */}
        <div className="relative">
          <input type="range" min="0" max={SIM_END} step="0.1" value={t}
            onChange={e => { clock.current = Number(e.target.value); emit() }}
            className="w-full accent-brand-600" aria-label="Simulation timeline" />
          <div className="relative h-3 text-[10px] text-gray-400">
            {STAGES.map((s, i) => (
              <span key={s.id} className="absolute -translate-x-1/2" style={{ left: `${(s.start / SIM_END) * 100}%` }}>
                {i === 0 ? '' : '|'}
              </span>
            ))}
          </div>
          <p className="sr-only">{Math.round(pct)}% complete</p>
        </div>
      </div>

      {/* Mobile details for a clicked part */}
      {selected && (
        <div className="md:hidden">
          <DetailsPanel id={selected} compact onClose={() => setSelected(null)} />
        </div>
      )}

      {/* Stage explanation / final summary */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <h3 className="text-base font-bold text-brand-900">{STAGES[stage].title}</h3>
          <p className="mt-1 text-sm text-gray-700 leading-relaxed">{STAGES[stage].text}</p>
          {stage === STAGES.length - 1 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {COMPONENTS.filter(c => c.inAssembly).map(c => (
                <button key={c.id} onClick={() => setSelected(c.id)}
                  className="text-left rounded-xl border border-brand-50 bg-brand-50/40 px-3 py-2 hover:bg-brand-50">
                  <p className="text-[13px] font-semibold text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-600 line-clamp-2">{c.purpose.split('. ')[0]}.</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4 text-[13px] text-gray-600 space-y-2">
          <p className="font-semibold text-gray-900">Two independent systems</p>
          <p><span className="font-semibold text-brand-700">Heating:</span> power bank → USB → ESP32 pouch → heating pad, with DS18B20 feedback. Routing is conceptual, not a wiring diagram.</p>
          <p><span className="font-semibold text-blue-700">TENS:</span> a commercial unit with its own power, its own leads and its own four pads. It never connects to the ESP32, the belt or the heating circuit.</p>
          <p className="text-xs text-gray-500">{DISCLAIMER}</p>
        </div>
      </div>
    </div>
  )
}

// ============================== Page ==============================
export default function Device3DExplorer() {
  const [tab, setTab] = useState('wearable')
  const [gl] = useState(webglAvailable)

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:flex-row xl:items-start gap-3 xl:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-brand-900">3D Device Explorer</h2>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Interactive 3D visualisation of our wearable heating belt and the separate commercial TENS unit. Explore how the parts fit and work together.
          </p>
        </div>
        <div className="xl:max-w-md"><DisclaimerCard /></div>
      </div>

      <div role="tablist" aria-label="Device 3D Explorer views"
        className="grid grid-cols-2 lg:grid-cols-4 gap-1 rounded-2xl border border-brand-100 bg-white p-1 shadow-sm">
        {TABS.map(tb => (
          <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 sm:py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
              tab === tb.id ? 'bg-brand-500 text-white shadow' : 'text-gray-700 hover:bg-brand-50'}`}>
            <XIcon name={tb.icon} size={18} /> {tb.label}
          </button>
        ))}
      </div>

      {!gl ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-6 text-sm text-gray-700">
          3D graphics (WebGL) are not available in this browser, so the explorer cannot be shown. Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration turned on.
        </div>
      ) : (
        <div role="tabpanel">
          {tab === 'wearable' && <WearableTab />}
          {tab === 'components' && <ComponentsTab />}
          {tab === 'layers' && <LayersTab />}
          {tab === 'simulation' && <SimulationTab />}
        </div>
      )}
    </div>
  )
}
