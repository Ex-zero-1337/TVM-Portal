# TVM Portal Release Notes

## v1.6.10 - Reporting and Scanner Workflow Enhancements

This release focuses on improving scanner import workflows and producing more professional assessment reports for management, technical reviewers, and remediation tracking.

### Assessment Scanner Workflow

- Added **Fetch All from Scanner** under the assessment tab for module-level scanner import.
- Added **Fetch Selected from Scanner** under the assessment tab for selected assessment import.
- Scanner fetch actions now sit beside the assessment action buttons instead of inside the new-assessment flow.
- Scanner-imported data is listed directly in the assessment workflow after import.

### Excel Report Enhancements

- Reworked the Excel workbook into three focused sheets:
  - **Summary**
  - **Report Tracker**
  - **SLA Tracking**
- Improved the Summary sheet with dashboard-style sections for:
  - Report Information
  - Severity Dashboard
  - SLA Dashboard
  - Executive Summary
- Updated report naming in the Summary and Executive Summary text:
  - Adhoc: `Application Code - Application Name`
  - Quarterly: `Q1/Q2/Q3/Q4 Assessment - Application Name`
  - Annual: `Annual Year - Application Name`
  - Portfolio or multi-application reports use the assessment category where a single application is not available.
- Reformatted Report Information and SLA Dashboard so values start in column B while columns C and D remain blank with dashboard header colour retained.
- Improved Report Tracker with the requested columns:
  - ID
  - Project Code
  - Application
  - Finding
  - Severity
  - Status
  - CVSS
  - Description
  - Affected Asset
  - Host
  - Affected Endpoint
  - Affected Parameter
  - Recommendation
  - Proof of Concept
  - OWASP
  - Discovered
- Removed old Host Mapping and Severity Distribution sheets.
- Fixed table header colour overflow past the last intended column in Report Tracker and SLA Tracking.
- Missing values in Report Tracker and SLA Tracking are now left blank.
- Fixed dashboard section cells so styled blank columns remain empty instead of repeating section values.
- Severity colours are standardised as red, orange-yellow, yellow, and green.

### Word Report Enhancements

- Rebuilt the DOCX report into a more professional WAPT/API/MAPT/IVA/EVA/Host report structure.
- Added the Bank Islam logo to the cover page.
- Added dynamic report titles based on assessment type, including:
  - Web Application Penetration Testing (WAPT) Report
  - API Security Assessment Report
  - Mobile Application Penetration Testing (MAPT) Report
  - Internal Vulnerability Assessment (IVA) Report
  - External Vulnerability Assessment (EVA) Report
  - Host Vulnerability Assessment Report
  - Source Code Security Review Report
- Split project code and application name into separate title lines on the cover page.
- Added prepared-by footer and page numbering.
- Improved Document Control, Project Scope, Summary of Findings, and Detailed Technical Finding tables.
- Added a chart under Summary of Findings.
- Added detailed, assessment-type-aware reference standards for web, API, mobile, source code, internal, external, and host assessments.
- Added business-friendly purpose and background wording based on assessment category.
- Improved technical finding layout with:
  - Severity header
  - Metadata table
  - Description
  - Affected URL
  - Affected Parameter
  - Proof of Concept / Evidence
  - Recommendation
- Proof of Concept now supports embedded image attachments with captions.
- Empty Proof of Concept values display as `no value/details` with left alignment.
- SLA Due is omitted for Adhoc findings and retained only for Quarterly and Annual assessments.
- Removed Appendix A, Report Tracker, SLA/remediation summary, Host Mapping, and unused classification/owner sections from the DOCX report.
- Removed Project Scope "Out of Scope" row.

### PDF Report Enhancements

- Rebuilt PDF output to follow the same professional report structure as the DOCX template.
- PDF output is explicitly generated as A4.
- Added Bank Islam logo, dynamic report titles, document control, table of contents, section spacing, and page numbering.
- Added clickable Table of Contents links for PDF sections.
- Added two PDF editions:
  - **Full Technical Report**
  - **Executive Summary Report**
- Full Technical PDF now includes:
  - Executive Summary
  - Background Information
  - Reference Standards
  - Purpose of Testing
  - Project Scope
  - Summary of Findings with chart
  - Detailed Technical Findings
- Executive Summary PDF is now written for management using simple business language and includes:
  - Executive Summary
  - Assessment Overview
  - Overall Risk Rating
  - Findings Summary
  - Findings Summary chart
  - Key Risks
  - Remediation Priority
  - Retest Status
  - Conclusion
  - Scope and Limitations
- Executive report cover title now includes **Executive Summary Report**.
- Key Risks are formatted as subsections such as `5.1 Finding Name`.
- Informational severity is excluded from executive Findings Summary.
- Removed Project Scope "Out of Scope" row.

### General Reporting Fixes

- Updated report wording to avoid old auto-created assessment notes in background sections.
- Improved report titles and assessment naming across generated outputs.
- Removed outdated generated timestamp wording from the DOCX cover.
- Improved table alignment, spacing, font sizing, and colour consistency across report outputs.
- Updated Reports page descriptions to match the current report formats.

### Build Note

- Runtime output was refreshed with `npm run build`.
- No executable installer or portable EXE build was produced for these changes.
