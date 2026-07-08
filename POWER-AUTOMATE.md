# Power Automate Integration — Live Request Updates

TVM Portal is filesystem-first, so the integration needs **no API and no server**:
Power Automate writes a small file into a synced folder, and the app picks it up
and creates the request **live** (the UI refreshes automatically — no restart,
no manual import).

## How it works

```
Microsoft Form / Email / Teams
        │
        ▼
Power Automate flow ──▶ Create file in SharePoint/OneDrive folder
        │                        (the folder syncs to the analyst's machine)
        ▼
<data folder>/inbox/VAPT-request.json
        │
        ▼
TVM Portal watches inbox/ ──▶ parses the file ──▶ creates the Project Code Request
        │                                             │
        ▼                                             ▼
moves file to inbox/processed/              UI updates immediately
```

The app watches `<data folder>/inbox/` with a filesystem watcher **plus a
30-second poll** (synced folders don't always emit change events). Processed
files are moved to `inbox/processed/`, unparseable ones to `inbox/failed/`
(check there if a request doesn't appear).

## One-time setup

1. In TVM Portal → **Settings → Data Storage**, point the data folder at a
   folder inside your synced SharePoint library or OneDrive
   (e.g. `…/SharePoint/CyberSec/tvm-data`). The app creates `inbox/` inside it.
2. In Power Automate, build a flow ending with **"Create file"** targeting that
   `tvm-data/inbox/` folder.

## Flow recipe (Form → Request)

1. **Trigger**: *When a new response is submitted* (Microsoft Forms) — or an
   email/Teams trigger.
2. **Action**: *Get response details*.
3. **Action**: *Compose* — build the JSON payload (see below). Generate the
   project code with expression:
   `concat('VAPT-', formatDateTime(utcNow(),'yyyyMMdd-HHmmss'))`
4. **Action**: *Create file* (SharePoint or OneDrive)
   - **Folder path**: `…/tvm-data/inbox`
   - **File name**: `concat('VAPT-', formatDateTime(utcNow(),'yyyyMMddHHmmss'), '.json')`
   - **File content**: the Compose output.

## File format

### JSON (recommended)

```json
{
  "subject": "[VAPT-20260701-140418] VAPT Request - Thune",
  "name": "chocho",
  "email": "choco@redacted.com.my",
  "department": "Customer Experience",
  "systemName": "Thune",
  "targetUatCompletion": "30/6/2026",
  "goLiveDate": "11/7/2026",
  "purpose": "System Update"
}
```

Field mapping (all fields optional except `subject`/`title`):

| JSON field | Request field | Notes |
|---|---|---|
| `subject` or `title` | Project code + title | `[VAPT-…]` prefix is extracted as the project code; a leading `VAPT Request -` is stripped from the title |
| `projectCode` | Project code | overrides the one parsed from the subject; auto-generated if absent everywhere |
| `name` | Requester name | |
| `email` | Requester email | |
| `department` | Department | |
| `systemName` or `system` | System name | |
| `targetUatCompletion` | Target UAT date | accepts `30/6/2026` (d/m/yyyy) or `2026-06-30` |
| `goLiveDate` or `goLive` | Go-live date | same date formats |
| `purpose` | Purpose | |
| `scope`, `notes` | Scope / notes | |

New requests arrive with status **New**, priority **Medium**, environment
**Production**, assessment type **Web** — triage them on the Requests page.

### Plain text (minimal)

A `.txt` file also works: the first line becomes the subject (parsed the same
way), remaining lines land in the request notes.

```
[VAPT-20260701-140418] VAPT Request - Thune
Requested via email, see attachment in ticket #4211
```

## Duplicate protection

If a file carries a project code that already exists in the system, it is
skipped (moved to `processed/` without creating a duplicate) — safe against
flow re-runs and sync hiccups.

## Sending reports back (optional)

Because reports are saved into `<data folder>/reports/` (also synced), a second
flow can watch that library folder — *When a file is created* — and email the
report to the requester or post it to a Teams channel.
