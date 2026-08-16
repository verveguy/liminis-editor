import { useEffect, useRef } from 'react'

/**
 * Keep the editor pane and the raw-markdown pane scrolled to the same place.
 *
 * Proportional scrolling (same fraction of scrollHeight in both) is the obvious
 * approach and is wrong here: rendered height and source height have no fixed
 * relationship. A Mermaid diagram is six source lines and several hundred
 * rendered pixels; a long paragraph is the reverse. On a document like
 * `all-the-things.md` the two panes would drift by whole sections.
 *
 * So this anchors on **headings**, which exist in both panes and in the same
 * order, and interpolates between them. Drift is then bounded within a single
 * section rather than accumulating over the document.
 *
 * Source positions are computed as line-index × line-height, which is exact
 * because the source pane does not wrap — one source line is one visual row.
 * If wrapping is ever re-enabled there, this arithmetic breaks and positions
 * must be measured from real layout again.
 */
export function useScrollSync(editorPaneRef, markdownPreRef, markdown) {
  // The listeners and the observer must not be rebuilt when the document
  // changes — with an editable source pane that is every keystroke, and the
  // churn shows up as scroll jitter. The effect therefore depends only on the
  // refs, and reads the current text through a ref instead.
  const markdownRef = useRef(markdown)
  // Anchor positions live outside the effect too, so a document change can
  // invalidate them without tearing the effect down. Measuring is deferred to
  // the next scroll rather than done here.
  const anchorsRef = useRef(null)
  useEffect(() => {
    markdownRef.current = markdown
    anchorsRef.current = null
  }, [markdown])

  useEffect(() => {
    const pane = editorPaneRef.current
    const pre = markdownPreRef.current
    if (!pane || !pre) return

    function measure() {
      // getBoundingClientRect is viewport-relative; adding scrollTop and
      // subtracting the container's own top converts it to an offset within
      // the scrollable content, which is what scrollTop is measured in.
      const paneOrigin = pane.getBoundingClientRect().top - pane.scrollTop

      const editorY = Array.from(pane.querySelectorAll('[class*="editor-heading-h"]')).map(
        (el) => el.getBoundingClientRect().top - paneOrigin,
      )

      // The source pane is a non-wrapping textarea, so one source line is one
      // visual row and a heading's offset is exact arithmetic. (This would be
      // wrong under `pre-wrap`, where a line can occupy several rows.)
      const style = getComputedStyle(pre)
      const lineHeight = parseFloat(style.lineHeight)
      const paddingTop = parseFloat(style.paddingTop)
      const sourceY = []
      markdownRef.current.split('\n').forEach((line, i) => {
        if (/^#{1,6} /.test(line)) sourceY.push(paddingTop + i * lineHeight)
      })

      // Pair by ordinal. If the counts disagree — a heading inside a fenced
      // code block, say, which the regex sees and the editor does not — the
      // extra tail anchors are dropped rather than mispairing everything after
      // the mismatch.
      const n = Math.min(editorY.length, sourceY.length)
      return n === 0 ? null : { editorY: editorY.slice(0, n), sourceY: sourceY.slice(0, n) }
    }

    /** Map a scroll offset from one pane's anchor set onto the other's. */
    function project(y, from, to, fromMax, toMax) {
      if (y <= from[0]) {
        // Above the first heading: scale within the preamble.
        return from[0] > 0 ? (y / from[0]) * to[0] : 0
      }
      for (let i = 0; i < from.length - 1; i++) {
        if (y < from[i + 1]) {
          const span = from[i + 1] - from[i]
          const fraction = span > 0 ? (y - from[i]) / span : 0
          return to[i] + fraction * (to[i + 1] - to[i])
        }
      }
      // Below the last heading: scale within the remaining tail of each pane.
      const fromTail = fromMax - from[from.length - 1]
      const toTail = toMax - to[to.length - 1]
      const fraction = fromTail > 0 ? (y - from[from.length - 1]) / fromTail : 0
      return to[to.length - 1] + fraction * toTail
    }

    // A sync writes scrollTop on the other pane, which fires its scroll event,
    // which would sync back. The flag holds for one frame, which is enough:
    // the echo arrives in the same frame as the write.
    let syncing = false

    function sync(source, target, key) {
      if (syncing) return
      if (!anchorsRef.current) anchorsRef.current = measure()
      const anchors = anchorsRef.current
      if (!anchors) return

      const from = key === 'editor' ? anchors.editorY : anchors.sourceY
      const to = key === 'editor' ? anchors.sourceY : anchors.editorY
      const fromMax = source.scrollHeight - source.clientHeight
      const toMax = target.scrollHeight - target.clientHeight
      if (fromMax <= 0 || toMax <= 0) return

      const next = project(source.scrollTop, from, to, fromMax, toMax)
      syncing = true
      target.scrollTop = Math.max(0, Math.min(toMax, next))
      requestAnimationFrame(() => {
        syncing = false
      })
    }

    const onEditorScroll = () => sync(pane, pre, 'editor')
    const onPreScroll = () => sync(pre, pane, 'source')

    // Anchors also move when the window resizes and when async content
    // (diagrams, math, images) finishes laying out — neither of which changes
    // the document, so they invalidate here rather than in the effect above.
    const invalidate = () => {
      anchorsRef.current = null
    }

    pane.addEventListener('scroll', onEditorScroll, { passive: true })
    pre.addEventListener('scroll', onPreScroll, { passive: true })
    window.addEventListener('resize', invalidate)

    const observer = new ResizeObserver(invalidate)
    observer.observe(pane)
    observer.observe(pre)

    return () => {
      pane.removeEventListener('scroll', onEditorScroll)
      pre.removeEventListener('scroll', onPreScroll)
      window.removeEventListener('resize', invalidate)
      observer.disconnect()
    }
  }, [editorPaneRef, markdownPreRef])
}
