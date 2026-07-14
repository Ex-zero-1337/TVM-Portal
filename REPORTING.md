# TVM Portal — Report Generation Guidelines

All report generation lives in `src/main/reports.ts`. Reports are built from a single
`ReportData` object (see `collectData()`), so every format shares the same numbers.
This document explains the produced structure and where to customize each format.

## Report types

| Type | How to produce it |
|---|---|
| **Executive report** | PDF — *Executive Only* card on the Reports page (`variant: 'executive'`). Management-ready Executive Summary Report with overview, overall risk rating, findings summary, key risks, remediation priority, retest status, conclusion, and scope/limitations. |
| **Technical report** | Word, Excel, or PDF — *Full Technical*. Adds the professional report structure, summary chart/table, detailed findings, evidence, affected URL/parameter, CVSS, status, and remediation guidance. |
| **Retest report** | Scope the report to a Retest-type assessment. Retest status is included in the executive PDF and detailed lifecycle information remains available through the Retests page comparison. |

## Scope

Every format can be generated for the **whole portfolio** or **one assessment**
(Reports page → Scope). Assessment-scoped reports inherit the request's
**project code** (`VAPT-YYYYMMDD-HHMMSS`), which becomes the suggested filename
and the cover-page identifier.

## Excel (.xlsx) — `writeExcel()`

Sheets produced (§5.2.4):

1. **Summary** — stacked dashboard sections for Report Information, Severity Dashboard, SLA Dashboard and Executive Summary. Informational findings are excluded from severity totals. Report Information and SLA Dashboard use a two-column dashboard layout with values in column B.
2. **Report Tracker** — merged remediation tracker and technical findings register with the columns: ID, Project Code, Application, Finding, Severity, Status, CVSS, Description, Affected Asset, Host, Affected Endpoint, Affected Parameter, Recommendation, Proof of Concept, OWASP and Discovered.
3. **SLA Tracking** — professional formatted SLA table per finding: due date, days remaining, overdue flag and closure date.

Removed sheets: separate **Findings**, **Host Mapping**, and **Severity Distribution** are no longer produced because their useful fields are now merged into Summary and Report Tracker.

Missing values in Report Tracker and SLA Tracking are left blank. Summary metadata uses `-` where a value is not available.

*Customize:* column sets are declared in each sheet's `columns` array; add or remove
keys there and in the corresponding `addRow` call.

## Word (.docx) — `writeDocx()`

Layout (§5.2.5):

1. **Cover page** — logo, dynamic report title, project code/application name, report date and prepared-by line
2. **Document Control** — project code, application/system, department, requester, tester, assessment type/window and report date
3. **Table of Contents** — native Word TOC field with cached page numbers and internal links
4. **1 Executive Summary** — introduction, background information, reference standards and purpose of testing
5. **2 Summary of Technical Findings** — introduction, project scope, findings chart and severity summary table
6. **3 Detailed Technical Findings** — one block per non-Informational finding using a professional metadata table, description, affected URL, affected parameter, PoC/evidence and recommendation

Removed DOCX sections: Report Tracker, SLA / Remediation Summary, Retest / Lifecycle Summary, Host Mapping appendix and SLA appendix.

PoC support: image attachments (`png`, `jpg`, `jpeg`, `gif`, `bmp`) are embedded into the DOCX finding section when the file exists and include captions. Empty PoC values show `no value/details`. Other attachments are listed in an Evidence Attachments table with filename and size. Reference standards are expanded by assessment type and Nessus/Tenable plugin references are not included in the DOCX reference section.

SLA Due appears only for Quarterly and Annual assessments. Adhoc technical tables omit SLA Due. Project Scope no longer includes an Out of Scope row.

*Customize:* section order is the `children` array of the document section; headings
use `HeadingLevel.HEADING_1/2` so the TOC picks them up automatically.

## PDF — `reportHtml()` + `writePdf()`

Two editions (§5.2.6):

- **Executive Only** (`variant: 'executive'`) — management-ready Executive Summary Report with assessment overview, overall risk rating, findings summary, summary chart, key risks, remediation priority, retest status, conclusion and scope/limitations
- **Full Technical** (`variant: 'full'`) — DOCX-aligned full technical report with executive summary, reference standards, purpose, project scope, summary chart/table and detailed technical findings

The PDF is rendered from an HTML template in `reportHtml()` via Electron's
`printToPDF` (A4, non-editable). The PDF table of contents uses clickable internal links. *Customize:* edit the inline CSS/HTML in
`reportHtml()` — severity colors are in `SEV_COLORS`.

## Shared content

- **Executive summary text** — `execSummaryText()` and the executive PDF helper
  functions generate business-friendly wording, assessment naming, risk rating,
  findings summary, remediation priority and conclusion.
- **SLA math** — `src/shared/sla.ts` (`slaStats`): compliance = closed-in-time +
  open-not-yet-due over all findings with an SLA.
- **Severity SLA windows** — Critical 30 / High 60 / Medium 90 / Low 180 days
  (`SLA_DAYS` in `src/shared/sla.ts`).
