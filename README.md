# TVM Portal — Threat & Vulnerability Management System

Desktop VAPT management app (Electron + React + TypeScript) that replaces Excel-based
tracking. **Filesystem-first**: all data lives in a portable folder of JSON files —
no database, fully offline, SharePoint/OneDrive-sync friendly.

## Run

```bash
npm install
npm run dev        # development (hot reload)
npm run build      # production build into out/
npm start          # preview the production build
npm run typecheck  # typecheck main + renderer
```

## Modules

| Module | What it does |
|---|---|
| **Dashboard** | Stat tiles (open/overdue/SLA compliance/avg closure), findings by severity, open vs closed, monthly 12-month trend (Month-Year labels), OWASP Top 10 mapping, CWE distribution, application & host risk rankings |
| **Requests** | Project Code Requests: `VAPT-YYYYMMDD-HHMMSS` auto-generated, or parsed from Power Automate subjects (`[VAPT-…] VAPT Request - Name`); requester name/email/department, system name, UAT & go-live dates, purpose |
| **Applications** | Application inventory: business unit, owner, tech stack, criticality, risk rating. Open Findings count **excludes Info** severity |
| **Hosts** | Read-only **inventory** (no manual creation): hosts populated from scan imports, organised as a tree Application → Assessment Type → Period → Scan → Hosts, each row showing open findings by Critical/High/Medium/Low |
| **Assessments** | Three independent modules — **Web Application** (Web/API/Mobile), **Internal/External**, **Host** — each with its own assessments, request tracking and per-application findings view; timeframe (annual/quarterly/adhoc). Import Scan offers **Fetch from Scanner / Upload .nessus / Upload CSV** |
| **Findings** | Reached **only through the assessment modules** (no standalone page), per application, scoped by module/timeframe with severity checkboxes. **Affected Asset** replaces host (free text for web: URL/endpoint/API route/cookie/parameter; auto-populated host list for internal/external/host). Multiple **evidence attachments** per finding (png/jpg/jpeg/gif/txt/zip). Info is excluded from dashboard/application totals |
| **Retests** | Retest sessions linked to a baseline; compare any two assessments → new / resolved / recurring / severity changes |
| **Reports** | Excel, Word and PDF with executive summary, risk summary, SLA summary, retest summary and technical findings |
| **Knowledge Base** | Reusable vulnerability templates (description, risk, recommendation, CVE/CWE/OWASP) |
| **Search** | Global search bar across applications, hosts, findings, CVEs, IPs, endpoints, project codes |
| **Settings** | Sections: General, Storage, **Scanner Connections** (Nessus / Tenable.io — name, URL, access/secret keys, default, Test Connection), Report Templates, Backup, About |
| **Notifications** | Bell menu: SLA breaches, assessments starting within 7 days, retest-due findings |

## Scanner integration

Configure connections in **Settings → Scanner Connections** (API-key auth for Nessus
Professional/Manager and Tenable.io). From an assessment, **Import Scan → Fetch from
Scanner** lists the scanner's scans and pulls the chosen one straight into the assessment
via the same import pipeline as file upload. `.nessus`/CSV upload remains the fallback.
Client lives in `src/main/scanner.ts` (export → poll → download).

## Key mechanics

- **Fingerprint** (`src/main/fingerprint.ts`): `sha256(host_id | ip | port | plugin_id | endpoint | parameter)`
  (normalised; manual findings fall back to the title when there is no plugin id). Drives
  deduplication on import, retest detection and regression tracking. Classifications:
  *New* (no prior match), *Retest* (matches a still-open finding), *Regression* (matches a
  closed one), *Context Change* (matched host changed internal/external exposure).
- **Nessus import** (`src/main/nessus.ts`, parsers in `nessus-parse.ts`): `.nessus`/XML and CSV
  exports. Auto-creates unknown hosts, attaches them to the assessment, skips fingerprint
  duplicates, classifies against application history, and archives the raw scan under
  `<data>/imports/`.
- **SLA** (`src/shared/sla.ts`): Critical 30 / High 60 / Medium 90 / Low 180 days from the
  discovered date. Recomputed server-side on every finding write; closing a finding stamps
  `closedDate`, reopening clears it.
- **Storage** (`src/main/store.ts`): simple collections are one JSON file each; findings and
  hosts use audit-oriented directory trees (SRS v3):
  `web-findings|internal-external-findings|host-findings/<timeframe>/<application|project-code>/findings.json`
  and `hosts/<nessus-file|manual>/<ip>.json` + `summary.json` per import. Legacy single-file
  data is migrated automatically on first write. The data folder is configurable in Settings —
  point it at a synced folder for SharePoint. Every write is atomic (tmp file + rename) and
  immediate (auto-save).
- **Reports** (`src/main/reports.ts`, guidelines in `REPORTING.md`): Excel (Summary, Findings,
  SLA Tracking, Host Mapping, Severity Distribution), Word (cover page with project code, TOC,
  findings detail, appendices), PDF in Executive-only or Full Technical editions via a hidden
  window + `printToPDF` (no extra native deps).

## Smoke test

`TVM_SCREENSHOT=/tmp/ui.png npx electron out/main/index.js` boots the app, captures the
rendered window to the given path and exits — handy for CI.
