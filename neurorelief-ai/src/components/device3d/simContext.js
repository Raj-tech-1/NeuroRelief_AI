import { createContext, useContext } from 'react'
import { SIM_END } from './specs'

// Shared state for everything inside one 3D canvas. Values that change every frame live in refs
// (timeRef) so animation never triggers React re-renders.
export const SimContext = createContext({
  timeRef: { current: SIM_END },
  effects: false,          // simulated power/data/heat/TENS effects enabled
  selectedId: null,
  dimOthers: false,
  labels: 'all',           // 'all' | 'active' | 'none'
  labelFilter: null,       // optional (t) => ids whose labels may show at sim time t
  onSelect: null,
  registry: null,          // Map(id -> Object3D) for camera focus
})

export function useSim() {
  return useContext(SimContext)
}
