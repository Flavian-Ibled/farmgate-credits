import ExcelJS from 'exceljs';
export interface Row { [label: string]: any }
/** Builds a Data Master-like workbook: 3-row header (group / unit / label), columns in the given order. */
export async function workbook(cols: { group?: string; unit?: string; label: string }[], rows: Row[], extraSheets: Record<string, { cols: { group?: string; unit?: string; label: string }[]; rows: Row[] }> = {}) {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, cs: typeof cols, rs: Row[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(cs.map(c => c.group ?? null)); ws.addRow(cs.map(c => c.unit ?? null)); ws.addRow(cs.map(c => c.label));
    for (const r of rs) ws.addRow(cs.map(c => r[c.label] ?? null));
  };
  add('Master List', cols, rows);
  for (const [n, s] of Object.entries(extraSheets)) add(n, s.cols, s.rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const COLS = [
  { label: 'id' }, { label: 'Nom de la ferme' }, { label: 'Farmer' }, { label: 'Adresse' }, { label: 'Ville' }, { label: 'Code postal' }, { label: 'Région' }, { label: 'SIRET' },
  { label: 'SAU' }, { label: 'Latitude' }, { label: 'Longitude' }, { label: 'Projet' }, { label: 'Typologie' }, { label: 'Statut LBC' },
  { group: 'Données Carbone', unit: 'tCO2e', label: 'RE évitement totales \n(sur 5 ans)' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE Stockage totales\n(sur 5 ans)' },
  { group: 'Données Carbone', unit: 'tCO2e', label: 'RE totales labellisées  (sur 5 ans)' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume Vendu' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume Disponible' },
  { group: 'Co-bénefices EAU', unit: ' kg N-NO3/ha/an', label: 'Lixiviation des nitrates \nScénario initial' }, { group: 'Co-bénefices EAU', unit: ' kg N-NO3/ha/an', label: 'Lixiviation des nitrates\nScénario prospectif' },
  { group: 'Co-bénefices EAU', unit: '%', label: 'Evolution Lixiviation des nitrates  (en %)' },
  { group: 'Leviers activés par exploitation', unit: 'VRAI/FAUX', label: 'Utiliser des outils de pilotage' }, { group: 'Stockage de carbone dans le sol (L3)', unit: 'VRAI/FAUX', label: 'Implanter des cultures intermédiaires' },
];
export const farm = (id: string, o: Row = {}): Row => ({
  id, 'Nom de la ferme': `EARL SECRET ${id}`, Farmer: `DUPONT-PRIVE ${id}`, Adresse: '1 rue Cachée', Ville: 'VILLESECRETE', 'Code postal': 28320, 'Région': 'Centre Val de Loire', SIRET: 12345678900011,
  SAU: 100, Latitude: 48.5, Longitude: 1.75, Projet: 'Projet Test', Typologie: 'Grandes cultures', 'Statut LBC': 'Labellisé',
  'RE évitement totales \n(sur 5 ans)': 40, 'RE Stockage totales\n(sur 5 ans)': 60, 'RE totales labellisées  (sur 5 ans)': 100, 'Volume Vendu': 10, 'Volume Disponible': 90,
  'Lixiviation des nitrates \nScénario initial': 50, 'Lixiviation des nitrates\nScénario prospectif': 40, 'Utiliser des outils de pilotage': true, 'Implanter des cultures intermédiaires': false, ...o,
});
