<!-- /** THIS FILE DOES: Explains research categories, entity schema fields, coordinate and date rules, copyright policy, bias mitigations, and submission workflow, ROLE: Data, MAINTAINER NOTE: Keep categories stable; adding one requires schema major version bump **/ -->

# Data Taxonomy

## 10 Research Categories

1. **Genomics** — DNA sequencing, genetic variants, CRISPR, polygenic risk, ancestry studies
2. **Oncology** — Cancer biology, tumor immunotherapy, solid and hematologic malignancies
3. **Neuroscience** — Brain circuitry, neurodegeneration, psychiatric disorders, neuroinflammation
4. **Infectious Disease** — Virology, bacteriology, parasitology, pandemic preparedness, vaccine development
5. **Immunology** — T cells, B cells, innate immunity, autoimmunity, transplant rejection
6. **Cardiometabolic** — Heart disease, diabetes, obesity, lipid metabolism, vascular biology
7. **Regenerative Medicine** — Stem cells, tissue engineering, organ transplantation, wound healing
8. **Public Health** — Epidemiology, health economics, environmental health, health disparities
9. **AI in Medicine** — Machine learning for diagnosis, predictive models, drug discovery, clinical decision support
10. **Rare Disease** — Orphan drugs, ultra-rare genetic disorders, small patient populations

## Entity Schema Fields

Every research entity has exactly these fields:

### Identifiers
- **id** — Deterministic: always `pmid-{pmid}` (required)
- **ids.pmid** — PubMed ID, 1–9 digits (required)
- **ids.pmcid** — PubMed Central ID, format PMCnnnnnnn (optional)
- **ids.doi** — Digital Object Identifier, 10.xxxx/... format (optional)

### Publication Metadata
- **title** — Exact article title from PubMed (10–300 chars; titles are factual, not copyrighted)
- **date** — Publication date (YYYY-MM-DD, UTC); year MUST match shard year. Use PubMed pubdate; if only month known, use day 01
- **journal** — Journal name (2–120 chars)

### Geographic & Institutional
- **institution.name** — Primary affiliation of corresponding author, else first author (2–160 chars); used for Wikipedia reference photo lookup
- **institution.city** — City (2–80 chars); used for reference photo fallback and institution location
- **institution.country** — ISO 3166-1 alpha-2 code (US, GB, DE, etc.); drives the globe CountryPanel (clicking a country shows all papers where institution.country matches)
- **institution.lat** — Latitude, -90 to 90, rounded to 2 decimal places
- **institution.lng** — Longitude, -180 to 180, rounded to 2 decimal places

### Content
- **category** — One of the 10 enums above (required)
- **summary** — Original plain-language summary (40–400 chars, own words, never paste abstract)
- **authors** — Array of 1–6 author names (2–80 chars each)
- **authorsTruncated** — Boolean; true if the paper has more authors than listed

### Provenance
- **sources.pubmed** — Must equal `https://pubmed.ncbi.nlm.nih.gov/{pmid}/` (derived)
- **sources.archive** — Must equal `https://web.archive.org/web/2/{sources.pubmed}` (derived)
- **verified.method** — Enum: 'ncbi-esummary' or 'manual'
- **verified.date** — YYYY-MM-DD when this record was last checked against PubMed

## Derived Field Rules

These are automatically validated by `scripts/validate-shards.mjs` and cannot be edited manually:

- `id === 'pmid-' + ids.pmid`
- `date` year must equal the shard's year
- `sources.pubmed === 'https://pubmed.ncbi.nlm.nih.gov/' + ids.pmid + '/'`
- `sources.archive === 'https://web.archive.org/web/2/' + sources.pubmed`
- PMID must be unique across all shards (no duplicates in different years)
- Entities sorted by date ascending within each shard

## Coordinate Rules

- **Primary affiliation** is the corresponding author's institution; if no corresponding author is marked on PubMed, use the first author's affiliation
- **Latitude/Longitude** are the centroid of the city (use Google Maps or GeoNames)
- **Rounding** to 2 decimal places (0.01 degree ≈ 1.1 km at the equator)
- **Range validation** — lat -90..90, lng -180..180

## Date Rules

- **Source** — use PubMed's `pubdate` (publication date); if the article was published ahead-of-print without a full date, use the provided month and 01 for day
- **Format** — YYYY-MM-DD, UTC
- **Shard validation** — the year in the date MUST equal the filename year (e.g., 2024/research_pubmed.json contains only 2024 dates)
- **Never use** `new Date('YYYY-MM-DD')` (locale trap); always use `Date.UTC(y, m-1, d)`

## Copyright & Content Rules

- **Summaries** are original work by the maintainer; write in plain language suitable for a non-specialist (e.g., "This study found that X treatment reduced tumor size by Y% in mice")
- **Never paste abstracts** — abstracts are copyrighted by the journal
- **Never copy titles with interpretation** — article titles are facts and not copyrighted
- **IDs and metadata** are public fact records from PubMed and are in the public domain

## Bias Mitigations

The catalog enforces these constraints to prevent geographic, institutional, and journal bias:

1. **Regional diversity** — No single country should have > 30% of papers
2. **Institutional balance** — No single institution should contribute > 10% of papers
3. **Journal balance** — No single journal should dominate; prefer peer-reviewed journals indexed on PubMed
4. **Peer-reviewed only** — Every entry must be indexed on PubMed (automatic filter)
5. **Retraction checks** — Before adding any entity, search PubMed's "Retracted Publication" type to ensure it has not been retracted

## Retraction Check Procedure

1. Go to https://pubmed.ncbi.nlm.nih.gov/
2. Search: `{pmid} AND ("Retracted Publication"[PT])`
3. If results appear, the paper is retracted; do not add it
4. Document the check date in `verified.date`

## How to Add a Paper

1. Find a peer-reviewed article on PubMed with a 4-digit year and all required metadata
2. Confirm it is not retracted (see above)
3. Extract: PMID, DOI (if present), PMCID (if present), exact title, journal, authors (list up to 6; mark authorsTruncated=true if there are more)
4. Find the corresponding author's affiliation (or first author if none listed); look up the institution, city, country (ISO 2-letter)
5. Look up lat/lng for that city (Google Maps, GeoNames); round to 2 decimal places
6. Write a 40–400 character plain-language summary in your own words (explain the key finding for a general science audience)
7. Pick the single best-fit category from the 10 options
8. Open a GitHub issue using the [Study] submission template; fill all fields
9. The maintainer will validate against PubMed, check constraints, and merge the entry into the appropriate year's shard

## Data Validation

Run `node scripts/validate-shards.mjs` locally to check:
- Schema compliance (types, patterns, lengths, enums, required fields)
- Derived-field rules (id, date year, sources URLs, PMID uniqueness)
- Manifest consistency (every shard listed exists; every file on disk is listed)
- File headers (every file's first line carries the THIS FILE DOES / ROLE / MAINTAINER NOTE header; format per file type in RUNBOOK.md)
- HTTPS-only URLs (no http:// anywhere in data)
- Entity counts per shard (minimum 5 entries)

For full details, see `.github/workflows/validate.yml` and `scripts/validate-shards.mjs`.
