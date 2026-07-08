# TVM Portal — Report Generation Guidelines

All report generation lives in `src/main/reports.ts`. Reports are built from a single
`ReportData` object (see `collectData()`), so every format shares the same numbers.
This document explains the produced structure and where to customize each format.

## Report types

| Type | How to produce it |
|---|---|
| **Executive report** | PDF — *Executive Only* card on the Reports page (`variant: 'executive'`). Contains project overview, scope, summary of findings, risk overview, SLA compliance, severity distribution. |
| **Technical report** | Word, Excel, or PDF — *Full Technical*. Adds detailed findings, host breakdown, evidence, CVSS breakdown, remediation steps. |
| **Retest report** | Scope the report to a Retest-type assessment; the retest summary (New / Retest / Regression / Context Change) is included in every format. The Retests page provides the side-by-side comparison (fixed, remaining, regression, severity changes). |

## Scope

Every format can be generated for the **whole portfolio** or **one assessment**
(Reports page → Scope). Assessment-scoped reports inherit the request's
**project code** (`VAPT-YYYYMMDD-HHMMSS`), which becomes the suggested filename
and the cover-page identifier.

## Excel (.xlsx) — `writeExcel()`

Sheets produced (§5.2.4):

1. **Summary** — title, executive summary text, findings by severity, SLA summary, retest summary
2. **Findings** — full register, autofiltered (title, severity, CVSS, application, host, port, endpoint, CVE, status, classification, dates, overdue flag, recommendation)
3. **SLA Tracking** — per finding: due date, days remaining, overdue flag, closure date
4. **Host Mapping** — IP, hostname, application, environment, exposure, source import, findings count
5. **Severity Distribution** — counts and percentage share

*Customize:* column sets are declared in each sheet's `columns` array; add or remove
keys there and in the corresponding `addRow` call.

## Word (.docx) — `writeDocx()`

Layout (§5.2.5):

1. **Cover page** — report title, project code, generation timestamp
2. **Table of contents** — auto-generated field (Word asks to update fields on open)
3. **1. Executive Summary** · **2. Risk Summary** · **3. SLA Summary** · **4. Retest Summary**
4. **5. Technical Findings** — one block per finding: metadata table, description, evidence, recommendation
5. **Appendix A** Host Mapping · **Appendix B** SLA reference

*Customize:* section order is the `children` array of the document section; headings
use `HeadingLevel.HEADING_1/2` so the TOC picks them up automatically.

## PDF — `reportHtml()` + `writePdf()`

Two editions (§5.2.6):

- **Executive Only** (`variant: 'executive'`) — summaries only, optimized for client sharing
- **Full Technical** (`variant: 'full'`) — summaries plus all finding detail cards

The PDF is rendered from an HTML template in `reportHtml()` via Electron's
`printToPDF` (A4, non-editable). *Customize:* edit the inline CSS/HTML in
`reportHtml()` — severity colors are in `SEV_COLORS`.

## Shared content

- **Executive summary text** — `execSummaryText()`: one paragraph covering scope,
  critical/high counts, open/overdue counts, SLA compliance and average closure time.
- **SLA math** — `src/shared/sla.ts` (`slaStats`): compliance = closed-in-time +
  open-not-yet-due over all findings with an SLA.
- **Severity SLA windows** — Critical 30 / High 60 / Medium 90 / Low 180 days
  (`SLA_DAYS` in `src/shared/sla.ts`).
