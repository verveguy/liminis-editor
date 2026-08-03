import { describe, it, expect } from 'vitest'
import {
  parseCorrectionsYaml,
  serializeCorrectionsYaml,
  mergeCorrection,
  isExistingCanonical,
  type CorrectionEntry,
} from './correction-yaml'

describe('correction-yaml', () => {
  // =========================================================================
  // parseCorrectionsYaml
  // =========================================================================

  describe('parseCorrectionsYaml()', () => {
    it('returns [] for null input', () => {
      expect(parseCorrectionsYaml(null)).toEqual([])
    })

    it('returns [] for empty string', () => {
      expect(parseCorrectionsYaml('')).toEqual([])
    })

    it('returns [] for whitespace-only string', () => {
      expect(parseCorrectionsYaml('   \n  ')).toEqual([])
    })

    it('returns [] for invalid YAML', () => {
      expect(parseCorrectionsYaml('{ unclosed: [')).toEqual([])
    })

    it('returns [] when corrections key is missing', () => {
      expect(parseCorrectionsYaml('other: value')).toEqual([])
    })

    it('returns [] when corrections is not an array', () => {
      expect(parseCorrectionsYaml('corrections: not-an-array')).toEqual([])
    })

    it('parses a valid same_as entry', () => {
      const yaml = `
corrections:
  - type: same_as
    canonical: Tyto
    aliases:
      - Tito
`
      expect(parseCorrectionsYaml(yaml)).toEqual([
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
      ])
    })

    it('parses multiple entries', () => {
      const yaml = `
corrections:
  - type: same_as
    canonical: Tyto
    aliases:
      - Tito
  - type: same_as
    canonical: Ritesh
    aliases:
      - Ratesh
      - Rithesh
`
      const result = parseCorrectionsYaml(yaml)
      expect(result).toHaveLength(2)
      expect(result[0].canonical).toBe('Tyto')
      expect(result[1].canonical).toBe('Ritesh')
      expect(result[1].aliases).toEqual(['Ratesh', 'Rithesh'])
    })

    it('preserves applied_at field', () => {
      const yaml = `
corrections:
  - type: same_as
    canonical: Tyto
    aliases:
      - Tito
    applied_at: "2026-04-23T12:00:00Z"
`
      const result = parseCorrectionsYaml(yaml)
      expect(result[0].applied_at).toBe('2026-04-23T12:00:00Z')
    })

    it('filters out invalid entries while keeping valid ones', () => {
      const yaml = `
corrections:
  - type: same_as
    canonical: Tyto
    aliases:
      - Tito
  - type: unknown_type
    canonical: X
    aliases:
      - Y
  - canonical: NoType
    aliases: []
`
      const result = parseCorrectionsYaml(yaml)
      expect(result).toHaveLength(1)
      expect(result[0].canonical).toBe('Tyto')
    })

    it('parses retract entry type', () => {
      const yaml = `
corrections:
  - type: retract
    canonical: OldName
    aliases:
      - BadAlias
`
      const result = parseCorrectionsYaml(yaml)
      expect(result[0].type).toBe('retract')
    })

    it('filters out entries with non-string aliases', () => {
      const yaml = `
corrections:
  - type: same_as
    canonical: Tyto
    aliases:
      - Tito
  - type: same_as
    canonical: Bad
    aliases:
      - 123
      - null
`
      const result = parseCorrectionsYaml(yaml)
      expect(result).toHaveLength(1)
      expect(result[0].canonical).toBe('Tyto')
    })

    it('filters out entries with non-string applied_at', () => {
      const yaml = `
corrections:
  - type: same_as
    canonical: Tyto
    aliases:
      - Tito
    applied_at: 12345
`
      const result = parseCorrectionsYaml(yaml)
      expect(result).toHaveLength(0)
    })
  })

  // =========================================================================
  // serializeCorrectionsYaml
  // =========================================================================

  describe('serializeCorrectionsYaml()', () => {
    it('serializes entries and round-trips through parse', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
        { type: 'same_as', canonical: 'Ritesh', aliases: ['Ratesh', 'Rithesh'] },
      ]
      const yaml = serializeCorrectionsYaml(entries)
      const parsed = parseCorrectionsYaml(yaml)
      expect(parsed).toEqual(entries)
    })

    it('serializes empty entries array', () => {
      const yaml = serializeCorrectionsYaml([])
      const parsed = parseCorrectionsYaml(yaml)
      expect(parsed).toEqual([])
    })

    it('preserves applied_at through round-trip', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'], applied_at: '2026-04-23' },
      ]
      const yaml = serializeCorrectionsYaml(entries)
      const parsed = parseCorrectionsYaml(yaml)
      expect(parsed[0].applied_at).toBe('2026-04-23')
    })
  })

  // =========================================================================
  // mergeCorrection
  // =========================================================================

  describe('mergeCorrection()', () => {
    it('appends a new same_as entry when alias is not yet known', () => {
      const result = mergeCorrection([], 'Tito', 'Tyto')
      expect(result).toEqual([{ type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] }])
    })

    it('updates canonical in-place when alias already exists', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'OldCanonical', aliases: ['Tito', 'Teto'] },
      ]
      const result = mergeCorrection(entries, 'Tito', 'Tyto')
      expect(result).toHaveLength(1)
      expect(result[0].canonical).toBe('Tyto')
      expect(result[0].aliases).toEqual(['Tito', 'Teto'])
    })

    it('does not mutate the original entries array', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Old', aliases: ['Alias'] },
      ]
      const original = JSON.stringify(entries)
      mergeCorrection(entries, 'Alias', 'New')
      expect(JSON.stringify(entries)).toBe(original)
    })

    it('does not mutate the original entry aliases array', () => {
      const entry: CorrectionEntry = { type: 'same_as', canonical: 'Old', aliases: ['A'] }
      const entries = [entry]
      mergeCorrection(entries, 'A', 'New')
      expect(entry.aliases).toEqual(['A'])
    })

    it('appends new entry without affecting existing entries', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Ritesh', aliases: ['Ratesh'] },
      ]
      const result = mergeCorrection(entries, 'Tito', 'Tyto')
      expect(result).toHaveLength(2)
      expect(result[0].canonical).toBe('Ritesh')
      expect(result[1].canonical).toBe('Tyto')
    })

    it('preserves applied_at when updating canonical', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Old', aliases: ['A'], applied_at: '2026-01-01' },
      ]
      const result = mergeCorrection(entries, 'A', 'New')
      expect(result[0].applied_at).toBe('2026-01-01')
    })

    it('matches alias by exact string (case-sensitive)', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
      ]
      // Different case — should append, not update
      const result = mergeCorrection(entries, 'tito', 'Tyto')
      expect(result).toHaveLength(2)
    })

    it('does not update retract entry even if alias matches — appends new same_as instead', () => {
      const entries: CorrectionEntry[] = [
        { type: 'retract', canonical: 'OldFact', aliases: ['BadAlias'] },
      ]
      const result = mergeCorrection(entries, 'BadAlias', 'GoodName')
      // retract entry should be untouched; a new same_as is appended
      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('retract')
      expect(result[0].canonical).toBe('OldFact')
      expect(result[1]).toEqual({ type: 'same_as', canonical: 'GoodName', aliases: ['BadAlias'] })
    })
  })

  // =========================================================================
  // isExistingCanonical
  // =========================================================================

  describe('isExistingCanonical()', () => {
    it('returns false for empty entries', () => {
      expect(isExistingCanonical([], 'Tyto')).toBe(false)
    })

    it('returns true when text matches a canonical (exact case)', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
      ]
      expect(isExistingCanonical(entries, 'Tyto')).toBe(true)
    })

    it('returns true when text matches a canonical (case-insensitive)', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
      ]
      expect(isExistingCanonical(entries, 'tyto')).toBe(true)
      expect(isExistingCanonical(entries, 'TYTO')).toBe(true)
    })

    it('returns false when text only appears as an alias, not a canonical', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
      ]
      expect(isExistingCanonical(entries, 'Tito')).toBe(false)
    })

    it('returns true when text matches one of multiple canonicals', () => {
      const entries: CorrectionEntry[] = [
        { type: 'same_as', canonical: 'Tyto', aliases: ['Tito'] },
        { type: 'same_as', canonical: 'Ritesh', aliases: ['Ratesh'] },
      ]
      expect(isExistingCanonical(entries, 'Ritesh')).toBe(true)
    })

    it('returns false when text matches a retract canonical — retract entries do not participate in same_as canonicalization', () => {
      const entries: CorrectionEntry[] = [
        { type: 'retract', canonical: 'OldFact', aliases: ['BadAlias'] },
      ]
      expect(isExistingCanonical(entries, 'OldFact')).toBe(false)
    })
  })
})
