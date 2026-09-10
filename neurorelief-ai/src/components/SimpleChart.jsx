/**
 * Simple SVG line/bar chart component — no external library needed.
 * Keeps the project lightweight and you can explain every line in viva.
 */

export function LineChart({ data, labels, title, color = '#DB2777', height = 200 }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const w = 500
  const h = height
  const pad = 40
  const plotW = w - pad * 2
  const plotH = h - pad * 2
  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1 || 1)) * plotW,
    y: pad + plotH - ((v - min) / range) * plotH
  }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div>
      {title && <p className="text-sm font-semibold text-gray-800 mb-2">{title}</p>}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: height }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = pad + plotH * (1 - frac)
          const val = Math.round(min + range * frac)
          return (
            <g key={frac}>
              <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#E5E7EB" strokeWidth="1" />
              <text x={pad - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#9CA3AF">{val}</text>
            </g>
          )
        })}
        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Area fill */}
        <path d={`${pathD} L ${points[points.length - 1].x} ${pad + plotH} L ${points[0].x} ${pad + plotH} Z`} fill={color} fillOpacity="0.1" />
        {/* Dots + labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill={color} />
            <circle cx={p.x} cy={p.y} r="6" fill={color} fillOpacity="0.2" />
            {labels && labels[i] && (
              <text x={p.x} y={pad + plotH + 16} textAnchor="middle" fontSize="9" fill="#9CA3AF">{labels[i]}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

export function BarChart({ data, labels, title, colors, height = 200 }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 1)
  const w = 500
  const h = height
  const pad = 40
  const plotW = w - pad * 2
  const plotH = h - pad * 2
  const barW = Math.min(40, (plotW / data.length) * 0.6)
  const gap = plotW / data.length

  const defaultColors = ['#DB2777', '#7C3AED', '#059669', '#EA580C', '#2563EB', '#DC2626']

  return (
    <div>
      {title && <p className="text-sm font-semibold text-gray-800 mb-2">{title}</p>}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: height }}>
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = pad + plotH * (1 - frac)
          const val = Math.round(max * frac)
          return (
            <g key={frac}>
              <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#E5E7EB" strokeWidth="1" />
              <text x={pad - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#9CA3AF">{val}</text>
            </g>
          )
        })}
        {data.map((v, i) => {
          const barH = (v / max) * plotH
          const x = pad + gap * i + (gap - barW) / 2
          const y = pad + plotH - barH
          const color = colors?.[i] || defaultColors[i % defaultColors.length]
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx="4" fill={color} fillOpacity="0.8" />
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="11" fill="#374151" fontWeight="600">{v}</text>
              {labels && labels[i] && (
                <text x={x + barW / 2} y={pad + plotH + 16} textAnchor="middle" fontSize="9" fill="#9CA3AF">{labels[i]}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
