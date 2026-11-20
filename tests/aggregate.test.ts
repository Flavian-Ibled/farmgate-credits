import { describe, it, expect } from 'vitest';
import { aggregateSelection, aggregateIndicator, wmean, evolution, type FarmFacts } from '../shared/aggregate.ts';
import type { IndicatorDef } from '../shared/catalogue.ts';

const base = (o: Partial<FarmFacts>): FarmFacts => ({ id: 'X', project: 'P', region: 'R', departement: '28', typology: 'Grandes cultures', lbc_status: 'Labellisé', sau: 100, lat: 48, lng: 2, em_init_ha: null, em_target_ha: null, st_init_ha: null, st_target_ha: null, re_evit_total: null, re_stock_total: null, re_labelled: null, vol_filieres: null, vol_vendable: null, vol_vendu: null, vol_dispo: null, ind: {}, levers: null, ...o });
const def = (o: Partial<IndicatorDef>): IndicatorDef => ({ code: 'x', category: 'c', label_fr: 'x', label_en: 'x', unit: 'u', aggregation: 'wmean', scope: 'both', match: 'x', ...o });
const map = (ds: IndicatorDef[]) => new Map(ds.map(d => [d.code, d]));

describe('aggregation rules (brief 4B)', () => {
  it('totals are summed and ignore missing values', () => {
    const r = aggregateSelection([base({ sau: 100, re_labelled: 500, vol_vendu: 100 }), base({ sau: 300, re_labelled: 1500, vol_vendu: null }), base({ sau: null, re_labelled: 10 })], [], { farms: 10, sau: 4000 }, []);
    expect(r.scale.farms).toBe(3); expect(r.scale.sau).toBe(400); expect(r.scale.n_with_sau).toBe(2);
    expect(r.carbon.re_labelled_5y).toBe(2010); expect(r.carbon.vol_vendu).toBe(100);
    expect(r.scale.share_of_portfolio_farms).toBeCloseTo(0.3); expect(r.scale.share_of_portfolio_sau).toBeCloseTo(0.1);
  });
  it('per-hectare intensities are SAU-weighted means over farms that have the value', () => {
    expect(wmean([{ v: 2, w: 100 }, { v: 4, w: 300 }, { v: null, w: 1000 }, { v: 9, w: null }])).toBeCloseTo(3.5);
    expect(wmean([{ v: null, w: 10 }])).toBeNull();
    const r = aggregateSelection([base({ sau: 100, em_init_ha: 2 }), base({ sau: 300, em_init_ha: 4 }), base({ sau: 1000 })], [], { farms: 3, sau: 1400 }, []);
    expect(r.carbon.em_init_ha.value).toBeCloseTo(3.5); expect(r.carbon.em_init_ha.n_with_data).toBe(2);
  });
  it('evolution comes from aggregated values, never from the mean of farm percentages', () => {
    const d = def({ code: 'lix' });
    // farm A: 10 → 5 (−50 %), 100 ha ; farm B: 100 → 100 (0 %), 900 ha. Mean of % = −25 %; aggregate = (90.5 − 91) / 91
    const a = aggregateIndicator(d, [base({ sau: 100, ind: { lix: { initial: 10, prospectif: 5 } } }), base({ sau: 900, ind: { lix: { initial: 100, prospectif: 100 } } })], map([d]));
    expect(a.initial).toBeCloseTo(91); expect(a.prospectif).toBeCloseTo(90.5);
    expect(a.evolution_prospectif).toBeCloseTo((90.5 - 91) / 91); expect(a.evolution_prospectif).not.toBeCloseTo(-0.25);
    expect(evolution(0, 5)).toBeNull(); expect(evolution(null, 5)).toBeNull();
  });
  it('evolution only pairs farms that have both ends', () => {
    const d = def({ code: 'lix' });
    const a = aggregateIndicator(d, [base({ sau: 100, ind: { lix: { initial: 10, prospectif: 8 } } }), base({ sau: 100, ind: { lix: { initial: 1000 } } })], map([d]));
    expect(a.n_with_data).toBe(2); expect(a.n_paired).toBe(1); expect(a.evolution_prospectif).toBeCloseTo(-0.2);
  });
  it('shares are recomputed from areas when areas exist', () => {
    const share = def({ code: 'cover_share', aggregation: 'area_share', area_code: 'cover_area' }), area = def({ code: 'cover_area', aggregation: 'sum' });
    const farms = [base({ sau: 100, ind: { cover_share: { initial: 0.5 }, cover_area: { initial: 50 } } }), base({ sau: 300, ind: { cover_share: { initial: 0.1 }, cover_area: { initial: 30 } } })];
    expect(aggregateIndicator(share, farms, map([share, area])).initial).toBeCloseTo(80 / 400);
    expect(aggregateIndicator(area, farms, map([share, area])).initial).toBe(80);
  });
  it('GC-only indicators use GC farms only; denominators are the applicable farms', () => {
    const d = def({ code: 'erosion', scope: 'GC' });
    const a = aggregateIndicator(d, [base({ ind: { erosion: { initial: 0.2 } } }), base({ typology: 'Élevage bovins', ind: { erosion: { initial: 0.9 } } }), base({})], map([d]));
    expect(a.n_applicable).toBe(2); expect(a.n_with_data).toBe(1); expect(a.initial).toBeCloseTo(0.2);
  });
  it('an indicator with no data is flagged "not collected", never filled', () => {
    const d = def({ code: 'simpson' }); const a = aggregateIndicator(d, [base({}), base({})], map([d]));
    expect(a.collected).toBe(false); expect(a.initial).toBeNull(); expect(a.n_with_data).toBe(0); expect(a.n_applicable).toBe(2);
  });
  it('lever shares use only farms that have lever data', () => {
    const r = aggregateSelection([base({ sau: 100, levers: ['a'] }), base({ sau: 300, levers: [] }), base({ sau: 600, levers: null })], [], { farms: 3, sau: 1000 }, ['a', 'b']);
    expect(r.levers.n_with_data).toBe(2); expect(r.levers.items[0]).toMatchObject({ code: 'a', farms: 1, share_farms: 0.5, share_sau: 0.25 }); expect(r.levers.items[1].farms).toBe(0);
  });
  it('avoidance / storage split comes from totals', () => {
    const r = aggregateSelection([base({ re_evit_total: 30, re_stock_total: 70 }), base({ re_evit_total: 10, re_stock_total: 90 })], [], { farms: 2, sau: 200 }, []);
    expect(r.carbon.share_avoidance).toBeCloseTo(0.2); expect(r.carbon.share_storage).toBeCloseTo(0.8);
  });
});
