/**
 * Wearable Device Service
 * -----------------------
 * Interface for the IoT TENS + Heat therapy wearable.
 * Currently returns simulated device state.
 * 
 * FUTURE (Month 3+):
 * 1. Connect via Web Bluetooth API or WebSocket
 * 2. Microcontroller (ESP32) communicates over BLE
 * 3. Replace mock functions with real BLE/WebSocket calls
 * 
 * Device capabilities (from your report):
 *   - TENS: frequency 2-150Hz, pulse width 50-250μs, adjustable intensity
 *   - Heat: PID-controlled, app-limited to 35-40°C (standard plan 38-39°C)
 *   - Sensors: HRV, skin temperature, motion (accelerometer)
 * 
 * Safety constraints:
 *   - Max TENS intensity: 100 (mapped to safe mA range by hardware)
 *   - Max heat: 40°C and 20 minutes per session (enforced by the app and the backend; the firmware must also
 *     clamp to its own compiled-in cap: see docs/FIRMWARE_SAFETY_CAP.md and backend lib/therapyLimits.js)
 *   - Heat auto-shutoff at the plan's minute limit (max 20 minutes per session)
 */

// Connection state
let deviceConnected = false
let deviceState = {
  battery: 85,
  tens_active: false,
  tens_intensity: 0,
  tens_frequency: 50,
  heat_active: false,
  heat_temperature: 38,
  session_minutes: 0
}

export async function connectDevice() {
  // Future: Use Web Bluetooth API
  // const device = await navigator.bluetooth.requestDevice({
  //   filters: [{ services: ['neurorelief_service_uuid'] }]
  // })
  // const server = await device.gatt.connect()

  return new Promise(resolve => {
    setTimeout(() => {
      deviceConnected = true
      resolve({ connected: true, deviceName: 'NeuroRelief Band v1' })
    }, 1000)
  })
}

export async function getDeviceStatus() {
  if (!deviceConnected) return { connected: false }
  return { connected: true, ...deviceState }
}

export async function setTENSParams(intensity, frequency) {
  // Safety: clamp values
  intensity = Math.max(0, Math.min(100, intensity))
  frequency = Math.max(2, Math.min(150, frequency))

  deviceState.tens_intensity = intensity
  deviceState.tens_frequency = frequency
  deviceState.tens_active = intensity > 0
  return { success: true, ...deviceState }
}

export async function setHeatParams(temperature) {
  // Safety: clamp to safe range
  temperature = Math.max(38, Math.min(42, temperature))

  deviceState.heat_temperature = temperature
  deviceState.heat_active = true
  return { success: true, ...deviceState }
}

export async function startTherapySession(params) {
  const { tens_intensity, tens_frequency, heat_temperature } = params
  await setTENSParams(tens_intensity, tens_frequency)
  await setHeatParams(heat_temperature)
  deviceState.session_minutes = 0
  return { success: true, session_id: 'sess_' + Date.now(), ...deviceState }
}

export async function stopTherapySession() {
  deviceState.tens_active = false
  deviceState.tens_intensity = 0
  deviceState.heat_active = false
  deviceState.session_minutes = 0
  return { success: true }
}

export function disconnectDevice() {
  deviceConnected = false
  return { connected: false }
}
