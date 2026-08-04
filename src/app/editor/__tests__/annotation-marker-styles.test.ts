/**
 * Every marker class the package *applies* must be a class the package also
 * *styles*.
 *
 * `AnnotationMarkerPlugin` decorates live MarkNode elements with
 * `annotation-mark-<markerStyle>` plus `-active` and `-pulse`, but nothing in
 * the type system ties those names to `styles.css`. The failure is silent and
 * invisible from inside Liminis, whose only kind is `markerStyle: 'none'`: a
 * host enabling the `comment` kind would get working anchors, placement and
 * activation with no visible marker, and no error anywhere to explain it
 * (review finding, @handarbeit-pruefer).
 *
 * The list of marker styles is cross-checked against the union declared in
 * `annotations/types.ts`, so adding a third style without a stylesheet rule
 * fails here rather than shipping an invisible marker.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '..', '..', '..')

const styles = readFileSync(join(srcRoot, 'styles.css'), 'utf8')
const typesSource = readFileSync(join(srcRoot, 'annotations', 'types.ts'), 'utf8')

/** The styles that place a mark. `none` places nothing, so it needs no rule. */
const VISIBLE_MARKER_STYLES = ['highlight', 'squiggle'] as const

describe('annotation marker styling', () => {
  it('declares the marker styles this test knows about, and no others', () => {
    // Guards the list above against drifting from the union it mirrors: a new
    // marker style must be added here, which then forces the rule assertion
    // below to cover it.
    const match = /export type AnnotationMarkerStyle =([^\n]+)/.exec(typesSource)
    expect(match).not.toBeNull()

    const declared = (match?.[1] ?? '')
      .split('|')
      .map((part) => part.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)

    expect(new Set(declared)).toEqual(new Set([...VISIBLE_MARKER_STYLES, 'none']))
  })

  it.each(VISIBLE_MARKER_STYLES)('styles the `%s` marker', (markerStyle) => {
    // The plugin builds the class as `annotation-mark-${markerStyle}`.
    expect(styles).toContain(`.annotation-mark-${markerStyle}`)
  })

  it('styles the active and pulse states the plugin toggles', () => {
    expect(styles).toContain('.annotation-mark-active')
    expect(styles).toContain('.annotation-mark-pulse')
    // The pulse is a scroll-to arrival flash, so it needs the keyframes too.
    expect(styles).toContain('@keyframes annotation-mark-pulse')
  })

  it('overrides the browser default <mark> background rather than layering on it', () => {
    // A UA-styled <mark> is solid yellow. A squiggle marker drawn on top of
    // that reads as a highlight with an underline, not as a squiggle.
    // Collect every base squiggle rule — the selector may be shared with the
    // highlight one, and there are `.dark`/`-active` variants that legitimately
    // set a tint — then assert the base styling zeroes the background.
    const baseSquiggleBodies = [...styles.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector]) => {
        if (!selector.includes('.annotation-mark-squiggle')) return false
        return !selector.includes('.dark') && !selector.includes('annotation-mark-active')
      })
      .map(([, , body]) => body)

    expect(baseSquiggleBodies.length).toBeGreaterThan(0)
    expect(baseSquiggleBodies.join('\n')).toMatch(/background-color:\s*transparent/)
  })

  it('keeps the pulse animation inside the window the plugin allows it', () => {
    // AnnotationMarkerPlugin removes the pulse class after 1400ms; a longer
    // animation would be cut off mid-flash.
    const pulseRule = /\.annotation-mark-pulse\s*\{([^}]*)\}/.exec(styles)
    const duration = /animation:[^;]*?(\d+)ms/.exec(pulseRule?.[1] ?? '')
    expect(duration).not.toBeNull()
    expect(Number(duration?.[1])).toBeLessThanOrEqual(1400)
  })
})
