import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { note, waterScore, WATER_CONFIG_V1, bioRawScore, bioDisplayed, BIO_CONFIG_V1, relativeScore, assertWeights } from '../shared/scores.ts';

describe('note()', () => {
  it('clamps between thresholds, both directions', () => {
    expect(note(49, 60, 38)).toBeCloseTo(50); expect(note(70, 60, 38)).toBe(0); expect(note(20, 60, 38)).toBe(100);
    expect(note(0.65, 0.4, 0.9)).toBeCloseTo(50); expect(note(null, 0, 1)).toBeNull();
  });
});
describe('Score Eau (brief 4C)', () => {
  const best = { lix_init: 30, lix_pros: 30, irr_init: 0, irr_pros: 0, ift_init: 0, ift_pros: 0, cover_init: 60, cover_pros: 60, erosion_pros: 0.05, p_pros: 0 };
  it('weights sum to 100 % and blocks are 40 / 40 / 20', () => {
    assertWeights(WATER_CONFIG_V1); const r = waterScore(best);
    expect(r.score).toBeCloseTo(100); expect(r.blocks.lixiviation).toBeCloseTo(40); expect(r.blocks.consommation).toBeCloseTo(40); expect(r.blocks.autres).toBeCloseTo(20);
  });
  it('"already optimal" rule gives the full note on evolution indicators', () => {
    const r = waterScore(best); const n = Object.fromEntries(r.contributions.map(c => [c.key, c.note]));
    expect(n.lix_evol).toBe(100); expect(n.irr_evol).toBe(100); expect(n.ift_evol).toBe(100); expect(n.cover_evol).toBe(100);
  });
  it('hand-computed irrigating farm', () => {
    // lix 55→44: level (60−44)/22=72.73 → 14.545 ; evol −20 % → 100 → 20
    // irrigation 100→60 mm: none 0 ; volume (120−60)/120=50 → 5 ; evol −40 % / −50 % = 80 → 8
    // IFT 4→3: level 40 → 1.6 ; evol −1/−2 = 50 → 2 ; covers 10→25 %: level 50 → 2 ; evol +15/30 = 50 → 2
    // erosion 0.15 → 50 → 1 ; P 30 → 50 → 1
    const r = waterScore({ lix_init: 55, lix_pros: 44, irr_init: 100, irr_pros: 60, ift_init: 4, ift_pros: 3, cover_init: 10, cover_pros: 25, erosion_pros: 0.15, p_pros: 30 });
    expect(r.blocks.lixiviation).toBeCloseTo(34.545, 2); expect(r.blocks.consommation).toBeCloseTo(13); expect(r.blocks.autres).toBeCloseTo(9.6);
    expect(r.score).toBeCloseTo(57.145, 2); expect(r.completeness).toBeCloseTo(1);
  });
  it('an irrigating farm can never exceed 80 − (volume + evolution shortfall); non-irrigating gets the 40-point block', () => {
    expect(waterScore({ ...best, irr_init: 50, irr_pros: 50 }).blocks.consommation).toBeCloseTo((120 - 50) / 120 * 10);
    expect(waterScore({ ...best, irr_init: 50, irr_pros: 0 }).blocks.consommation).toBeCloseTo(40);
  });
  it('missing data scores 0 but is reported through completeness and a renormalised score', () => {
    const r = waterScore({ lix_init: 30, lix_pros: 30 });
    expect(r.score).toBeCloseTo(40); expect(r.completeness).toBeCloseTo(0.4); expect(r.renormalised).toBeCloseTo(100);
  });
  it('refuses a config whose weights do not sum to 100 %', () => {
    const bad = structuredClone(WATER_CONFIG_V1); bad.items.p_level.weight = 0.05;
    expect(() => waterScore({}, bad)).toThrow(/100 %/);
  });
});
describe('Score Biodiversité (brief 4C)', () => {
  it('weights: 0.50 on starting state (15 indicators), 0.50 on evolution (12 + lever count)', () => {
    const s = (b: string) => BIO_CONFIG_V1.items.filter(i => i.basis === b).reduce((a, i) => a + i.weight, 0);
    expect(s('initial')).toBeCloseTo(0.5); expect(s('evolution')).toBeCloseTo(0.5);
    expect(BIO_CONFIG_V1.items.filter(i => i.basis === 'initial')).toHaveLength(15); expect(BIO_CONFIG_V1.items.filter(i => i.basis === 'evolution')).toHaveLength(13);
  });
  it('raw score = Σ note × weight; stagnation or degradation gives 0 on evolution', () => {
    const r = bioRawScore({ 'ift_total:initial': 2.5, 'ift_total:evolution': -1, 'organic_matter:evolution': -0.2, 'bio_levers:evolution': 5 });
    // IFT initial 50 × .04 = 2 ; IFT evol 50 × .06 = 3 ; MO degradation 0 ; levers capped at 4 → 100 × .05 = 5
    expect(r.raw).toBeCloseTo(10); expect(r.completeness).toBeCloseTo(0.04 + 0.06 + 0.06 + 0.05);
    expect(bioRawScore({ 'ift_total:initial': 2.5 }, BIO_CONFIG_V1, { renormalise: true }).raw).toBeCloseTo(50);
  });
  it('displayed score is relative to the pool: floor 50, ceiling 95', () => {
    const d = bioDisplayed([10, 20, 30]); expect(d[0]).toBeCloseTo(50); expect(d[1]).toBeCloseTo(72.5); expect(d[2]).toBeCloseTo(95);
    expect(relativeScore(5, 5, 5)).toBe(95);
  });
});
// Oracle tests against the team's workbooks — they run as soon as the files are dropped into inputs/.
describe('reference workbooks (4C oracles)', () => {
  it.skipIf(!existsSync('inputs/Score_Eau_Carbone_Farmers.xlsx'))('Score Eau reproduces the "Résultats" tab (CVL3-155 = 91.2 … CVL3-123 = 18.7)', () => { throw new Error('Workbook now present: wire the oracle (read tab "Résultats", compare each farm to 1e-9).'); });
  // Biodiversité: see tests/selection.test.ts (reproduces the reference workbook on its 20 farms)
});
