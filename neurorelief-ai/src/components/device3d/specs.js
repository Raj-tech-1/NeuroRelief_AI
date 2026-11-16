// Device 3D Explorer: component facts, belt layers and the Working Simulation timeline.
// English only by design (this feature is not translated).
// Dimensions are the project's own hardware specs. Where something is not specified we say so
// instead of inventing values; every number the simulation shows is illustrative.

export const DISCLAIMER =
  'Educational prototype demonstration. This is not a clinically validated medical-device simulation, ' +
  'it is not connected to any physical hardware, and all values shown are illustrative.'

export const SYSTEMS = {
  heating: { name: 'ESP32-controlled 5 V heating subsystem (our prototype)', short: 'Heating system (our prototype)' },
  tens: { name: 'Commercial two-channel TENS device (separate unit)', short: 'Commercial TENS unit (separate device)' },
}

// group: which subsystem the part belongs to. inAssembly: shown in the wearable/simulation scene.
export const COMPONENTS = [
  {
    id: 'belt', name: 'Adjustable wearable belt', group: 'heating', inAssembly: true,
    dims: '100 mm wide × 900 mm long',
    purpose: 'Holds the heating pad, temperature sensor and fabric layers together. The elastic strap closes with Velcro so the fit can be adjusted.',
    specs: [['Width', '100 mm'], ['Length', '900 mm'], ['Closure', 'Elastic strap with Velcro'], ['Layers', '7 (see Layer Exploded View)']],
  },
  {
    id: 'pad', name: '5 V silicone heating pad', group: 'heating', inAssembly: true,
    dims: '50 × 100 × 1.5 mm',
    purpose: 'Produces the warmth of the heating subsystem. It sits in a pocket inside the belt layers.',
    specs: [['Size', '50 × 100 mm'], ['Thickness', '1.5 mm'], ['Supply', '5 V heating subsystem'], ['Location', 'Inside the belt layers']],
  },
  {
    id: 'sensor', name: 'DS18B20 temperature sensor', group: 'heating', inAssembly: true,
    dims: '6 mm diameter × 30 mm probe',
    purpose: 'Digital temperature probe attached to the heating pad. The ESP32 reads it to monitor the pad (the explorer only shows simulated values).',
    specs: [['Probe', '6 mm × 30 mm'], ['Type', 'Digital temperature sensor (1-Wire)'], ['Reads by', 'ESP32 controller'], ['Location', 'Attached to the heating pad']],
  },
  {
    id: 'esp32', name: 'ESP32 NodeMCU-32S', group: 'heating', inAssembly: true,
    dims: '51 × 28 × 13 mm',
    purpose: 'Microcontroller for the heating subsystem: reads the temperature sensor and switches the heating pad through the MOSFET.',
    specs: [['Size', '51 × 28 × 13 mm'], ['Role', 'Heating controller'], ['Location', 'Electronics pouch beside the belt'], ['TENS link', 'None (TENS is a separate device)']],
  },
  {
    id: 'mosfet', name: 'IRLZ44N MOSFET', group: 'heating', inAssembly: true,
    dims: '10 × 16 × 4.5 mm (TO-220 body)',
    purpose: 'Logic-level N-channel MOSFET that lets the ESP32 switch the heating pad on and off.',
    specs: [['Size', '10 × 16 × 4.5 mm'], ['Package', 'TO-220'], ['Type', 'Logic-level N-channel MOSFET'], ['Role', 'Switches the heating pad']],
  },
  {
    id: 'resistors', name: 'Resistors', group: 'heating', inAssembly: true,
    dims: 'Small through-hole parts',
    purpose: 'Supporting resistors in the control circuit. Their values and exact wiring are not shown in this visualisation.',
    specs: [['Type', 'Through-hole resistors'], ['Values', 'Per our circuit design (not shown)'], ['Location', 'Perfboard in the electronics pouch']],
  },
  {
    id: 'terminal', name: 'Screw terminal block', group: 'heating', inAssembly: true,
    dims: 'Board-mounted terminal',
    purpose: 'Gives secure, removable wire connections on the perfboard.',
    specs: [['Type', 'PCB screw terminal'], ['Location', 'Perfboard in the electronics pouch']],
  },
  {
    id: 'fuse', name: 'Thermal fuse', group: 'heating', inAssembly: true,
    dims: 'Small axial part',
    purpose: 'One-time over-temperature cut-off for the heating subsystem. Its rating is set by the selected part and is not shown here. Placement in this model is illustrative.',
    specs: [['Type', 'Thermal cut-off fuse'], ['Rating', 'Per selected part (not shown)'], ['Placement', 'Illustrative']],
  },
  {
    id: 'perfboard', name: 'Perfboard', group: 'heating', inAssembly: true,
    dims: '50 × 70 × 2 mm',
    purpose: 'Permanent soldered board that carries the ESP32 and heating-control parts inside the electronics pouch.',
    specs: [['Size', '50 × 70 × 2 mm'], ['Location', 'Electronics pouch']],
  },
  {
    id: 'breadboard', name: 'Breadboard', group: 'heating', inAssembly: false,
    dims: '165 × 55 × 10 mm',
    purpose: 'Solderless board for bench prototyping. At 165 mm it does not fit the 80 × 60 × 30 mm pouch, so the wearable layout uses the perfboard.',
    specs: [['Size', '165 × 55 × 10 mm'], ['Use', 'Bench prototyping'], ['In wearable', 'No (perfboard used instead)']],
  },
  {
    id: 'enclosure', name: 'Electronics pouch & enclosure', group: 'heating', inAssembly: true,
    dims: '80 × 60 × 30 mm internal space',
    purpose: 'Protects the controller electronics. It is attached beside the belt and never sits underneath the heating pad.',
    specs: [['Internal space', '80 × 60 × 30 mm'], ['Position', 'Beside the belt, away from the pad'], ['Contents', 'Perfboard, ESP32, MOSFET, resistors, terminal, fuse']],
  },
  {
    id: 'usb', name: 'USB power cable', group: 'heating', inAssembly: true,
    dims: 'USB cable',
    purpose: 'Carries 5 V from the external power bank to the heating subsystem electronics.',
    specs: [['Supply', '5 V USB'], ['From', 'Mi Power Bank 3i'], ['To', 'Electronics pouch (heating subsystem only)']],
  },
  {
    id: 'powerbank', name: 'Mi Power Bank 3i', group: 'heating', inAssembly: true,
    dims: '150 × 74 × 27 mm',
    purpose: 'External 5 V USB supply for the heating subsystem. It stays outside the belt in its own pocket or pouch.',
    specs: [['Size', '150 × 74 × 27 mm'], ['Capacity', '20000 mAh'], ['Output used', '5 V USB'], ['Position', 'Separate pocket, outside the belt']],
  },
  {
    id: 'tens', name: 'Commercial 2-channel TENS unit', group: 'tens', inAssembly: true,
    dims: 'Approx. 100 × 60 × 30 mm (verify actual unit)',
    purpose: 'A separate, commercially made TENS device with its own power and controls. It is not electrically connected to the ESP32 or the heating circuit.',
    specs: [['Size', 'Approx. 100 × 60 × 30 mm (verify)'], ['Channels', '2'], ['Power', 'Its own internal supply'], ['Link to heating system', 'None']],
  },
  {
    id: 'electrodes', name: 'TENS electrode pads (× 4)', group: 'tens', inAssembly: true,
    dims: '50 × 50 mm each',
    purpose: 'The four pads supplied with the commercial TENS unit. Use them only as the TENS manufacturer instructs; electrodes do not work through clothing or the belt.',
    specs: [['Size', '50 × 50 mm each'], ['Quantity', '4 (2 per channel)'], ['Connects to', 'Commercial TENS unit only']],
  },
  {
    id: 'leads', name: 'TENS lead wires', group: 'tens', inAssembly: true,
    dims: 'Two channel leads',
    purpose: 'Connect the commercial TENS unit to its electrode pads. Each channel lead serves two pads.',
    specs: [['Channels', '2'], ['Pads per channel', '2'], ['Connects to', 'TENS unit and its pads only']],
  },
]

export const COMPONENT_BY_ID = Object.fromEntries(COMPONENTS.map(c => [c.id, c]))

// Listed outermost (1) to base strap (7), as specified for the prototype.
export const LAYERS = [
  { id: 'outer', name: 'Outer fabric', color: '#f3c6d7', desc: 'Outer cover of the belt.' },
  { id: 'cotton', name: 'Cotton layer', color: '#fbf3ea', desc: 'Soft cotton layer beneath the outer fabric.' },
  { id: 'pad', name: 'Silicone heating pad', color: '#e8622c', desc: '5 V pad, 50 × 100 × 1.5 mm, held inside the belt.' },
  { id: 'sensor', name: 'DS18B20 sensor', color: '#9aa3b2', desc: '6 mm × 30 mm probe attached to the heating pad.' },
  { id: 'felt', name: 'Felt / foam insulation', color: '#c9b8de', desc: 'Insulating layer in the stack.' },
  { id: 'inner', name: 'Inner cotton layer', color: '#fffaf3', desc: 'Inner cotton layer.' },
  { id: 'strap', name: 'Elastic Velcro belt', color: '#4b4458', desc: 'Adjustable elastic strap, 100 mm wide, with Velcro closure.' },
]

// ---------- Working Simulation timeline (seconds at 1× speed) ----------
export const STAGES = [
  {
    id: 'assemble', name: 'Assemble', start: 0, end: 20,
    title: 'Stage 1 — Component assembly',
    text: 'Every part starts separated. The belt layers come together, the heating pad and DS18B20 sensor move into the belt, the controller parts move into the side pouch, and the power bank and the separate TENS kit are placed on their own.',
  },
  {
    id: 'power', name: 'Power On', start: 20, end: 27,
    title: 'Stage 2 — Power connection',
    text: 'The USB cable connects the external power bank to the electronics pouch. Red pulses show the heating subsystem power path (5 V). The TENS unit is not part of this path.',
  },
  {
    id: 'sense', name: 'Temperature Sensing', start: 27, end: 34,
    title: 'Stage 3 — Temperature sensing',
    text: 'The outer layers fade so the DS18B20 probe is visible. Lavender pulses show temperature data travelling to the ESP32. The reading on screen is SIMULATED.',
  },
  {
    id: 'heat', name: 'Heating Activation', start: 34, end: 42,
    title: 'Stage 4 — Heating activation',
    text: 'The ESP32 switches the pad through the MOSFET and the pad glows orange while heat waves spread across it. The sensor feedback loop keeps running. All values are illustrative.',
  },
  {
    id: 'tens', name: 'TENS Activation', start: 42, end: 50,
    title: 'Stage 5 — Separate TENS activation',
    text: 'The commercial TENS unit, a separate device with its own power, connects its two channel leads to its four electrode pads. Blue pulses show its conceptual signal path. Nothing links it to the ESP32 or the belt.',
  },
  {
    id: 'complete', name: 'Combined Operation', start: 50, end: 58,
    title: 'Stage 6 — Complete system',
    text: 'The assembled heating belt, side electronics pouch, external power bank and the separate TENS system are shown together. Both run independently.',
  },
]
export const SIM_END = STAGES[STAGES.length - 1].end
export const ASSEMBLED_T = STAGES[1].start // everything is in place at this time

export function stageIndexAt(t) {
  for (let i = STAGES.length - 1; i >= 0; i--) if (t >= STAGES[i].start) return i
  return 0
}

// Captions shown while individual parts move during Stage 1 [start, end, text]
export const ASSEMBLY_STEPS = [
  [0, 1.5, 'All hardware components, separated'],
  [1.5, 5.2, 'Belt layers assembling: elastic strap, inner cotton, felt insulation'],
  [5.2, 6.8, 'Positioning the DS18B20 sensor'],
  [6.8, 8.6, 'Placing the silicone heating pad inside the belt'],
  [8.6, 10.6, 'Closing the belt: cotton layer and outer fabric'],
  [10.6, 16.6, 'Moving the perfboard, ESP32, MOSFET, resistors, terminal and fuse into the side pouch'],
  [16.6, 18, 'External power bank placed in its own pocket'],
  [18, 20, 'Separate commercial TENS unit and four electrode pads'],
]
