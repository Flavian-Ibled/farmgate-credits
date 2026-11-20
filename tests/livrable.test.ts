import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseLivrableGC, readPdf, fr, frDate, similarity, previewLivrable, applyLivrable, type Page } from '../server/livrable.ts';
import { openDb, PUBLIC, type Ctx } from '../server/db.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';

const page = (n: number, rows: (string | [string, number])[][]): Page => ({ n, lines: rows.map((r, i) => { const cells = r.map((c, k) => (typeof c === 'string' ? { s: c, x: 60 + k * 90 } : { s: c[0], x: c[1] })); return { y: 800 - i * 12, cells, flat: cells.map(c => c.s).join(' ') }; }) });

describe('livrable helpers', () => {
  it('reads French numbers and dates', () => {
    expect(fr('5,20')).toBe(5.2); expect(fr('-2,47')).toBe(-2.47); expect(fr('− 163,3')).toBe(-163.3); expect(fr('18 300')).toBe(18300); expect(fr('31,5*')).toBe(31.5); expect(fr('NSP')).toBeNull(); expect(fr('-')).toBeNull();
    expect(frDate('18 juin 2026')).toBe('2026-06-18'); expect(frDate('1er août 2025')).toBe('2025-08-01'); expect(frDate('bientôt')).toBeNull();
  });
  it('matches lever names that differ slightly between livrable and Data Master', () => {
    expect(similarity('Augmenter la biomasse des couverts intermédiaires', 'Augmenter la biomasse ou la qualité des couverts intermédiaires')).toBeGreaterThanOrEqual(0.6);
    expect(similarity('Utiliser des engrais moins volatiles', 'Chauler les sols acides')).toBeLessThan(0.6);
  });
});

describe('Grandes Cultures livrable parser (synthetic pages)', () => {
  it('follow-up report: labelled values, sign of storage, credits, crops by column', () => {
    const ex = parseLivrableGC([
      page(1, [['Rapport de diagnostic', 'suivi', '« Label Bas Carbone » : Grandes Cultures'], ['Bilan Carbone Récolte 2025'], ['Nom de la ferme :', 'FERME TEST'], ['Conseiller/conseillère :', 'Agro Test'], ['Date du diagnostic :', '18 juin 2026'], ['1']]),
      page(2, [['1. Présentation de la ferme'], ['SAU totale :', '100,0 ha', 'Nombre de SDC :', '1'], ['Mode de production :', 'Conventionnel'], ['TESTVILLE (28320)'], ['2']]),
      page(3, [['2.2. Culture'], ['Surfaces [ha]'], [['Culture', 85], ['2024', 214], ['2025', 272], ['2029', 419]], [['Initial', 166], ['Prospectif', 464]], [['Blé tendre', 65], ['60,0', 169], ['55,0', 216], ['50,0', 275], ['58,0', 476]], [['Colza oléagineux', 65]], [['40,0', 169], ['45,0', 216], ['50,0', 275], ['42,0', 476]], [["d'hiver", 86]], ['Rendements'], [['Blé tendre', 65], ['83 q/ha', 169]], ['3']]),
      page(4, [['3.2. Émissions de GES de la ferme'], ['Récolte 2025 :'], ['Médiane : 3,24'], ['2,83'], ['tCO2e/ha/an'], ['Scénario Initial :', '5,20 tCO2e/ha/an'], ['Scénario Prospectif :', '2,74 tCO2e/ha/an'], ['4']]),
      page(5, [['3.3. Séquestration carbone'], ['Q1 : 2,31', 'Q3 : - 6,14'], ['-1,89'], ['tCO2e/ha/an'], ['Scénario Initial :', '-2,47 tCO2e/ha/an'], ['Scénario Prospectif :', '+0,10 tCO2e/ha/an'], ['5']]),
      page(6, [['4.1. Financement par crédits carbone'], ['Crédits Carbone estimés pour 5', 'Crédits Carbone réévalués pour'], ['55%'], ['710'], ['1102'], ['CC'], ['A25', 'A26', 'A27', 'A28', 'A29', 'Certification'], ['12 %', '12 %', '12 %', '12 %', '12 %', '40 %'], ['6']]),
    ]);
    expect(ex.kind).toBe('suivi'); expect(ex.harvest_year).toBe(2025); expect(ex.private).toEqual({ farm_name: 'FERME TEST', advisor: 'Agro Test', postal_code: '28320', commune: 'TESTVILLE' });
    expect(ex.sau).toEqual({ value: 100, page: 2 }); expect(ex.diagnostic_date?.value).toBe('2026-06-18'); expect(ex.production_mode?.value).toBe('Conventionnel');
    expect([ex.emissions_ha.initial?.value, ex.emissions_ha.year?.value, ex.emissions_ha.prospectif?.value]).toEqual([5.2, 2.83, 2.74]);
    expect([ex.storage_ha.initial?.value, ex.storage_ha.year?.value, ex.storage_ha.prospectif?.value]).toEqual([2.47, 1.89, -0.1]); // stored carbon becomes positive
    expect(ex.credits.estimated_5y).toEqual({ value: 710, page: 6 }); expect(ex.credits.reevaluated_5y?.value).toBe(1102); expect(ex.credits.schedule_pct).toEqual([12, 12, 12, 12, 12, 40]);
    const crop = (s: any) => Object.fromEntries(ex.crops.filter(c => c.scenario === s).map(c => [c.crop, c.hectares]));
    expect(crop('initial')).toEqual({ 'Blé tendre': 60, "Colza oléagineux d'hiver": 40 }); expect(crop(2025)).toEqual({ 'Blé tendre': 50, "Colza oléagineux d'hiver": 50 }); expect(crop('prospectif')).toEqual({ 'Blé tendre': 58, "Colza oléagineux d'hiver": 42 });
    expect(ex.crops.some(c => c.crop.includes('q/ha'))).toBe(false);
  });
  it('never guesses: ambiguous credits are left empty with a warning; a non-GC PDF is refused', () => {
    const ex = parseLivrableGC([page(1, [['Rapport de diagnostic', 'suivi', 'Grandes Cultures'], ['Bilan Carbone Récolte 2025'], ['1']]), page(2, [['4.1. Financement par crédits carbone'], ['Crédits réévalués'], ['710'], ['1102'], ['999'], ['2']])]);
    expect(ex.credits.estimated_5y).toBeNull(); expect(ex.credits.reevaluated_5y).toBeNull(); expect(ex.emissions_ha.year).toBeNull(); expect(ex.warnings.join(' ')).toMatch(/non lus avec certitude/);
    expect(() => parseLivrableGC([page(1, [['Rapport CAP2ER bovin lait'], ['1']])])).toThrow(/Grandes Cultures/);
  });
  it('initial report: crops per scenario, lever costs, credits', () => {
    const ex = parseLivrableGC([
      page(1, [['Rapport de diagnostic initial et', 'prospectif'], ['« Label Bas Carbone » : Grandes Cultures'], ['Nom de l’exploitation', 'FERME INIT'], ['1']]),
      page(2, [['Diagnostic de l’exploitation'], ['Bilan net initial :', '2,94', 'tCO2e/ha/an'], ['Bilan net prospectif :', '1,82', 'tCO2e/ha/an'], ['2']]),
      page(3, [['Assolement'], ['Scenario initial'], ["Blé tendre d'hiver", '60,0 q/ha', '100,0%', 'Non labour (1)', '60,6 ha', '41,4%'], ['Pois protéagineux de'], ['16,2 q/ha', '100,0%', 'Non labour (15)', '11,3 ha', '7,7%'], ['printemps'], ['Scenario prospectif'], ['Maïs grain', '90,0 q/ha', '100,0%', 'Non labour (15)', '18,0 ha', '12,3%'], ['3']]),
      page(4, [['Coûts des pratiques'], ['Fertilisation azotée', 'Coûts', '|', 'Economies'], ['Utiliser des engrais moins volatiles', '71,6', '€/ha', '-', '€/ha'], ['Enfouir les engrais', '-', '€/ha', '-', '€/ha'], ['Restituer les résidus de culture', '-', '€/ha', '6,9', '€/ha'], ['4']]),
      page(5, [['Financement de la transition'], ['Crédits Carbone'], ['581'], ['tCO2e', 'tCO2e'], ['31,5*'], ['€/tCO2e'], ['18 300 €'], ['Année 1*', 'Certification', 'Total'], ['12 %', '12 %', '40 %', '18 300 €'], ['12 %', '12 %', '12 %'], ['5']]),
    ]);
    expect(ex.kind).toBe('initial'); expect(ex.harvest_year).toBeNull(); expect(ex.net_ha.initial?.value).toBe(2.94); expect(ex.net_ha.prospectif?.value).toBe(1.82);
    expect(ex.crops.map(c => [c.scenario, c.crop, c.hectares])).toEqual([['initial', "Blé tendre d'hiver", 60.6], ['initial', 'Pois protéagineux de printemps', 11.3], ['prospectif', 'Maïs grain', 18]]);
    expect(ex.lever_costs.map(c => [c.name, c.cost_eur_ha, c.saving_eur_ha])).toEqual([['Utiliser des engrais moins volatiles', 71.6, null], ['Restituer les résidus de culture', null, 6.9]]);
    expect(ex.credits.estimated_5y?.value).toBe(581); expect(ex.credits.price_eur?.value).toBe(31.5); expect(ex.credits.total_eur?.value).toBe(18300); expect(ex.credits.schedule_pct).toEqual([12, 12, 12, 12, 12, 40]);
  });
});

const SUIVI = 'inputs/livrables/GC_suivi_R25_CVL2-062.pdf', INIT_A = 'inputs/livrables/GC_initial_CVL3_A.pdf', INIT_B = 'inputs/livrables/GC_initial_CVL4_B.pdf', MASTER = 'inputs/carbone_farmers_data_Master_2026sept21.xlsx';
describe.skipIf(!existsSync(SUIVI) || !existsSync(INIT_A) || !existsSync(INIT_B))('real livrables', () => {
  it('follow-up R25 of CVL2-062: same figures as the farm sheet, crop areas add up to the SAU', async () => {
    const ex = parseLivrableGC(await readPdf(readFileSync(SUIVI)));
    expect(ex.kind).toBe('suivi'); expect(ex.harvest_year).toBe(2025); expect(ex.sau?.value).toBe(115); expect(ex.diagnostic_date?.value).toBe('2026-06-18');
    expect([ex.emissions_ha.initial?.value, ex.emissions_ha.year?.value, ex.emissions_ha.prospectif?.value]).toEqual([5.2, 2.83, 2.74]);
    expect([ex.storage_ha.initial?.value, ex.storage_ha.year?.value, ex.storage_ha.prospectif?.value]).toEqual([2.47, 1.89, 0.92]);
    expect(ex.credits.estimated_5y?.value).toBe(710); expect(ex.credits.reevaluated_5y?.value).toBe(1102); expect(ex.credits.schedule_pct).toEqual([12, 12, 12, 12, 12, 40]);
    const sum = (s: any) => ex.crops.filter(c => c.scenario === s).reduce((a, c) => a + c.hectares, 0);
    for (const s of ['initial', 2024, 2025, 'prospectif']) expect(Math.abs(sum(s) - 115), String(s)).toBeLessThan(0.6);
    expect(ex.warnings).toEqual([]);
  });
  it('initial reports, both templates: crop areas add up to the SAU', async () => {
    const a = parseLivrableGC(await readPdf(readFileSync(INIT_A))), b = parseLivrableGC(await readPdf(readFileSync(INIT_B)));
    expect(a.sau?.value).toBe(146.4); expect(a.credits.estimated_5y?.value).toBe(581); expect(a.lever_costs).toHaveLength(3); expect(a.net_ha.initial?.value).toBe(2.94);
    expect(b.sau?.value).toBeCloseTo(102.429); expect(b.credits.estimated_5y?.value).toBe(110); expect(b.lever_costs).toHaveLength(0); expect(b.practice_cost_total_eur_ha?.value).toBe(49.9); expect(b.private.farm_name).toBeTruthy();
    for (const [ex, s] of [[a, 146.4], [b, 102.4]] as const) for (const sc of ['initial', 'prospectif'] as const) expect(Math.abs(ex.crops.filter(c => c.scenario === sc).reduce((x, c) => x + c.hectares, 0) - s)).toBeLessThan(0.6);
  });
  it('a farm that is not in the Data Master yet can be created from its initial livrable', async () => {
    const { createApp } = await import('../server/app.ts'); const { invalidate } = await import('../server/facts.ts');
    const db = await openDb({ memory: true }); invalidate(); const admin: Ctx & { email: string } = { role: 'platform_admin', email: 'admin@test.local' };
    const pv = await previewLivrable(db, admin, readFileSync(INIT_A)); expect(pv.farm_id).toBeNull(); expect(pv.can_create).toBe(true);
    await expect(applyLivrable(db, admin, readFileSync(INIT_A), 'a.pdf', undefined, { crops: true, costs: true })).rejects.toThrow(/non identifiée/);
    await expect(applyLivrable(db, admin, readFileSync(INIT_A), 'a.pdf', undefined, { crops: true }, { id: 'pas bon', project: 'P' })).rejects.toThrow(/Identifiant invalide/);
    const r = await applyLivrable(db, admin, readFileSync(INIT_A), 'a.pdf', undefined, { crops: true, costs: true }, { id: 'cvl3-900', project: 'Projet Nouveau' });
    expect(r.created!.id).toBe('CVL3-900'); expect(r.applied.crops).toBe(13); const located = r.created!.located; // needs the official commune API when the local index lacks the commune
    const f = (await db.owner.query(`select f.*, p.name project from farms f join projects p on p.id=f.project_id where f.id='CVL3-900'`)).rows[0];
    expect(f).toMatchObject({ project: 'Projet Nouveau', lbc_status: 'Diags en cours', departement: '91', region: 'Île-de-France', typology: 'Grandes cultures', created_from: 'livrable', vol_vendable: null }); expect(Number(f.sau)).toBe(146.4); expect(Number(f.re_labelled)).toBe(581); expect(f.lat_blur != null).toBe(located);
    await expect(applyLivrable(db, admin, readFileSync(INIT_A), 'a.pdf', undefined, {}, { id: 'CVL3-900', project: 'Projet Nouveau' })).rejects.toThrow(/existe déjà/);
    invalidate(); const page = await (await createApp(db).request('/api/public/farms/CVL3-900')).text(); const j = JSON.parse(page);
    expect(j.carbon.re_labelled).toBe(581); expect(j.crops.length).toBe(13); expect(j.funding.sellable).toBe(0); // not open for sale
    const name = (await db.owner.query(`select name, commune from farm_private where farm_id='CVL3-900'`)).rows[0]; expect(name.name).toBeTruthy(); expect(page).not.toContain(name.name); expect(page).not.toContain(name.commune);
    // a later full Data Master import that does not contain the farm must not hide it
    const { workbook, COLS, farm } = await import('./helpers.ts'); const d: any = await dryRun(db, await workbook(COLS, [farm('TST-001')]), { filename: 'm.xlsx' }); await applyImport(db, d.id);
    expect((await db.owner.query(`select absent_from_last_import a from farms where id='CVL3-900'`)).rows[0].a).toBe(false);
    await db.close();
  });
  it.skipIf(!existsSync(MASTER))('preview then apply on the real farm: recognised by name, values written, private data stays private', async () => {
    const db = await openDb({ memory: true }); const admin: Ctx & { email: string } = { role: 'platform_admin', uid: 1, email: 'admin@test.local' };
    const d: any = await dryRun(db, readFileSync(MASTER), { filename: 'master.xlsx' }); await applyImport(db, d.id);
    const pv = await previewLivrable(db, admin, readFileSync(SUIVI));
    expect(pv.farm_id).toBe('CVL2-062'); expect(pv.followup.find(f => f.field === 'em_year_ha')?.next).toBe(2.83);
    expect((await db.owner.query(`select count(*)::int n from farm_crops`)).rows[0].n).toBe(0); // preview writes nothing
    const r = await applyLivrable(db, admin, readFileSync(SUIVI), 'livrable.pdf', undefined, { followup: true, crops: true, costs: true });
    expect(r.farm_id).toBe('CVL2-062');
    const a = (await db.owner.query(`select * from annual_followups where farm_id='CVL2-062' and harvest_year=2025`)).rows[0];
    expect(Number(a.em_year_ha)).toBe(2.83); expect(Number(a.st_year_ha)).toBe(1.89); expect(Number(a.net_balance_ha)).toBeCloseTo(0.94); expect(Number(a.end_of_project_extrapolation)).toBe(1102); expect(Number(a.re_total_year)).toBeCloseTo(220.59); // measured credits untouched
    expect((await db.as(PUBLIC, q => q.query(`select crop from farm_crops where farm_id='CVL2-062' and harvest_year=2025`))).rows.length).toBe(5);
    for (const t of ['livrables', 'followup_private']) expect((await db.as(PUBLIC, q => q.query(`select * from ${t}`))).rows).toHaveLength(0);
    expect((await db.owner.query(`select count(*)::int n from livrables`)).rows[0].n).toBe(1);
    await db.close();
  });
});
