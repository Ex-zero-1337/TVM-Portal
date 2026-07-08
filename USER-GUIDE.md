# TVM Portal — User Guide & Application Flow

## The big picture

<img width="829.5" height="474" alt="VAPT Flowchart" src="https://github.com/user-attachments/assets/e9e590ca-f2ad-46fe-8c76-70dca708631a" />


Everything hangs off an **Application** (the system being tested) and its
**Hosts** (the IPs/servers behind it). Register those first; the rest of the
lifecycle references them.

---

## Step 0 — One-time setup

- **Settings → Data Storage**: choose where data lives. Point it at a
  SharePoint/OneDrive-synced folder to share with the team and enable the
  Power Automate intake (see `POWER-AUTOMATE.md`). Data is plain JSON files —
  copy the folder and you've copied the workspace.

## Step 1 — Register the application

**Applications → + New Application**: name, business unit, owner, tech stack,
criticality. This is the anchor every request, assessment and finding points to.

Hosts can be added manually (**Hosts → + New Host**) or left to the Nessus
import, which auto-creates them.

## Step 2 — Intake a request

Two ways:

- **Automatic**: a Power Automate flow drops the request file into the inbox —
  it appears on the **Requests** page live, with the project code
  (`VAPT-YYYYMMDD-HHMMSS`) extracted.
- **Manual**: **Requests → + New Request**. Paste a mail subject like
  `[VAPT-20260701-140418] VAPT Request - Thune` into the title to auto-extract
  the project code, or leave the code blank to auto-generate one.

Track intake through the statuses: **New → Pending Approval → Approved →
Scheduled → In Progress → Reporting → Delivered → Closed**.

## Step 3 — Create the assessment (pick the right module)

Assessments live in three independent modules in the sidebar:

| Module | For | Types |
|---|---|---|
| **Web Assessments** | Application-layer testing | Web, API, Mobile |
| **Int/Ext Assessments** | Network vulnerability assessment | Internal VA, External VA |
| **Host Assessments** | Host/server-focused review | Host VA |

In the module: **+ New Assessment** → link the application and the request,
set the **timeframe** (annual / quarterly / adhoc — this decides where finding
files are stored), dates and tester. Each module has its own
**Assessments / Requests / Findings** tabs, so each practice area works
independently.

> The **External VA** type matters: hosts auto-created by its imports are
> marked `external`, which drives Context-Change detection later.

## Step 4 — Get findings in

Open the assessment (click its row):

- **Import a scan** — *⬆ Import Nessus Scan* accepts `.nessus`/XML/CSV. Hosts
  are auto-created per import file (never merged across imports), duplicates
  are skipped by fingerprint, and each finding is classified automatically:
  - **New** — first time seen
  - **Retest** — matches a finding that is still open
  - **Regression** — matches a finding that had been fixed
  - **Context Change** — same issue, but the host moved internal ↔ external
- **Manual findings** — module tab **Findings** → select the application →
  *+ New Finding* (or *📚 From Template* to prefill from the Knowledge Base).

SLA due dates are stamped automatically: Critical 30 / High 60 / Medium 90 /
Low 180 days from discovery.

## Step 5 — Track remediation

- **Findings view** (sidebar or module tab): select the application, then
  narrow with the severity checkboxes and timeframe filter. Click a finding for
  full detail; edit its status as remediation progresses
  (**Open → In Remediation → Resolved / Risk Accepted / Closed**). Closing
  stamps the closure date used in SLA metrics.
- **Dashboard**: open/overdue counts, SLA compliance, monthly trend, OWASP/CWE
  breakdowns, application & host risk rankings. Info-severity findings are
  excluded; use the tick boxes to focus on specific severities.
- **🔔 Notifications**: SLA breaches, assessments starting within 7 days, and
  resolved findings that still need a retest.

## Step 6 — Retest

Create a new assessment with type **Retest** and set its **baseline** to the
original assessment, then import the retest scan or add findings. On the
**Retests** page, pick baseline + current and **Compare**: new, resolved,
recurring findings and severity changes — that's the retest report content.

## Step 7 — Report

**Reports** page → choose scope (portfolio or one assessment) → generate:

- **Excel** — Summary, Findings, SLA Tracking, Host Mapping, Severity Distribution
- **Word** — cover page with project code, TOC, executive summary, findings, appendices
- **PDF — Full Technical** or **PDF — Executive Only** (client-friendly)

Files default into the (synced) `reports/` folder — see `REPORTING.md` for
customization and `POWER-AUTOMATE.md` for auto-emailing them.

---

## Everyday tips

- **Global search** (top bar) finds anything: CVEs, IPs, endpoints, project
  codes, hosts, findings.
- **Hosts page**: filter by source import, use *Select all* + *Delete selected*
  to clean out an obsolete import in one action.
- **Knowledge Base**: save write-ups you reuse (description/risk/recommendation
  with CVE/CWE/OWASP) once, prefill findings forever.
- Every edit saves immediately; there is no Save button to forget.
