import { memo, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { SimContext } from './simContext'
import { SIM_END } from './specs'
import {
  BeltModel, HeatingPadModel, SensorModel, ESP32Model, MosfetModel, ResistorsModel, TerminalModel, FuseModel,
  PerfboardModel, BreadboardModel, EnclosureShell, UsbCableModel, PowerBankModel, TensUnitModel, ElectrodeSetModel,
  TensLeadsModel,
} from './models'

const MODELS = {
  belt: BeltModel,
  pad: HeatingPadModel,
  sensor: SensorModel,
  esp32: ESP32Model,
  mosfet: MosfetModel,
  resistors: ResistorsModel,
  terminal: TerminalModel,
  fuse: FuseModel,
  perfboard: PerfboardModel,
  breadboard: BreadboardModel,
  enclosure: EnclosureShell,
  usb: UsbCableModel,
  powerbank: PowerBankModel,
  tens: TensUnitModel,
  electrodes: ElectrodeSetModel,
  leads: TensLeadsModel,
}

// Sensor is modelled along +y; lay it down for display.
const DISPLAY_ROT = { sensor: [0, 0, Math.PI / 2], mosfet: [0, 0.5, 0], tens: [0, -0.35, 0] }

const STATIC_CTX = { timeRef: { current: SIM_END, fx: 0 }, effects: false, selectedId: null, dimOthers: false, labels: 'none', onSelect: null, registry: null }

/** Shows one component alone, scaled to fit, sitting on the floor and slowly turning. Reports its scale. */
function ComponentViewer({ id, spin = true, onScale, onReady }) {
  const outer = useRef()
  const inner = useRef()
  const Model = MODELS[id]

  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    o.scale.setScalar(1)
    i.position.set(0, 0, 0)
    const box = new THREE.Box3().setFromObject(i)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = 10 / Math.max(size.x, size.y, size.z, 0.001)
    i.position.set(-center.x, -box.min.y, -center.z)
    o.scale.setScalar(s)
    onScale?.(s)
    onReady?.(o)
  }, [id, onScale, onReady])

  useFrame((_, delta) => {
    if (spin && outer.current) outer.current.rotation.y += Math.min(delta, 0.1) * 0.35
  })

  if (!Model) return null
  return (
    <SimContext.Provider value={STATIC_CTX}>
      <group ref={outer}>
        <group ref={inner}>
          <group rotation={DISPLAY_ROT[id] || [0, 0, 0]}>
            <Model />
          </group>
        </group>
      </group>
    </SimContext.Provider>
  )
}

export default memo(ComponentViewer)
