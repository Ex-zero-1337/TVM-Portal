# Power Automate Integration — Live Request Updates

TVM Portal is filesystem-first, so the integration needs **no API and no server**:
Power Automate writes a small file into a synced folder, and the app picks it up
and creates the request **live** (the UI refreshes automatically — no restart,
no manual import).

## How it works

<img width="561" height="701" alt="powerautomate-flowchat" src="https://github.com/user-attachments/assets/d44aea97-f049-4937-a768-a1f71a344f28" />


The app watches `<data folder>/inbox/` with a filesystem watcher **plus a
30-second poll** (synced folders don't always emit change events). Only files
named **`VAPT*.json`** (or `VAPT*.txt`, case-insensitive) are consumed — any
other file in the folder is ignored and left in place. Processed files are
moved to `inbox/processed/`, unparseable ones to `inbox/failed/`
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

### JSON — native Power Automate export (recommended)

The inbox accepts the flow's SharePoint-list export as-is — no Compose
remapping needed:

```json
{
  "requestNumber": "VAPT-20260225-114815",
  "name": "username",
  "emailAddress": "username@redacted.com.my",
  "additionalEmailRecipients": "otherusername@redacted.com.my_x000D_\n otherusername2@redacted.com.my",
  "departmentDivision": "department name",
  "systemName": "application name",
  "targetDateToGoLive": "date",
  "targetDateOfUatCompletionServerReadiness": "date",
  "purpose": "System Update",
  "typeOfSystem": "Mobile Application",
  "doesTheSystem": "Will the system be published on the Internet?",
  "attachments": "https://…sharepoint.com/…",
  "approvalStatus": "approval status",
  "comments": "Reviewed and Acknowledged.",
  "reviewerName": "…",
  "timeOfReview": "2026-02-25T12:49:18"
}
```

Field mapping (every field optional; legacy aliases from the older Compose
format still work):

| JSON field (alias) | Request field | Notes |
|---|---|---|
| `requestNumber` (`projectCode`) | Project code | auto-generated if absent |
| `subject` (`title`) | Title | falls back to `systemName`; a `[VAPT-…]` prefix is extracted as the project code |
| `name` (`requestedBy`) | Requester name | |
| `emailAddress` (`email`) | Requester email | |
| `departmentDivision` (`department`) | Department | |
| `systemName` (`system`) | System name | also used as the title when no subject is given |
| `targetDateOfUatCompletionServerReadiness` (`targetUatCompletion`, `targetUatDate`) | Target UAT date | accepts Excel date serials (`46073`), `30/6/2026` (d/m/yyyy), or `2026-06-30` |
| `targetDateToGoLive` (`goLiveDate`, `goLive`) | Go-live date | same date formats |
| `purpose` | Purpose | |
| `typeOfSystem` | Assessment type | "Mobile Application" → Mobile, "Web…" → Web, "API" → API; otherwise the Web default stays |
| `scope`, `notes` | Scope / notes | explicit `notes` replaces the auto-summary below |
| `doesTheSystem`, `additionalEmailRecipients`, `attachments`, `approvalStatus`, `comments`, `reviewerName`, `timeOfReview` | Notes | folded into a readable summary; SharePoint's `_x000D_` line breaks are cleaned |

New requests arrive with status **New**, priority **Medium**, environment
**Production**, assessment type **Web** (unless `typeOfSystem` says otherwise) —
triage them on the Requests page.

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
