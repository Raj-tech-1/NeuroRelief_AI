import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Print / Save as PDF without a PDF library: the report is rendered into #print-root (a direct child of <body>),
// which is hidden on screen. index.css hides the whole app and shows only #print-root when printing, so the
// browser's own "Save as PDF" produces a clean A4 document (and shapes Hindi/Kannada/Tamil/Telugu correctly).
export function PrintArea({ children }) {
  const [root, setRoot] = useState(null)
  useEffect(() => {
    const el = document.createElement('div')
    el.id = 'print-root'
    document.body.appendChild(el)
    setRoot(el)
    return () => { el.remove() }
  }, [])
  return root ? createPortal(children, root) : null
}

// Opens the browser's print dialog. The page title becomes the suggested PDF file name.
export function printReport(fileTitle) {
  const previous = document.title
  const restore = () => { document.title = previous; window.removeEventListener('afterprint', restore) }
  window.addEventListener('afterprint', restore)
  document.title = fileTitle
  window.print()
}
