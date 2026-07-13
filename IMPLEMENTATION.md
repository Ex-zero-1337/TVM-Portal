# TVM Portal — Implementation Reference

**App version:** 1.6.2 (mirrors SRS patch level v6.2 + fixes) · **Stack:** Electron + React + TypeScript (electron-vite) · **Storage:** filesystem JSON, no database

This is the single reference for future updates, enhancements, and fixes.
It describes what the application does today, where every behavior lives in
the code, and the conventions to follow when changing it. Update this file
with every patch.

SRS documents live one level above the repo root (`../TVM_Portal_SRS_Patch_*.md`).

---

## 1. Version history

| Version | SRS document | Summary |
|---------|--------------|---------|
| v3 (baseline) | — | Filesystem storage layout, project code generation/parsing, SLA engine, fingerprint engine |
| v4 | `..._v4.md` | Open Findings excludes Info; Affected Asset replaces Associated Host; multi-evidence attachments; scanner integration (Nessus/Tenable.io) + Scanner Connections settings; host inventory tree; assessment-centric import workflow; standalone Findings page removed |
| v5 | `..._v5.md` | Navigation update (Inventory, Post Assessment, Charts); assessment summary Open Findings excl. Info; inventory multi-select + UAT/Test/Unknown environments + Pending/In Progress/Completed status; adhoc finding → Project Code traceability; New/Existing finding lifecycle with First Identified provenance; Charts module (copy/PNG/PDF/table export) |
| v6 | `..._v6_Theme_Support.md` | Light / Dark / System appearance, persisted in config, live OS-follow; theme-aware charts; reports keep standard light formatting |
| v6.1 | `..._v6_1_Web_Request_Integration.md` | Top-level Project Code Requests page removed (module Request tabs are the source of truth); adhoc web findings driven by Project Code; application auto-linked from the code server-side |
| v6.2 | `..._v6_2_Web_Assessment_Finding_Context.md` | Web Findings tab selects one working context; New Finding form drops Assessment + Project Code fields; adhoc Web assessment (`Adhoc Web — <code>`) auto-created per project code |
| v6.2 fix | user request (2026-07-07) | Request.Application now **optional** (a code is a standalone adhoc context); web Findings context selector offers **both** Project Codes (adhoc) and Applications (annual/quarterly) so the two workflows never clash |
| v6.3 | `..._v6_3_System_Logs_and_Diagnostics.md` | Centralized logging framework: daily JSONL logs with retention, automatic main/renderer/IPC error capture with safe stacks, secret redaction, Settings → Logs (view/search/filter/export/clear), diagnostic bundle (zip, secrets redacted) |
| v6.5 | `..._v6_5_Nessus_Fetch_Workflow_Redesign.md` | Scanner-driven, policy-driven fetch: module-level **Fetch All / Fetch Selected Only** buttons create one assessment per imported scan with **no Application required** (map later); assessments gain Move-to-module + type-`delete` deletion; Application optional on New Assessment |
| v6.5.1 | `..._v6_5_1_Nessus_Policy_Name_Filtering.md` | Policy filtering now uses the **Nessus Policy Name** (read per scan from scan details), never scan name/application/folder; unmatched scans hidden by default (explicit override checkbox restored per user request); Int/Ext type decided by policy name |
| v6.6 | `..._v6_6_Findings_Context_Selection.md` | (Superseded by v6.6.1 the same day — implemented briefly as a radio Selection Mode) |
| v6.6.1 | `..._v6_6_1_Findings_Filter_Enhancement.md` | Findings tab has three **coexisting** filters in all modules: Timeframe (unchanged), Project Code / Application, and **Assessment Name** (from the module's Assessment tab); either of the last two suffices to display findings, both together narrow further; new findings attach to the selected assessment when that filter is set |
| v6.6.2 | user request (2026-07-13) | Inbox intake (`inbox.ts`) accepts the **native Power Automate SharePoint export schema** (`requestNumber`, `emailAddress`, `departmentDivision`, `targetDateToGoLive`/`targetDateOfUatCompletionServerReadiness` as Excel date serials, `typeOfSystem` → assessment type, review/approval fields folded into notes, `_x000D_` cleanup); watcher only consumes files named `VAPT*.json`/`VAPT*.txt` (other files in the inbox are ignored); legacy Compose field names remain as aliases; portal-side defaults (status New, priority Medium, environment Production) unchanged. Request storage moved from single `requests.json` to **one file per request** (`requests/<projectCode>.json`), mirroring Power Automate's one-JSON-per-request output; legacy `requests.json` auto-migrates on first write |
| v6.6.3 | user request (2026-07-13) | **Configurable storage locations** (Settings → Storage): reports, requests, web / internal / external findings each get their own folder (blank = default under dataDir); changing one migrates the files and never touches foreign JSON in a user-chosen folder. Findings storage **splits the combined `internal-external-findings` tree** into `internal-findings/` + `external-findings/` (by assessment type; Retest → internal), legacy tree still read and cleaned up on write. Module **Request tabs order by scheduling urgency**: soonest go-live first → target UAT completion as fallback → undated requests last, first-come-first-served; new Go-Live column shows the driving date |
| v6.6.4 | user request (2026-07-13) | Storage Location rows wrap correctly at narrow window widths (path shrinks, buttons keep their size). Request tab columns trimmed: System / Application / Priority hidden for now, **UAT Completion** column added, Project Code column widened. Charts → Application scope gains a **View by** selector: build the severity chart per Application or per **Project Code** (adhoc web findings are keyed by code) |
| v6.6.5 / 1.6.7 | user request (2026-07-13) | Window opens **maximized** by default (still resizable; shown after maximize to avoid a small-window flash). Portable build `TVM-Portal-Portable-1.6.7.exe` released with all v6.6.2–v6.6.4 changes |
| v6.6.6 | user request (2026-07-13) | Stored request files use the **exact Power Automate export schema** (`pa-format.ts`): PA fields verbatim at the top level (requestNumber, emailAddress, departmentDivision, Excel-serial dates, doesTheSystem, attachments, approval/review fields, …) with portal-only data nested under `portal`. Intake keeps the verbatim export as `VaptRequest.source`. Loader accepts all three shapes: PA+portal (current), flat pre-v6.6.6 records (migrated on next write), and **raw PA exports without a portal block** (adopted with defaults, id = request number). Stale-cleanup recognizes `portal.id` |
| v6.6.7 | user request (2026-07-13) | **Live requests folder** (`RequestsWatcher` in `inbox.ts`): external file adds/deletes in the requests folder (Finder, SharePoint sync, a flow writing directly) reflect in the UI within seconds — fs events + 30 s signature poll → `store.invalidate('requests')` + `data-changed`. Restarts when the folder is relocated in Settings. Note: the main-process cache means direct file edits are otherwise only seen at startup; only `inbox/` and `requests/` are watched live |
| v6.6.8 | user request (2026-07-13) | **Request detail view** (click a row on any Request tab): shows every Power Automate export field from `request.source` — additional recipients, type of system, system properties (doesTheSystem), approval status/comments, reviewer + time of review, and clickable attachment links — alongside the portal fields; Edit opens the form as before. Detail view sections carry a single restrained brand-blue left-border accent (per-section rainbow tones and emoji were tried and rejected as unprofessional); approval status renders as a subtle green chip when acknowledged/approved. **Notes are no longer auto-filled on intake/adoption** — every export field is visible in the detail view, so Notes stays empty until the analyst writes their own (existing auto-summaries in stored files are left as-is). Released as portable build 1.6.8 |
| v6.6.9 | user request (2026-07-13) | **Finding detail view** restructured like the request detail (shared `DetailSection`/`DetailField` in `ui.tsx`): Overview / Affected Asset / References / Timeline & SLA / Description / POC / Recommendation sections. Host findings show the affected host's **IP, hostname, OS, environment, exposure and source scan**, plus a **Passed/Failed** result chip (Failed while Open/In Remediation/Risk Accepted; Passed when Resolved/Closed). Nessus XML import now **parses the OS** from HostProperties (`operating-system`/`os`) and backfills blank host OS on re-import (CSV exports carry no OS). "Attach evidence" renamed **"+ Attach POC"**; attachments heading now "Proof of Concept (POC)" |
| v6.6.10 | user request (2026-07-13) | **Compliance-audit support** in Nessus XML import: finding title = `cm:compliance-check-name` (e.g. "6.3.2.2 Ensure audit logs are not automatically deleted"), description/solution/evidence from `cm:compliance-info`/`-solution`/`-actual-value`, and `cm:compliance-result` mapped to status (**PASSED → Closed** with closedDate, else Open). Compliance checks share one plugin id, so the **check name is part of the fingerprint** (else all checks after the first were duplicate-skipped). Findings table: **Class column removed**, **Aging column added** (days open, overdue-highlighted, sortable); host module Status column shows **Passed/Failed** chips (derived — stored statuses unchanged). Re-import scans to pick up check names/results; old generic rows should be deleted first (new fingerprints won't match them) |
| v6.6.11 | user request (2026-07-13) | Module toolbar gains **"⬆ Import Nessus/CSV File(s)"** beside the fetch buttons (all modules): multi-select file dialog, **one assessment per file** mirroring the fetch flow (`nessus:importFiles` IPC; Int/Ext type guessed from the file name, editable after). Finding gains **`pluginName`** — compliance findings keep the plugin family ("Unix Compliance Checks") in References → Plugin while the title carries the check name. **CVSS column hidden in the host module** (not applicable to compliance audits) |
| v6.6.12 | user request (2026-07-13) | Assessment tab (all modules): **row checkboxes + "Remove Selected (n)"** with type-`remove` confirmation. Removal **cascades to disk** (`assessments:removeMany` IPC + `store.removeMany`, one persist): deletes the assessments, their findings (finding trees rewritten), the findings' `evidence/<id>/` folders, and hosts left unreferenced by any remaining assessment/finding. Single Edit→Delete (type `delete`) keeps its non-cascade v6.5 behavior |
| v6.6.13 | user request (2026-07-13) | Request **status reflects the export's `approvalStatus`** (`requestStatusOf` in `pa-format.ts`): "Acknowledge(d)" → new **Acknowledge** status (added to `RequestStatus` + green badge), "Approve(d)" → Approved, "Pending…" → Pending Approval; unrecognized values keep New. Applies on inbox intake, folder adoption, **and stored files still at New** (a manually progressed status always wins); fully editable afterwards |
| v6.6.14 | user request (2026-07-13) | **Context directories** (`store.contextDir`): one browsable folder per working context — `<findings-root>/<timeframe>/<projectCode \| application \| assessment name>/` (unmapped scanner imports use the assessment name, not "unassigned"; adhoc host findings get per-**IP** subfolders). Everything co-locates there: `findings.json`, **POC under `evidence/<findingId>/`** (new attachments; old central `evidence/` paths still resolve), and **reports default-save into the context folder** (dialog still allows anywhere). `store.resolve` accepts absolute paths + `storablePath` keeps attachment paths relative when inside the data folder. Existing findings repartitioned on next write. Released as portable build **1.6.9** (includes v6.6.9–v6.6.14) |

---

## 2. Build, run, release

```bash
npm run dev          # live-reload dev app
npm run typecheck    # tsc for main (tsconfig.node.json) + renderer (tsconfig.web.json)
npm run build        # electron-vite production bundle → out/
npm run dist:win     # Windows installer (NSIS) + portable exe → release/

# standalone portable .exe only:
npx electron-vite build && npx electron-builder --win portable --x64
```

- Artifacts land in `release/` (`TVM-Portal-Portable-<version>.exe`,
  `TVM-Portal-Setup-<version>.exe`). Keep `package.json` `version` in sync
  with the SRS level (`1.6.2` ↔ SRS v6.2).
- **Portable build behavior**: config and data live beside the executable
  (`config.json`, `tvm-data/`) via `PORTABLE_EXECUTABLE_DIR` — the whole app
  travels on a USB stick / network share. Installed builds use
  `%APPDATA%/tvm-portal` (`app.getPath('userData')`).

---

## 3. Architecture

```
src/
├── main/                 Electron main process (Node)
│   ├── index.ts          App bootstrap, BrowserWindow, inbox watcher startup
│   ├── store.ts          Persistence + Settings; partitioned findings/hosts layout; atomic writes
│   ├── ipc.ts            ALL IPC handlers + server-side hooks (prepareFinding/Request/Assessment)
│   ├── fingerprint.ts    fingerprintOf, classifyFinding, classifyLifecycle
│   ├── nessus.ts         Scan import pipeline
│   ├── nessus-parse.ts   .nessus XML / CSV parsers
│   ├── scanner.ts        Nessus / Tenable.io REST client (test, list scans, fetch)
│   ├── reports.ts        Excel / Word / PDF generation (theme-independent)
│   ├── notifications.ts  sla-breach / upcoming-assessment / retest-due generation
│   ├── logger.ts         Centralized logging: daily JSONL files, redaction, safe stacks, retention (v6.3)
│   └── inbox.ts          Power Automate intake folder watcher (creates requests)
├── preload/index.ts      contextBridge — mirrors every IPC handler onto window.api
├── shared/
│   ├── types.ts          Entities, unions, constants, helpers (periodLabel, project code)
│   └── sla.ts            SLA_DAYS, slaDueDate, isFindingOpen, isOverdue, slaStats
└── renderer/src/
    ├── main.tsx          Entry; restores persisted appearance before render
    ├── App.tsx           Sidebar NAV + hash-routed page switch (#dashboard, #charts…)
    ├── theme.ts          applyAppearance / useEffectiveTheme
    ├── api.ts            Typed window.api interface
    ├── data.tsx          DbProvider: loads all collections; create/update/remove + reload
    ├── styles.css        Dark default (:root vars) + [data-theme='light'] overrides
    ├── components/
    │   ├── ui.tsx        SeverityBadge, StatusBadge, DataTable (sort/filter/page), Modal, EntityForm, Toolbar
    │   └── CrudPage.tsx  Generic list + create/edit/delete page (columns, fields, defaults, validate, renderDetail)
    └── pages/            Dashboard, Applications, Assessments, Findings, Requests,
                          Hosts (Inventory), Retests (Post Assessment), Charts,
                          Reports, KnowledgeBase, Settings, Search
```

**Key flows**

- CRUD: renderer `db.create/update/remove` → `db:*` IPC → `prepare*` hook (if
  any) → `store.ts`. The renderer reloads all collections after every write.
- Scan import: Assessment detail → upload `.nessus`/CSV or scanner fetch →
  `nessus.ts` → creates hosts + findings, attaches hosts to the assessment,
  archives raw scan under `<dataDir>/imports/`.
- Live updates: main emits `data-changed` (e.g. inbox intake) → `DbProvider`
  reloads.

---

## 4. Data storage layout (`store.ts`)

- Simple collections: one JSON file each in `dataDir` (`applications.json`,
  `kb.json`, `notifications.json`, `assessments.json`).
- Requests: **one file per request** — `requests/<projectCode>.json` (e.g.
  `requests/VAPT-20260225-114815.json`), matching the one-JSON-per-request
  shape Power Automate produces (v6.6.2). Requests without a project code use
  their id as the filename. A legacy single `requests.json` is still loaded
  once and migrated to the per-file tree on the next write.
- Request file **content is the Power Automate export schema** (v6.6.6):
  top-level PA fields verbatim (`requestNumber`, `name`, `emailAddress`,
  `departmentDivision`, `systemName`, `targetDateToGoLive` /
  `targetDateOfUatCompletionServerReadiness` as Excel serials, `purpose`,
  `typeOfSystem`, plus pass-through extras like `doesTheSystem`,
  `attachments`, `approvalStatus`, `comments`, `reviewerName`,
  `timeOfReview`), portal-only fields under a nested `portal` key. Conversion
  lives in `src/main/pa-format.ts` (`toPaRequestFile` / `fromPaRequestFile`);
  a raw PA export dropped into the folder (no `portal` block) is adopted as a
  request with portal defaults and id = request number.
- Configurable locations (v6.6.3): `requestsDir`, `webFindingsDir`,
  `internalFindingsDir`, `externalFindingsDir` in Settings override the
  defaults under dataDir (`requests/`, `web-findings/`, `internal-findings/`,
  `external-findings/`). `setSettings` migrates the files when one changes;
  stale-cleanup only ever deletes JSON files carrying a portal `id`, so raw
  Power Automate exports sharing a chosen folder are never touched. Changing
  `dataDir` itself still switches workspaces without migration.
- Internal vs external findings are separate trees (v6.6.3), chosen by the
  assessment type (`External VA` → external, otherwise internal, so Retest
  lands internal); the pre-v6.6.3 combined `internal-external-findings/` tree
  is still read and is cleaned up on the next findings write.
- Findings: `<category>-findings/<timeframe>/<application|request>/…/findings.json`
  (category = web / internal-external / host). `store.repartition()` re-files
  everything after renames or category/timeframe changes — it is called from
  the update handlers for requests, assessments, and applications.
- Hosts: `hosts/<nessus_filename|manual>/<ip>.json` (+ per-import summary).
  Hosts are **never merged across imports** (FR-H3): identity per import is
  `sourceFile + ip`; the IP is the cross-import identity used by fingerprints.
- Evidence: `evidence/<findingId>/<uuid>-<filename>`.
- All writes are atomic (tmp file + rename).
- `config.json` (outside dataDir): `dataDir`, `reportsDir`, `scanners[]`,
  `appearance`.

---

## 5. Data model (`shared/types.ts`)

Collections (`CollectionMap`): `requests`, `applications`, `hosts`,
`assessments`, `findings`, `kb`, `notifications`. All extend `BaseEntity`
(`id`, `createdAt`, `updatedAt`).

| Entity | Notable fields (beyond the obvious) |
|--------|--------------------------------------|
| `VaptRequest` | `projectCode` (primary id, `VAPT-YYYYMMDD-HHMMSS`, auto-generated or parsed from `"[code] title"`); `applicationId` **optional** (v6.2 fix); `assessmentType`, `status` (8-stage `REQUEST_STATUSES`), `targetDate`/`targetUatDate`/`goLiveDate`, requester fields |
| `Application` | `criticality` (Priority), `riskRating` (Severity \| Unrated) |
| `Host` | `environment` (`ENVIRONMENTS`: Production/UAT/Development/Test/Staging/Unknown; legacy `DR` still valid), `status` (`INVENTORY_STATUSES`: Pending/In Progress/Completed), `exposure` (internal/external), `sourceFile` ('' or 'manual' = manual) |
| `Assessment` | `category` (web / internal-external / host), `timeframe` (annual/quarterly/adhoc), `type` (`CATEGORY_TYPES` limits per module), `requestId`, `hostIds[]`, `baselineAssessmentId` (retests) |
| `Finding` | `affectedAsset` (web free-text asset), `hostId` (network/host), `attachments[]` (`EVIDENCE_EXTENSIONS`: png/jpg/jpeg/gif/txt/zip), `fingerprint`, `classification` (`New \| Existing \| Retest \| Regression \| Context Change`), `projectCode`, `firstIdentified{AssessmentType,Period,ProjectCode,Date}`, `slaDueDate`, `closedDate` |
| `KbTemplate` | prefill source for manual findings |
| `AppNotification` | kind: sla-breach / upcoming-assessment / retest-due |

Helpers: `parseProjectCode`, `generateProjectCode`, `periodLabel(timeframe,
date)` → "Annual 2025" / "Q2 2026" / "Adhoc 2026", `categoryOfType` (legacy
fallback).

**Compatibility rule:** never delete union members that stored data may use
(e.g. Environment `'DR'`, old classifications) — remove them only from the
recommended-list constants that drive dropdowns.

---

## 6. Business rules (server-side)

All invariants live in `ipc.ts` hooks so UI, imports, and Power Automate
intake all get them. **Never enforce these only in a page component.**

### 6.1 `prepareFinding` (create + update) — order matters
1. **Project code → application** (v6.1): if `projectCode` is set, look up the
   request with that code; if it has an `applicationId`, it overrides the
   finding's application.
2. **Adhoc assessment auto-link** (v6.2): create-time, if `projectCode` set and
   no `assessmentId`, find-or-create the request's adhoc Web assessment
   (`Adhoc Web — <code>`, type Web, timeframe adhoc, status In Progress) and
   link it.
3. **Fingerprint**: `sha256(hostId|ip|port|pluginId-or-title|endpoint|parameter)`,
   normalized. Hosts are per-import, so the **IP** (not host record id) is the
   identity; web findings use `endpoint || affectedAsset`.
4. **SLA**: `slaDueDate` recomputed from severity + discoveredDate
   (C 30 / H 60 / M 90 / L 180 / Info 365 days). `closedDate` set when leaving
   Open/In Remediation, cleared when reopened.
5. **Classification** (create only):
   - assessment timeframe annual/quarterly → **lifecycle** (`classifyLifecycle`):
     compare fingerprint against the latest previous assessment of the same
     application + type + timeframe → `New` or `Existing` (+ carries
     `firstIdentified*` forward through chains);
   - otherwise (`adhoc`) → `classifyFinding`: `New` / `Retest` (match still
     open) / `Regression` (match was closed) / `Context Change` (host exposure
     changed).

### 6.2 `prepareRequest`
Parses `"[VAPT-…] VAPT Request - Name"` pastes into code + title; otherwise
auto-generates the code. Update triggers `store.repartition()`.

### 6.3 `prepareAssessment`
Derives `category` from `type` when absent; defaults `timeframe` to adhoc.

### 6.4 Import pipeline (`nessus.ts`)
Per row: find/create host (keyed `sourceFile+ip`, status Pending, exposure
external iff type External VA) → fingerprint by IP → skip duplicates already
in the assessment → classify (lifecycle for annual/quarterly, else retest
logic) → finding inherits the assessment request's project code → attach hosts
to assessment → archive raw scan.

---

## 7. IPC catalog (`ipc.ts` ⇄ `preload/index.ts` ⇄ `api.ts`)

| Channel | Purpose |
|---------|---------|
| `db:list / get / create / update / remove` | CRUD on any collection (create/update pass through `prepare*` hooks) |
| `settings:get / set / chooseDir` | Settings incl. `appearance`; dir picker |
| `nessus:import` | File-picker import (.nessus / CSV) into an assessment |
| `scanner:test / listScans / fetch` | Scanner API (Nessus X-ApiKeys / Tenable.io); fetch streams `scanner:progress` events (stage + percent) to the invoking window |
| `evidence:add / open / remove` | Multi-file evidence attachments per finding |
| `report:generate` | Save dialog → xlsx / docx / pdf (executive or full) |
| `chart:exportPdf` | Chart PNG data-URL → A4 PDF via hidden window `printToPDF` |
| `log:write / query / clear / export / diagnostics` | Centralized logs (v6.3): renderer log intake, filtered query, manual cleanup, JSONL export, diagnostics.zip (redacted) |
| `assessments:compare` | Baseline vs current: new / resolved / recurring / severity changes |
| `notifications:refresh` | Regenerate notification list |
| `shell:openPath` | Open folder/file in OS file manager |
| `data-changed` (main→renderer event) | Push reload (inbox intake) |

**Adding a new IPC**: handler in `ipc.ts` → mirror in `preload/index.ts` →
type in renderer `api.ts`. All three or it won't compile/run.

---

## 8. Pages & behavior

### Navigation (`App.tsx`)
Dashboard · Applications · Web Assessment · Internal / External Assessment ·
Host Assessment · Inventory · Post Assessment · Charts · Reports · Knowledge
Base · Settings. Hash deep-links (`#charts`). No top-level Requests page
(v6.1) — Search results and dashboard links route to the module pages.

### Dashboard (`Dashboard.tsx`)
Info always excluded; severity checkboxes narrow further. Stat tiles (SLA
stats), severity/open-closed bars, 12-month trend, OWASP/CWE top-N,
application & host risk ranking (weights C10/H5/M2/L1).

### Assessment modules (`Assessments.tsx`)
One page per category with **Assessments / Requests / Findings** tabs.
Detail modal: scope hosts (auto-populated), severity strip, **Open Findings
excl. Info** (v5 §2), import actions, PDF report shortcut, **Move to
<other module>** buttons (re-categorizes with the target's default type;
`store.repartition()` re-files the findings). Assessment deletion requires
typing `delete` (CrudPage `deleteKeyword` prop). Application is **optional**
on assessments (v6.5) — scanner imports map it later.

**Module-level scanner fetch (v6.5 + v6.5.1, `ModuleFetchModal`)**: toolbar
buttons "Fetch All from Scanner" / "Fetch Selected Only from Scanner" in every
module. Flow: pick scanner → retrieve scans **with policy names**
(`scanner:listScans(connId, includePolicy)` fetches each scan's detail to read
`info.policy`, concurrency-limited to 5) → filter strictly by **Nessus Policy
Name** against `POLICY_KEYWORDS` (web / internal+external / host; Int/Ext
picks External VA vs Internal VA from the policy name). Unmatched scans are
neither displayed nor imported by default (FR-NF-003); an explicit
"Include scans not matching the policy" checkbox (default off) is the escape
hatch for non-conforming policy naming. Each match imports
as its own adhoc assessment (`applicationId: ''`) via the existing
`scanner:fetch` pipeline (progress bar, per-scan failure isolation,
aggregated summary). Fetch/move/delete all reach Settings → Logs via the
existing audit + scanner logging plus a summary `log:write`.

**Scanner fetch** (`ScannerFetchModal` + `main/scanner.ts`, fixed 2026-07-07):
`fetchScanXml` polls strictly — it raises on the scanner's `error` status or a
3-minute not-ready timeout instead of downloading a half-baked export (the old
silent-empty-import bug) — and downloads with a 5-minute timeout for large
scans. Progress (export → generating → downloading → importing → done, with
percent) streams live to a progress bar. **Fetch one** (click a scan) or
**Fetch all** (sequential; each scan owns a slice of the bar; one failure
doesn't abort the batch; results are aggregated into a single import summary).

### Requests tab (`Requests.tsx`)
Fields incl. Project Code (blank = auto), **Application optional** (v6.2 fix),
requester/schedule fields. Title paste-parsing supported.

### Findings tab (`Findings.tsx`) — the most patched page
- **Assessment Name filter (v6.6.1)** in every module, coexisting with the
  context selector and Timeframe: populated from this module's Assessment tab
  (including unmapped scanner imports). Either the context selector or
  Assessment Name is sufficient to display findings (FR-FND-005); when both
  are set they AND together. With the filter set, new findings attach to that
  assessment. Timeframe behavior is unchanged (still hidden in a project-code
  context, where it cannot apply).
- **Web module** — one "Project Code / Application" context selector with two
  groups (v6.2 fix):
  - *Project Codes (adhoc)* from active (non-Closed) web-type requests. List is
    keyed by `finding.projectCode`. New Finding form = details only; project
    code/application/adhoc assessment inherited (§6.1). No timeframe filter.
  - *Applications (annual/quarterly)* from the Applications module. List =
    that app's non-adhoc findings (adhoc findings carrying a code are hidden
    here). New Finding form requires an annual/quarterly Web assessment.
- **Internal/External & Host modules** — Application selector; form has
  Assessment (required) + host picker (hosts auto-scoped to the app/module).
- KB template prefill; detail modal shows classification with
  `Existing • First Identified: <type> · <period> · <code>`, project code,
  SLA state, evidence attachments.

### Inventory (`Hosts.tsx`)
Tree: Application → Assessment Type → Period → Scan → hosts table
(checkbox column, IP, hostname, OS, Status badge, severity counts). Row
checkboxes + per-scan select-all + toolbar Select all / Delete Selected(n).
Bulk add ("IP, hostname, OS" lines). Manual hosts grouped under
Manual / Unassigned.

### Post Assessment (`Retests.tsx`)
Retest sessions (type Retest + baseline) and free two-assessment comparison:
new / resolved / recurring / severity changes.

### Charts (`Charts.tsx`)
Scopes: Application (picker) / Web / Internal / External / Host / Inventory.
Counts C/H/M/L only (Info excluded). Self-contained SVG (all colors baked in →
exports match screen). Actions: copy image (clipboard PNG), export PNG (2×),
export PDF (`chart:exportPdf`), copy summary table (TSV). Severity colors are
**fixed in both themes**: Critical `#d03b3b`, High `#c9860a`, Medium
`#fab219`, Low `#3fa34d`; chrome switches via `CHART_THEME`.

### Reports (`Reports.tsx` + `reports.ts`)
Excel (Summary / Findings / SLA Tracking / Host Mapping / Severity sheets),
Word (cover + TOC + per-finding blocks), PDF (executive | full). Findings
include Project Code and First Identified. **Reports never inherit the app
theme** (SRS v6 §7).

### Settings (`Settings.tsx`)
General (Appearance radios: Light/Dark/System — applies instantly, persists;
SLA table) · Storage (data/reports folders) · Scanner Connections (name, type,
URL, keys, default, test) · Report Templates · Backup · **Logs** · About.

### System logs & diagnostics (v6.3)
- `main/logger.ts` — never-throwing singleton. Daily JSONL files in
  `<dataDir>/logs/` (`application-YYYY-MM-DD.log`; ERROR duplicated into
  `errors-YYYY-MM-DD.log`). Every text field passes `redact()` (key/value
  secret scrubber) at write time; `safeStack()` caps depth and anonymizes the
  home directory. DEBUG dropped unless `Settings.debugLogging`; retention via
  `Settings.logRetentionDays` (startup, daily timer, and on settings change).
- **Automatic capture**: `process.on(uncaughtException/unhandledRejection)`
  in `main/index.ts`; every IPC handler is registered through the `handle()`
  wrapper in `ipc.ts` (logs channel + category + safe stack, rethrows);
  renderer `window error/unhandledrejection` hooks in `renderer/src/main.tsx`
  forward through `log:write`.
- **Instrumentation**: db create/update/remove audit (User Activity, skips
  notifications), settings changes (keys only, never values), scan imports &
  scanner fetch/test, report + chart exports, inbox intake, navigation.
- **Settings → Logs UI**: filters (date range, level, category, application,
  project code, keyword), expandable rows (failure reason + safe stack),
  Export Logs (honours filters), Clear Logs (type-to-confirm: requires the
  keyword "clear"), Generate Diagnostic Bundle, retention + DEBUG controls.
- **Diagnostic bundle** (`log:diagnostics`): jszip archive — application.log,
  errors.log, configuration.json, system-info.json, scanner-settings.json,
  version.json; scanner keys replaced with `[redacted]` before zipping.
- **Rule for new code**: never log secret values; log generic reasons. When
  adding an IPC handler, register it via `handle()` (never raw
  `ipcMain.handle`) so failures are captured; add a `CHANNEL_CATEGORY` entry
  for new channel prefixes.

### Search (`Search.tsx`)
Global topbar search across apps/hosts/findings/requests/assessments/KB; hits
navigate to the owning module page.

---

## 9. Theming (v6)

- `Settings.appearance`: `'light' | 'dark' | 'system'` (default `system`),
  persisted in `config.json`.
- `theme.ts`: resolves the mode, stamps `<html data-theme="light|dark">`,
  listens to `prefers-color-scheme` in system mode (live OS follow),
  `useEffectiveTheme()` hook for components needing the value (Charts).
- `styles.css`: dark = `:root` variables; light = `[data-theme='light']`
  block (variable overrides + hand-tuned badge/status/count colors).
- **Rule: never hard-code a dark-only color in new styles** — use the CSS
  variables, or add a matching light override. Severity colors never change
  with theme.

---

## 10. Conventions for future patches

1. Types/constants first in `shared/types.ts`; keep legacy union members
   (see §5 compatibility rule).
2. Business rules go in `ipc.ts` `prepare*` hooks — not in components (§6).
3. New IPC = three files (§7).
4. New page = `pages/` component + `App.tsx` NAV entry + route.
5. Theme: CSS variables or a light override; fixed severity palette (§9).
6. Charts: severity colors fixed; chart SVGs must stay self-contained
   (explicit fills) so exports work; Info always excluded from counts.
7. Verify: `npm run typecheck` → `npm run build` → launch (`npm run dev`) and
   exercise the changed flow → build the exe (§2).
8. Bump `package.json` version to the SRS level and update **this file**
   (version table + affected sections).
