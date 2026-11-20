# Farmgate Credits — Complete Instructions for Claude Code

> FINAL version. Single source of truth for building the platform. Put this file in the project root as `CLAUDE.md` (or reference it from your first message), together with the input files listed in section 0.
> Language of the UI: French (default) + English. Language of the code and this brief: English.

---

## 0. PROJECT SETUP (do this first)

Create the folder and put these files in `./inputs/` (never commit them to a public repo: they contain farm data):

| File | What it is | Used for |
|---|---|---|
| `carbone_farmers_data_Master_2026sept21.xlsx` | Data Master: sheets `Master List` (~1,113 farms, 133 columns) + one sheet per project (CVL1–CVL4, Carbon-Agri lait, Biolait, Adagri, Secalia, ABFC, Noriap, SAGE, Hauts-de-France, Agri régénérative R25/R26…) | farm, carbon, co-benefit, lever data; CVL2 sheet holds the first annual follow-up columns |
| `cobenefit_catalogue.csv` | 64 co-benefit indicators with units, scope, priority, current coverage in the Master | seed of the `Indicator` table |
| `Listing_cobénéfices.xlsx` | source of the catalogue (team's priorities) | reference |
| `Sélection_Carbone_Farmers.xlsx` | buyer selection example (SEDIF / CVL3, 20 farms) + tab `Paramètres Biodiv` (biodiversity score method) | reference for the selection builder and Biodiversity score |
| `Score_Eau_Carbone_Farmers.xlsx` | Water score workbook (method, live formulas, results) | reference + test oracle for the Water score |
| `Fiche_ferme_CVL2-062_Suivi_R25.pptx` | farm sheet with annual follow-up R25 | reference for the farm page and AnnualFollowUp model |
| `CVL2_trajectoire_projet.pdf` | project trajectory page (CVL2) | reference for the project page |
| `carbone_farmers_map_pro.html` | current Leaflet map (features to port; **do not copy its data embedding or password logic**) | reference for map features |
| brand assets (logo, icons, colors) | Carbone Farmers charter | design |

Working rules for Claude Code:
1. Work phase by phase (section 10). After each phase: run the app, run the tests, list what works, what is missing, and which data is missing. Do not start the next phase without my "go".
2. Never invent data. Anything missing is shown as "à fournir" with an owner. Demo data is allowed only in a clearly separated, flagged demo dataset.
3. Every computed number must have a unit test; the three scores (Biodiversité, Eau, plus aggregation rules) must be tested against the reference workbooks (see 4C).
4. Keep secrets, SIRET, phone numbers, exact addresses and farmer names out of any public bundle, log or API response.
5. Ask me before any irreversible or paid action (deploy, domain, paid service, deleting data).

---
---

## 1. ROLE & GOAL

You are a senior full-stack engineer and product designer. Build **Farmgate Credits**, the public transparency platform of **Carbone Farmers** (France, Label Bas Carbone / LBC): it shows, project by project and farm by farm, what carbon is avoided and stored, what it costs, where the money goes and what co-benefits are created.

Audiences: corporate buyers (CSR / climate directors, procurement teams answering carbon-contribution tenders), investors, cooperatives, public bodies, farmers.
Promise: **"See, verify and trust the carbon you finance."**

Quality bar: premium, credible, mobile-first, WCAG AA, bilingual FR (default) / EN. Must clearly beat a plain project directory: every number is traceable (source, year, verification status).

## 2. TECH STACK

React + TypeScript + Vite (or Base44 default), Tailwind, shadcn/ui, react-leaflet (clustering + GeoJSON), Recharts (+ Sankey), react-i18next, Base44 entities (or Supabase/Postgres), file storage for photos/PDFs, PDF generation (react-pdf or server-side) for project and farm sheets.
Auth: public read; roles `admin` (Carbone Farmers), `buyer` (client), `viewer`. No hard-coded passwords.

## 3. DESIGN

Carbone Farmers charter (logo, icons, colors: I will upload them; the project sheets already use it, mirror them). Fallback: soil brown `#3B2A1E`, leaf green `#2F7D4F`, wheat `#E0B243`, cream `#F8F4EA`.
Editorial serif headlines + clean sans body, big farm photography, numbers as heroes, subtle motion only.
Reuse the visual language of the existing sheets: a "trajectory" bar chart (initial scenario → 2025 harvest → prospective scenario), KPI tiles (e.g. "491 tCO₂e attendues / 221 mesurées / 115 ha"), a 5-campaign roadmap strip, status badge ("Labellisé").

## 4. DATA MODEL (built from the real Data Master)

The source of truth is an Excel workbook ("carbone_farmers_data_Master"). Sheets: `Master List` (all farms, ~1,113 rows, 133 columns), one sheet per project (CVL1, CVL2, CVL3, CVL4, Carbon-Agri lait, Biolait, Adagri, Secalia, ABFC, Noriap, SAGE, Hauts-de-France, Agri régénérative R25/R26, Maine R26, etc.), plus "Fermes proposées à la DAE". Build the importer around it.

### 4.1 Project (one per collective project)
Identity: `slug`, `name`, `porteur` (e.g. Axéréal, Tereos, Secalia, Noriap, Biolait…), `partner_type` (coop / négoce / industrie / filière lait…), `status`.
**The 8 client-required blocks (all mandatory fields, each with a "source / last updated / verified by" footer):**
1. **Geographic coverage**: regions, départements, communes count, polygon / convex hull from farm points, public map.
2. **Standard, label and methodology**: label (Label Bas Carbone), methodology + version (LBC Grandes Cultures, LBC Carbon Agri Bovins, Haies, Vergers…), dossier number (e.g. "Dossier LBC n° 18205357" at farm level), labelling date, label validity period.
3. **Baseline (reference) scenario**: reference years (e.g. "2021/22/23" = average of 2021–2023 harvests), blank year (2023-24), methodology of the baseline (tool, hypotheses), baseline emissions and storage per ha.
4. **Annual volumes of credits / units**: per vintage year: planned, measured at monitoring, verified, issued, sold, available, retired. Show planned vs measured vs end-of-project projection.
5. **Co-benefits (social and territorial as well as environmental)**: see 4.6. Social/territorial indicators are NOT in the Data Master yet; create fields and mark "to be provided".
6. **MRV methodology**: data collected (assolement & ITK, soil analyses, PAC), tools (MyEasyCarbon / FarmGate Metrics, Farmstar…), frequency (diagnostic initial, annual monitoring, final audit at end of R29), who (agronomist), verification body, uncertainty, rabais (discount) applied.
7. **Contracting terms**: contract type, duration (5 years, 09/2024–08/2029), pricing model, payment schedule (pre-payment / on delivery), minimum volumes, non-delivery / reversal clauses, buyer rights (retirement, claim wording), mandatary (Carbone Farmers acts as mandataire).
8. **Total project cost in € and remuneration model**: total € (credits × price), % passed to the farmer (e.g. 75 % of the price per tonne), breakdown of the rest (MRV/audit, diagnostics & support, Carbone Farmers, partner coop, label/taxes), per-hectare and per-tCO₂e views, fixed vs variable part.

Aggregates computed from farms: farms_count, hectares (SAU), initial label volume (e.g. CVL2: 67,948 tCO₂e in the Master vs 68,339 in the project sheet: show the document value and flag the gap), avoidance / storage split, volume sold, volume available.

### 4.2 Farm (from Master List)
`id` (e.g. CVL2-062, ADA-001), `project`, `name`, `farmer` (see privacy 9), `address`, `commune`, `postal_code`, `département`, `région`, `siret` (private), `SAU`, `lat/lng`, `typology` (Grandes cultures / Élevage bovins), `productions`, `reference_period`, `project_period`, `LBC_status` (Diags en cours / En instruction / Labellisé / Sold Out / Désengagé), `diagnostic_referent` (agronomist), `lbc_dossier_number`, photos, story.

### 4.3 Carbon data per farm (Master List "Données Carbone")
Initial emissions/ha, 5-year target emissions/ha, initial storage/ha, 5-year storage target/ha, rabais %, RE avoidance per ha and total (5 years), RE storage per ha and total, RE total/ha, RE total/ha/yr, **RE total labellisées (5 yr)**, % avoidance vs % storage, volume "valorisé en filières", sellable, sold, available.

### 4.4 AnnualFollowUp (NEW, the key module): one record per farm per harvest year (R25 … R29)
Source: farm sheet "Suivi R25" and the project trajectory page. Fields:
- `harvest_year`, `diagnostic_date`, `diagnostician`, status (planned / diagnosed / verified / audited)
- Emissions per ha: baseline (avg R21–R23) vs year N, gross emissions evolution %, storage per ha, **net balance per ha/yr and % change** (example: net 2.73 → 0.82 tCO₂e/ha/yr = −70.2 %)
- `re_avoidance_year`, `re_storage_year`, `re_total_year` (tCO₂e measured this year, example 220.6 for 2025)
- `cumulative_generated`, `end_of_project_extrapolation` (rule used on the sheets: storage accumulates with growing yearly gain, avoidance constant; show the formula and the "subject to annual monitoring and audit" mention)
- `vs_initial_label_volume` (e.g. 221 generated vs 491 initial; end-of-project estimate 1,103 = +125 %)
- Lever-level change observed (the farm sheet has this blank: "à renseigner"; keep the field)
- Air-quality / water / soil indicators observed vs target (e.g. ammonia 26.1 → 16.8 kg N/ha/yr, −35.6 %)
- `payment_to_farmer` for the year (€ and date), `document_url` (signed diagnostic PDF)
Project-level view aggregates these (example CVL2: 109 farms followed out of 112; gross emissions 52,954 → 35,701 …; net balance −38.4 % vs −17.3 % objective; credits: 68,339 initial label → 7,388 already generated R25 → 105,294 end-of-project estimate, +54 %). Always show "initial estimate / already generated / end-of-project projection" as three numbers.

### 4.5 Lever and FarmLever
Master List has 47 boolean lever columns (TRUE/FALSE per farm) grouped by family: Fertilisation (dose adjustment, steering tools, intra-field modulation, inhibitors, liming, less volatile fertilisers, burying, organic fertiliser), Rotation & covers (legumes/longer rotation, temporary grassland, cover-crop biomass, intermediate crops), Energy (engines, irrigation, drying/storage), Soil (fewer passes, residue return), Livestock (L1 energy, L3 soil carbon, L4 hedges/agroforestry, L5 effluents, L6-L7 fertilisation, L9 protein autonomy, L10 feed, L11 herd management, L12 rotations).
Model: `Lever(id, family, name, type avoidance|storage, icon)`, `FarmLever(farm, lever, active, description, hectares, expected_tCO2e)`. **Important data gap:** transition cost per lever (€/ha) is not in the Data Master; create the cost fields and import them from the Excel "Calcul CC / versement agri" and "Gain carbone par levier" files when provided. Until then show "cost to be documented", not invented numbers.

### 4.6 CoBenefit catalogue (64 indicators; file `cobenefit_catalogue.csv` provided, seed from it)
Source: the team's "Listing co-bénéfices" workbook. Seven families: **Eau** (nitrate leaching, water consumption), **Sol** (erosion index, no-till share, cover share/area/duration, soil organic matter, MO/clay ratio, organic N / total N, humified carbon: straw, covers, organic fertiliser, total; tillage depth), **Air** (ammonia + NOx), **Biodiversité** (IFT total / herbicide / non-herbicide / biocontrol, untreated surface share, number of spray passes, Simpson index, species in covers / main crops / total, IAE % of SAU, EIQ), **Pression sur les ressources** (mineral N, organic N, P2O5, K, non-renewable energy MJ/ha/yr), **Potentiel nourricier** (caloric, vegetal protein), **Résultats Agribest** (15 practice scores from 0 to 5: organic matter, N fertilisation, soil structure, drainage, irrigation, flowering crops and covers, weeds, pests, fungal diseases, grass strips, grassland covers, permanent grassland, natural-type grassland, ecological elements, hedges).
Each indicator is stored as three states per farm: `initial` (baseline scenario), `prospectif` (5-year target) and `suivi_N` (measured at monitoring year N: "ajouter les lignes suivi"), plus the computed `evolution_%`. Catalogue fields: category, code, label, unit, states, mandatory/optional, scope (GC / élevage / both), need priority (1 = priority, 3 = not), feasibility (1 = easy, 3 = hard), currently collected (yes/no), comment. Rules from the team's comments: express water in m³, tillage depth in cm.
**Reality check from the Data Master:** only 14 of the 64 indicators exist today (nitrate leaching, water consumption, erosion, cover share and area, organic matter, tillage depth, ammonia, IFT total, untreated surface share, number of treatments, cover species, non-renewable energy, caloric food potential); the other 50 (humified carbon, Simpson, IAE, EIQ, N/P/K quantities, protein, all 15 Agribest scores...) are not collected yet. Coverage in the Data Master varies from 0 % to 55 % of farms per indicator. So the UI must show, for every indicator and every selection, a **coverage badge** ("measured on 312 of 540 farms") and an "indicator not yet collected" state. Never fill gaps with averages or demo values.
Social / territorial co-benefits (jobs, income resilience, local supply chain, training, partner engagement) are not in any file yet: create them as optional project-level fields, "to be provided".

### 4.7 Other entities
Funders, users, project owners (porteurs) and allocations: see **4D** (replaces the former `FinancingFlow` / `Buyer` entities; the euro breakdown now lives in `Allocation.cost_breakdown`). Farm content (crops, media, narrative, lever costs): see **4E**. Roles and login: see **4F**. Also: `CreditLot` (vintage, status issued/sold/retired, certificate), `Document` (project design doc, LBC certificate, diagnostic, monitoring report; public/private), `StoryPost`.

## 4B. SELECTION ANALYTICS ENGINE (core of the platform)

Every number shown anywhere (map, project page, buyer area, PDF) is computed for a **selection of farms**, which can be: one farm, one project, several projects, or any ad-hoc set defined by filters or geography. The same panel and the same PDF "fiche de sélection" must work for all of them.

**Selection builders (all combinable, AND logic, shown as removable chips, shareable via URL, saveable as named "portfolios"):**
- attribute filters: project, porteur, région, département, typology (grandes cultures / élevage bovins), LBC status, active levers, SAU range, available volume, vintage;
- geography: draw/click on a département or region; **bassin versant** (river basin) grid selection; **river/stream buffer** (distance to a selected watercourse, adjustable km); **radius around a commune** (autocomplete on the 33,335-commune index); **upload a KML/KMZ/GeoJSON zone** with point-in-polygon;
- manual: tick farms in the list/map; paste a list of farm ids.

**Output panel for any selection (live, recomputed server-side):**
1. Scale: farms count, SAU (ha), share of the portfolio, projects involved, regions.
2. Carbon: initial and prospective emissions and storage per ha, RE avoidance / storage / total over 5 years, labelled volume, avoidance vs storage split, then measured to date from annual follow-up (planned vs measured vs end-of-project estimate), sold / available volume.
3. Money: price scenarios, total € for the selection, share to farmers, breakdown of the rest.
4. Levers: share of farms and hectares per lever and per family.
5. **Co-benefits: all 64 indicators of the catalogue**, each as initial → prospective → measured (follow-up N) → evolution %, with coverage badge.
6. Exports: CSV/Excel (farm-level rows + aggregate row), PDF "fiche de sélection", sharable link.

**Aggregation rules (critical, implement exactly):**
- Totals (tCO2e, ha, m³, volumes, number of farms): sum.
- Per-hectare intensities and ratios (tCO2e/ha, kg N/ha, MJ/ha, IFT, % organic matter, indices, ratios, shares of area): **SAU-weighted mean** over farms that have the value; shares recomputed from areas when areas exist (e.g. cover share = total covered ha / total SAU).
- Evolution % of the selection is computed from the aggregated initial and aggregated prospective/measured values, never as the mean of farm-level percentages.
- Agribest scores (0–5): SAU-weighted mean, plus distribution (number of farms per score).
- Livestock-only indicators use livestock farms only; grandes-cultures-only (erosion, tillage depth, etc.) use GC farms only; the denominator shown is always the farms the indicator applies to.
- Always return `n_with_data` and `n_applicable` per indicator; hide an indicator only if n_with_data = 0 (then show "not yet collected").
- Ignore `#DIV/0!`, text and empty cells; outliers are flagged in the admin import report, not silently removed.
- Compute aggregations in the backend (query or function), not in the browser, so public users never receive farm-level data.

## 4C. COMPOSITE SCORES & BUYER SELECTION BUILDER

Reference: the team's workbook "Sélection Carbone Farmers" (a buyer-specific proposal for the SEDIF area: one tab "Sélection SG" with ~20 CVL3 farms grouped by carbon credits, water quality, water use, air, soil health, biodiversity, resource pressure, food potential, other measured indicators and the 18 activated levers; one tab "Paramètres Biodiv" with the score method). Implement the same mechanism as a feature, not as a spreadsheet.

- **Score engine**: configurable composite scores (Eau, Biodiversité, Sol, Énergie, Potentiel nourricier, later a global score). Each score is a versioned config in the admin: list of indicators (from the 64-indicator catalogue), direction (lower is better, e.g. IFT; higher is better, e.g. Simpson index, number of crops, cover share), basis (initial, prospective, evolution), normalisation (min-max or percentile within a reference population, e.g. the project or the whole portfolio), weights, handling of missing data (renormalise on available indicators and show the share of the score actually backed by data). The score is recomputed server-side and can be computed for one farm or for any selection (4B, SAU-weighted).
- **Biodiversity score /100 — exact method (from the team's workbook "Sélection Carbone Farmers", tab "Paramètres Biodiv"; reproduced and checked against the sheet, zero difference on 20 farms):**
  - For each indicator: `note = 100 × clamp((value − threshold_0) / (threshold_100 − threshold_0), 0, 1)`; contribution = `note × weight`. A threshold_100 lower than threshold_0 means "lower is better" (IFT, erosion, leaching…). For evolution indicators, stagnation or degradation gives 0 points.
  - **Raw score = sum of contributions** (weights sum to 1). Half of the weight (0.50) is on the **starting state** (15 indicators), half (0.50) on the **project evolution** (12 evolution indicators + the lever count).
  - Starting state (threshold 0 → threshold 100, weight): nitrate leaching 60→38 kgN/ha/yr (.08); covers % SAU 0→0.5 (.04); soil cover duration 150→365 days (.04); cover share measured 0→50 % (.02); erosion factor 0.25→0.05 (.04); no-till 0→80 % (.03); tillage depth 25→15 cm (.01); organic matter 1→4 % (.04); humified C 0.5→1.5 tC/ha/yr (.02); IFT 5→0 (.04); EIQ/ha 150→0 (.03); Simpson index 0.4→0.9 (.03); number of crops 2→10 (.03); P 60→0 kg P2O5/ha (.02); IAE 0→15 % SAU (.03).
  - Evolution (0 → 100 points, weight): nitrate leaching 0→−15 % (.02); NH3 0→−40 % (.02); covers 0→+30 pts of SAU (.06); erosion 0→−20 % (.05); no-till 0→+30 pts (.04); tillage depth 0→−4 cm (.02); humified C 0→+0.3 (.03); organic matter 0→+0.4 pt (.06); IFT 0→−2 (.06); Simpson 0→+0.1 (.03); number of crops 0→+3 (.04); P 0→−20 kg (.02); **number of biodiversity-friendly levers activated 0→4 (.05)**, counting: legumes or longer rotation, crop residues returned, organic fertiliser increase, temporary grassland, high-biomass intermediate covers (max 4 counts as full note).
  - **Displayed score = floor + (ceiling − floor) × (raw − min raw) / (max raw − min raw)**, with floor 50 and ceiling 95, min/max taken over the farms in the compared set. The score therefore ranks farms **relative to the selected pool**; it is not an absolute grade. The UI must say so ("score relatif à la sélection, échelle 50–95") and also expose the **raw score** and the per-indicator contributions (explain-why panel with the "why this indicator matters" sentence stored for each indicator, e.g. "Abri et ressources alimentaires pour la faune hors période de culture").
  - All thresholds, weights, floor and ceiling are editable in the admin (versioned, with the date and author of each change); changing them recomputes all scores. The score ignores the Eau score on purpose, to avoid counting water twice.
  - Known issues to resolve before publishing: (1) three cover indicators overlap (covers % SAU, cover share measured, soil cover rate), which double counts covers; (2) units are mixed (fraction 0–0.5 for covers % SAU vs 0–50 % for measured cover share), so store one unit per indicator; (3) farms without a value currently get 0 points, so a farm with missing data is penalised like a bad farm: show the data-completeness of each score and offer an option "renormalise on available indicators".
- **Water score /100 (Score Eau) — exact method (workbook `Score_Eau_Carbone_Farmers.xlsx`, tab "Paramètres Eau"; implemented with live formulas and checked against an independent calculation, difference < 1e-13 on 20 farms):**
  - Same mechanics as the biodiversity score: `note = 100 × clamp((value − threshold_0) / (threshold_100 − threshold_0), 0, 1)`, contribution = `note × weight`, **Score Eau = sum of contributions, on 100 points, absolute** (does not depend on the selection). A threshold_100 lower than threshold_0 means "lower is better".
  - **Block 1 — Lixiviation, 40 points:** (a) nitrate leaching at end of project, 60 → 38 kgN/ha/yr, weight 20 %; (b) relative evolution of leaching `(prospective − initial) / initial`, 0 → −15 %, weight 20 %; if the initial leaching is already ≤ 38 the farm gets the full note on (b).
  - **Block 2 — Consommation d'eau, 40 points:** (a) **irrigation yes/no** at end of project: 100 if the farm does not irrigate (prospective irrigation ≤ `irrigation_null_threshold`, default 0 mm/ha/yr), 0 otherwise, weight 20 %; (b) irrigated volume at end of project, 120 → 0 mm/ha/yr, weight 10 %; (c) relative evolution of the irrigated volume, 0 → −50 %, weight 10 %; if the farm did not irrigate at the start it gets the full note on (c). Use mm/ha/yr (per hectare, independent of farm size); m³/yr = mm × 10 × SAU is displayed as information only.
  - **Block 3 — IFT, couverts végétaux et autres, 20 points:** IFT at end of project 5 → 0 (4 %); IFT evolution (absolute) 0 → −2 (4 %), full note if initial IFT = 0; cover crops at end of project 0 → 50 % of SAU (4 %); cover evolution (points of SAU) 0 → +30 pts (4 %), full note if initial cover ≥ 50 %; erosion factor at end of project 0.25 → 0.05 (2 %); phosphorus at end of project 60 → 0 kg P2O5/ha (2 %).
  - **"Already optimal" rule (differs on purpose from the biodiversity method, where stagnation gives 0):** for an evolution indicator, if the farm starts at the optimal level (see thresholds above) it receives 100, otherwise a farm that does not irrigate would be penalised for not being able to reduce irrigation.
  - Also display: the three block sub-scores (/40, /40, /20), a rank, and an optional **relative score 50–95** (floor + (ceiling − floor) × (score − min) / (max − min) over the compared farms) so it can sit next to the biodiversity score. The absolute score is the reference; the relative one must be labelled "relatif à la sélection".
  - All thresholds, weights, the irrigation threshold, floor and ceiling are editable in the admin (versioned with date and author); the weights must sum to 100 % (block save otherwise).
  - **Reference results to reproduce in the tests** (SEDIF / CVL3 sample, 20 farms; full table in the workbook, tab "Résultats"): CVL3-155 = 91.2 (rank 1), CVL3-164 = 90.2, CVL3-060 = 78.7, …, CVL3-192 = 44.3 (rank 12, first irrigating farm), CVL3-139 = 41.5, …, CVL3-123 = 18.7 (rank 20). All 11 non-irrigating farms score ≥ 52.4 and all 9 irrigating farms ≤ 44.3. Mean score weighted by SAU: 52.0.
  - Assumptions to be confirmed by the agronomy team (shown in the admin as "à valider"): (1) the 20/10/10 split inside the consumption block and the content of "autres" (erosion + phosphorus) were not specified and were chosen by us; (2) thresholds are method choices; (3) the **previous water score, typed by hand in the source workbook, ranks irrigating farms that cut their volumes first** (correlation −0.45 with this new method): the two cannot coexist on the platform; the new method replaces it only after validation. Sensitivity: lowering the weight of "irrigation yes/no" to 5–10 % (and raising volume/evolution) does not change the split, because non-irrigating farms automatically get the full note on volume and evolution.
- **Buyer selection builder** ("Proposition de sélection"): choose a project or a pool, set criteria (minimum/maximum score, département, SAU, available volume, levers required, volume target) and get a **ranked table** with: rank, farm id, name (admin/buyer-side only), département, cover share prospective, erosion, no-till share, tillage depth, humified carbon, organic matter, phosphorus, organic N share, IFT, Simpson index, number of crops, energy, food and protein potential (each initial / prospective / evolution) and the activated levers shown as dots (●). Bottom row = totals or SAU-weighted means, and a count of farms per lever. Export to Excel and to a buyer-ready PDF; save as a named proposal linked to the buyer.
- Source-file lesson: in a previous version of this workbook nearly all lookup cells were broken (#REF!) because the source tabs were detached. The platform replaces these fragile lookups with a database query by farm id, and the importer must report any farm id with no matching record instead of showing an error.

## 4D. FUNDERS, USERS, PROJECT OWNERS AND ALLOCATIONS (the platform mainly serves the funders)

**Entities**
- `Organization(type: funder | project_owner | partner | carbone_farmers, name, sector, logo, public_name_policy: named | anonymised | private, billing_contact (private), status)`. Project owners ("porteurs") are cooperatives or industrial groups such as Axéréal, Tereos, Secalia, Noriap, Biolait; Carbone Farmers acts as mandataire.
- `User(email, first_name, last_name, organization, role, status: invited|active|disabled, locale, last_login)`; one organization has many users.
- `ProjectMembership` (project ↔ project_owner organisation) and `FarmMembership` (farm ↔ project, with entry/exit dates and status: diagnostic in progress / in review / labelled / sold out / withdrawn).
- **`Allocation`** (a funder's contribution): `funder_org, target_type: farm | project | portfolio (selection), target_id, vintage_scope (all 5 harvests or a given harvest), volume_tco2e, price_per_tco2e, amount_eur, cost_breakdown (farmer %, MRV/audit, project development and support, Carbone Farmers, partner, label/taxes), status: quote → reserved → contracted → paid → delivered/retired, or cancelled, contract_ref, invoice_ref (private), signed_at, display_name_policy, claim_wording, created_by, notes`.
- **`AllocationLine`**: when an allocation targets a project or a portfolio, it is spread over the farms (default: pro rata of each farm's labelled volume; alternatives: by SAU, or manual) and frozen at contract signature, so that every farm page can show who funds it and how much remains. Rebalancing after a farm withdraws is an explicit, logged admin action.

**Rules (implement exactly)**
- `farm_labelled_volume` = the net labelled volume after discount (`RE totales labellisées`). `farm_allocated` = sum of its allocation lines whose status is reserved, contracted, paid or delivered (the statuses counted as "funded" are configurable; default: reserved and beyond). **`funded_% = farm_allocated / farm_labelled_volume`; `remaining = farm_labelled_volume − farm_allocated`**; the same at project and portfolio level (sum over farms). A farm becomes "Sold Out" automatically when remaining reaches 0, and goes back to "Labellisé" if an allocation is cancelled.
- **Never over-allocate**: the availability check and the write happen in one database transaction with a row lock; a second funder cannot take the same credits. Allocations cover planned credits (5-year labelled volume); in parallel, show how much of that volume is already measured and verified (annual follow-up), because funders pay for planned credits that are confirmed year after year.
- **Opening balances**: the Data Master already holds a `Volume Vendu` per farm (about 126,000 tCO₂e in total) without any funder attached. Import it as allocation lines of type "historical sale — funder to be assigned" so that totals match the Data Master, then let admins assign the funders. Never drop them.
- **Attribution of impact to a funder**: for a farm, funder share = allocated volume / labelled volume. The funder sees its share of avoided and stored tCO₂e, of the co-benefits (pro rata or area-weighted values, labelled "attribution") and of the remuneration reaching the farmer. Same logic for a project or a portfolio.
- A farm that leaves the project ("Désengagé", a status already present in the Master) triggers a **replacement workflow**: the affected allocation lines are listed, the admin proposes replacement farms, the funder is notified. The policy (replacement, buffer, refund) is to be defined with the team and stored per contract.
- **Credit ledger**: every allocation has a unique reference and a verification page (QR code on the certificate) confirming funder (if public), volume, vintage, status and date, without personal data. It protects against double counting and gives funders something to cite.
- **Contribution certificate** (PDF, charter, unique reference, QR): the claim wording must follow the official Label Bas Carbone rules for contribution claims; the claim text and registry references are configured in the admin and marked "to be validated by Carbone Farmers / legal" until provided.
- **Quote / proposal flow**: a funder user builds a selection (4B and 4C), clicks "Request a proposal"; this creates an allocation in status `quote`, visible to admins, who adjust it and convert it to `reserved` / `contracted`. Creation and status changes can be pushed to Zoho CRM (API-ready, optional).

**Funder portal (authenticated)**
- "My portfolio": the farms and projects I fund on a map; my % of each farm and project; credits still available to buy on each; planned vs measured vs verified tCO₂e attributable to me; remuneration reaching farmers; co-benefits; documents; certificates; annual impact report (PDF/Excel) with my logo; notifications.
- "Available credits": farms and projects with remaining volume, filterable with the whole selection engine, with price scenarios. Nothing about other funders beyond what they allowed (named or anonymised).
- Organisation admin: invite, disable and re-enable my own users (seat limit set by Carbone Farmers), see the activity log.
- Public "Our contribution" page and embeddable widget per funder, only if the funder opted in.

## 4E. FARM PAGE CONTENT: WHAT MUST BE THERE AND WHERE IT COMES FROM

| Block | Content | Source / status |
|---|---|---|
| Presentation | public name (consent), farm type (grandes cultures, élevage bovins lait/viande, mixte), SAU, location (blurred), production system, years in the project, agronomist in charge | Master List (type, SAU, location, referent); production system = to be provided |
| **Assolement (crop mix)** | `FarmCrop(farm, harvest_year, crop, hectares, share)`; donut of the current crop mix, rotation over the reference years vs the prospective rotation; for livestock farms: herd size, livestock units, milk or beef output, grassland share | **The Master List column `Productions` is empty for all 1,113 farms.** The assolement must be imported from the diagnostic files (PAC / Télépac declarations, "Assolement et ITK" files) through the Crops sheet of the import template |
| Avoidance vs storage | tCO₂e and %, per year and cumulative; initial vs measured vs end-of-project estimate | Master List + annual follow-up |
| Levers | activated levers (47 lever flags) grouped by family, with a plain-language description of what changes on the farm | Master List flags; descriptions to write |
| **Lever costs** | per lever: one-off cost, annual cost, yield impact, total cost per ha, cost per tCO₂e avoided or stored, and who pays (farmer remuneration, funder) | **Not in any file yet**: create the fields, import through the FarmLevers sheet, show "à documenter" until filled; aggregates for any selection |
| Co-benefits | the 64-indicator catalogue (initial / prospective / measured / evolution) with coverage badge | Master List (14 of 64 today) |
| **Photos** | `Media(farm, kind: portrait/farmstead/field/cover_crop/before/after, file, alt_fr/en, caption_fr/en, taken_at, credit, consent_status, public, order)`; bulk upload by zip with a manifest (`CVL2-062_portrait.jpg`…); automatic resize and WebP; **strip EXIF GPS data** (it would reveal the exact location); consent flag required before publication | to be collected; the R25 farm sheet has empty photo slots |
| **Narrative** | structured story: Context / Motivations / Stakes (as on the farm sheet), FR and EN, workflow draft → farmer-approved → published, version history | to be written; optional AI-assisted first draft from interview notes, always human-approved |
| Map | farm marker (blurred) and neighbours of the same project | Master List lat/lng |
| Follow-up and funding | annual follow-up table, funded %, remaining credits, funders (according to their visibility policy) | 4.4 and 4D |
| **PDF summary sheet** | 1–2 pages, Carbone Farmers charter, FR/EN, QR code to the live page, "data as of" date and version, mandatory caution on estimates ("subject to annual monitoring and audit"); templates: farm, project, portfolio, funder report; public version (no identifying data) and funder version; batch export (zip) for all farms of a project or a funder; generated server-side (headless Chromium) so the layout is identical on every device | to build |

## 4F. ROLES, LOGIN AND PERMISSIONS

- **Login = email + password** through a proper auth provider (no home-made password storage): email verification, invitation by email link (admins invite funder admins and project-owner users; funder admins invite their own users), password reset with an expiring token, minimum 12 characters with a breached-password check, rate limiting and temporary lockout, session expiry, **mandatory 2FA (TOTP) for platform admins**, SSO (Microsoft / Google) later. No shared accounts. Logins and admin actions go to an audit log.
- **Roles**: `platform_admin` (Carbone Farmers: everything), `staff` (edit farms, projects and content; no user or financial administration), `project_owner_user` (porteur: sees its own projects and farms, follow-up, funding status; sees the identities of the farms of its own cooperative only), `funder_admin`, `funder_user` (see 4D), `farmer` (later: sees its own farm, approves story and photos), `public` (anonymous visitor: aggregated and anonymised data only).
- **Permissions are enforced in the backend / database (row-level security), not only in the interface.** A funder can never read another funder's allocations, prices or contracts; a porteur never sees another porteur's farms; identifying farm data (name, farmer, address, SIRET, exact coordinates) only for the roles entitled to it. Write one test per role proving what it can and cannot read.

## 5. PAGES

1. **Home**: live counters from real data (1,113 farms in the Master List and growing, hectares ≈ 200,000 ha SAU, labelled volume ≈ 620,000 tCO₂e over 5 years, volume sold, volume available), map teaser, how it works, featured projects.
2. **Map (core)** — port every feature of the existing Carbone Farmers Leaflet map (`carbone_farmers_map_pro`): status / project / type filters, commune search with autocomplete and nearby-farms list (with available volume), radius search, département zone statistics, bassin-versant selection, river buffer, KML/KMZ upload, CSV exports, live counters (visible farms, SAU, volume total / available). Rebuild them on top of the selection engine (4B). All farms with lat/lng (1,112 of 1,113 have coordinates), clustering, filters (project, porteur, région/département, typology, LBC status, lever, hectares, available volume, vintage), commune search (reuse the 33,335-commune index of the existing Carbone Farmers Leaflet map), Map / List / Table views, shareable URLs, side panel farm card. Respect the privacy blur (9).
3. **Project page**: header (status, label, porteur), **"Fiche de référence client" with the 8 blocks (4.1)**, key numbers, trajectory chart (initial / R25 / prospective), annual volumes by vintage, annual follow-up tab, financing & remuneration (Sankey), levers with cost and abatement, co-benefits scorecards, storytelling, farms grid + mini-map, documents, PDF export "dossier client" (answers a tender: same 8 headings).
4. **Farm page** (mirror of the existing "Fiche ferme" PPT): hero KPIs (expected / measured tCO₂e, % avoidance vs storage, hectares, farm id, LBC dossier), identity table, 5-campaign roadmap, trajectory chart, action plan per lever family with credits per emission item, follow-up results and farmer payment share, dedicated agronomist, farm story (context / motivation / stakes) and photo gallery (portrait, farmstead, cover crop, crop in place), PDF export in the charter.
5. **Annual follow-up hub** (`/suivis`): per project and year, planned vs measured, verification status, downloadable monitoring reports.
6. **Levers library**, 7. **Impact & transparency dashboard + methodology** (additionality, permanence/reversal, double counting, rabais, uncertainty), 8. **Stories**, 9. **Buyer area** (my contribution, farms financed on a map, certificates, co-branded impact report), 10. **Admin**.
10. **Funder portal** (supersedes item 9): see 4D: my portfolio, available credits, % funded and remaining credits per farm and project, certificates, reports, notifications.
11. **Organisation and user management** (admin): organisations (funders, project owners, partners), their users and invitations, seats, status; for each funder the list of its allocations; for each project owner the list of its projects.
12. **Admin console** (full CRUD, draft/published, audit log): farms (exploitations), projects, project owners, funders, users, allocations (with the over-allocation guard), levers and lever costs, crops, co-benefit values, annual follow-ups, stories, photos, documents, certificate and PDF templates, import centre (section 6), score settings (4C), vocabularies and statuses.
13. **Compare**: side-by-side comparison of 2–3 farms or projects (carbon, cost, co-benefits, funding).

## 6. IMPORT CENTRE AND DATA UPDATES (critical: 1,140+ farms today, plan for 10,000)

The Data Master is not a one-off migration: the team will re-import updated files again and again. Design the import as a repeatable, safe, idempotent process.

- **Stable key = `farm.id`** (e.g. CVL2-062). Never use SIRET as the key: 731 of the 1,113 farms of the Data Master have no SIRET. Importing the same file twice must change nothing. **Duplicate ids inside a file are an error** (the current Leaflet map data already contains one duplicated id, ADA-002, given to two different farms: the importer must catch this class of problem and report it, not guess).
- **Dry run first**: upload → validation → **preview of the differences** (created / updated with before and after values / unchanged / present in the database but absent from the file / errors and warnings) → admin approves → applied by a background job with a progress bar. A farm absent from a file is never deleted: it is flagged "absent from last import".
- **Field ownership**: an import may overwrite *imported* fields (carbon values, co-benefit values, status, volumes, lever flags, coordinates). It never overwrites *platform-owned* fields (narrative, photos, consent and visibility flags, allocations, certificates, manual corrections marked "locked").
- **History and rollback**: every import is stored (file, user, date, counts); every farm field keeps its change history (old value, new value, source import, author); one click rolls back a whole import.
- **Several sources, one pipeline**: Data Master (`Master List` + project sheets), annual follow-up sheets (R25…R29), new-farm files, crops (assolement), lever costs, organisations, users, allocations, co-benefit values, media manifest. **Generate for each one an Excel template with a data dictionary** (column, meaning, unit, allowed values, example, required or not) from the database schema, downloadable from the import centre, so the team can prepare files without help.
- **Parsing rules**: map columns by header name (not position); handle the multi-row header (group / unit / label); coerce `#DIV/0!`, text and empty cells in numeric columns to null (reported, not hidden); accept French decimals and percentages; for CVL2 the project sheet wins over the Master List for the follow-up columns.
- **Validation rules** (each reported with sheet and row number, downloadable as an Excel error report): id format and uniqueness; project exists; coordinates inside France and not swapped; SAU > 0; percentages between 0 and 1; avoidance + storage = total within a tolerance; statuses belong to the controlled vocabulary (Diags en cours, En instruction, Labellisé, Sold Out, Désengagé; the current map also uses "En construction": map it explicitly); sold volume ≤ labelled volume; funder volumes never above the labelled volume.
- **Scale**: chunked processing, background jobs, database indexes (project, status, région, département, geometry), server-side pagination, clustering and filtering for the map (never ship 1,000+ farms to the browser), cached aggregates refreshed after each import and each allocation change.
- **Snapshots**: every import and every funder report stores a snapshot id and a "data as of" date, so that a report generated in March can be reproduced in December.
- **Public-side whitelist**: SIRET, exact address, phone and farmer identity are never exposed publicly (section 9).
- **Admin editing without Excel**: any farm, project, organisation, user or allocation can also be created or edited by form, with the same validation as the import.
- Optional Zoho CRM sync for funders and proposals (API-ready, no hard dependency).

## 7. DATA QUALITY RULES (show, don't hide)

- Every KPI shows source + date + status badge (Estimated / Measured / Verified / Audited).
- Never show an extrapolation as a result: always label "end-of-project estimate, subject to annual monitoring and audit".
- Flag known inconsistencies on import (e.g. CVL2: 111 farms / 67,948 tCO₂e in the Data Master vs 112 farms engaged / 68,339 tCO₂e in the project sheet, and 109 followed).
- Missing data = explicit "to be provided" state with an owner, never a placeholder number.

## 8. NON-FUNCTIONAL

Lighthouse ≥ 90 mobile, lazy maps/images, SEO + Open Graph for project/farm pages, WCAG AA with data-table fallbacks for charts, smoke tests per page, loading/empty/error states.

## 9. PRIVACY / GDPR / SECURITY (important)

**Lesson from the current map:** it ships the full farm list (names, farmer names, addresses) inside the public HTML and only hides it behind a client-side password check, so anyone can read it by viewing the page source. Farmgate Credits must never do that: the public API returns only blurred coordinates and non-identifying fields; identifying data is served only to authenticated admin/buyer roles by the backend (server-side authorisation, no password or data in the front-end bundle). Admin access uses real accounts with roles.

Farmers are individuals: public pages show farm name only if the farmer opted in; otherwise "Ferme CVL2-062". Exact coordinates are blurred (e.g. 2–5 km radius, per-farm setting); SIRET, address and phone stay private. Consent flag per farm, legal pages, cookie banner. Buyer-only views can show more detail after login. Do not seed the public demo with real names.

## 10. BUILD PLAN (one phase per message, confirm each)

**PHASE 0**: scaffolding, design system from the sheets' charter, i18n, full schema (sections 4 and 4D–4F), email + password login, roles and row-level security, audit log.
**PHASE 1**: import centre for the Data Master (dry run, diff, idempotent upsert, history, error report, template generation) and the co-benefit catalogue seed; public map with real data; selection analytics engine (4B) on carbon + the 14 co-benefits already collected (Master List coverage 0–55 % per indicator).
**PHASE 2**: project page (8-block client reference sheet + trajectory chart) and farm page (4E: presentation, assolement, levers, photos, narrative, map) with the PDF summary sheet.
**PHASE 3**: annual follow-up module (R25 for CVL2) and project aggregation (initial / generated / end-of-project).
**PHASE 4**: **funders and allocations (4D)**: organisations and users with invitations, allocations with the over-allocation guard, % funded and remaining credits per farm / project / portfolio, opening balances from `Volume Vendu`, funder portal, certificates and credit ledger.
**PHASE 5**: levers and lever costs, co-benefits (environmental now; social and territorial fields), euro breakdown (Sankey).
**PHASE 6**: scores (Biodiversité and Eau, with the reference test cases of 4C), selection builder and quote / proposal flow.
**PHASE 7**: admin completion: import templates for every source, rollback, notifications, project-owner portal, compare page.
**PHASE 8**: public dashboard, methodology, data downloads, embeddable funder widget.
**PHASE 9**: performance, SEO, accessibility, security review (role tests), backups, deployment in the EU.

Start with PHASE 0 and PHASE 1. Ask me only for what blocks you (logo and brand files, the Excel file, photos). Anything not in the Data Master (contract terms, total cost, remuneration split, MRV details, social co-benefits, cost per lever) is entered by an admin form and shown as "to be provided" until then.

---

## 11. OPEN POINTS TO RESOLVE WITH THE TEAM (Claude Code: surface these in the admin as "à valider", never hide them)

1. **CVL2 figures**: Data Master 111 farms / 67,948 tCO2e labelled vs project sheet 112 engaged farms / 68,339 tCO2e / 109 followed. Which one is the reference?
2. **Biodiversity score**: three overlapping cover indicators (double counting), mixed units (fraction vs %), missing data counted as 0, relative scale 50–95 depends on the selection.
3. **Water score**: validate the 20/10/10 split, the content of "autres", the thresholds, and the replacement of the hand-typed score.
4. **Data not in any file yet**: contract terms, total project cost in €, remuneration split, MRV details, transition cost per lever (€/ha), social and territorial co-benefits, 50 of the 64 co-benefit indicators (humified carbon, Simpson, IAE, EIQ, N/P/K quantities, protein, Agribest scores…).
5. **Sold volume** in the SEDIF workbook is computed as a flat 3.33 % of labelled credits: confirm whether this is a real figure or a placeholder.
6. **Farm sheet R25**: lever-level changes observed at follow-up are blank ("à renseigner"); the story and photo slides are empty templates.
7. **Current map**: it publishes the full farm list in its public HTML behind a client-side password; take it offline or anonymise it before Farmgate Credits goes live.

8. **Count of farms**: the Data Master `Master List` holds 1,113 farms with an id, the current Leaflet map embeds 1,429 farm records (including farms "En construction"), and the team speaks of 1,140+. Reconcile the three counts and name the reference file. The importer must handle any additional file.
9. **Assolement (crop mix)** is missing for all farms (`Productions` column empty): which files hold it (PAC / Télépac, "Assolement et ITK") and who prepares the import?
10. **Lever costs** (€/ha, one-off and annual) are not in any file: who provides them and in which format?
11. **Historical sales** (≈ 126,000 tCO₂e in `Volume Vendu`) have no funder attached: who assigns them?
12. **Funding rules**: which statuses count as "funded" (reserved or contracted?), how a collective-project allocation is spread over the farms (pro rata of volume, of SAU, or manual), what happens when a farm withdraws (replacement, buffer, refund).
13. **Funder visibility**: named, anonymised or private by default? Contribution certificate wording and registry references to be validated by Carbone Farmers / legal.
14. **Photos and narrative**: who collects them, with which consent form (image rights, GDPR), and who approves the farm stories before publication?

---

## 12. FIRST MESSAGE TO SEND TO CLAUDE CODE

```text
Read CLAUDE.md fully (it is the complete brief) and open the files in ./inputs/.
Then do PHASE 0 and PHASE 1 only:
1. Propose the final architecture and the database schema (entities of sections 4 and 4D to 4F, including organisations, users, roles with row-level security, allocations and the import history tables), wait for my OK on stack choices only if something blocks you.
2. Scaffold the app, the design system and i18n (FR default, EN).
3. Write the Excel importer for the Data Master (Master List + CVL2 sheet): map columns by header name, handle the multi-row header, coerce #DIV/0! and text in numeric cells to null, produce an import report (missing coordinates, unknown projects, duplicates between Master List and project sheets, CVL2 count/volume gaps).
4. Seed the co-benefit catalogue from cobenefit_catalogue.csv.
5. Build the public map with real data (only blurred coordinates and non-identifying fields in the public API) and the selection engine (section 4B) on carbon data and the 14 co-benefits already collected.
6. Write the unit tests: aggregation rules (4B) and the Biodiversity and Eau scores against the reference workbooks in ./inputs/ (4C).
Run the app and the tests, then report: what works, what is missing, which data is missing, and the open points of section 11 that block the next phase. Do not start PHASE 2 before my go.
```

Alternative for Base44: paste sections 1 to 10, then send PHASE 0 and PHASE 1 as the first request, and upload the files of section 0 in the chat.
