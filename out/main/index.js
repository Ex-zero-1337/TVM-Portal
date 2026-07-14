"use strict";
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const JSZip = require("jszip");
const fastXmlParser = require("fast-xml-parser");
const ExcelJS = require("exceljs");
const docx = require("docx");
const EVIDENCE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "txt", "zip"];
const CATEGORY_TYPES = {
  web: ["Web", "API", "Mobile", "Retest"],
  "internal-external": ["Internal VA", "External VA", "Retest"],
  host: ["Host VA", "Retest"]
};
function categoryOfType(type) {
  if (type === "Internal VA" || type === "External VA") return "internal-external";
  if (type === "Host VA") return "host";
  return "web";
}
function parseProjectCode(raw) {
  const m = raw.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (!m) return { projectCode: "", title: raw.trim() };
  const title = m[2].replace(/^VAPT\s+Request\s*-\s*/i, "").trim();
  return { projectCode: m[1].trim(), title: title || m[2].trim() };
}
function generateProjectCode(d = /* @__PURE__ */ new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `VAPT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function periodLabel(timeframe, dateIso) {
  const d = new Date(dateIso || Date.now());
  if (timeframe === "annual") return `Annual ${d.getFullYear()}`;
  if (timeframe === "quarterly") return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  return `Adhoc ${d.getFullYear()}`;
}
const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];
function normalizeDate(v) {
  if (v === void 0 || v === null || v === "") return "";
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  if (/^\d{5}$/.test(s)) {
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10);
  }
  return "";
}
function isoToSerial(iso) {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return String(Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5));
}
function assessmentTypeOf(typeOfSystem) {
  const t = (typeOfSystem || "").toLowerCase();
  if (t.includes("mobile")) return "Mobile";
  if (t.includes("api")) return "API";
  if (t.includes("web")) return "Web";
  return void 0;
}
const TYPE_OF_SYSTEM_LABELS = {
  Web: "Web Application",
  API: "API",
  Mobile: "Mobile Application"
};
function requestStatusOf(approvalStatus) {
  const s = String(approvalStatus ?? "").toLowerCase();
  if (!s) return void 0;
  if (s.includes("acknowledg")) return "Acknowledge";
  if (s.includes("approv")) return "Approved";
  if (s.includes("pending")) return "Pending Approval";
  return void 0;
}
function cleanPaText(v) {
  if (!v) return "";
  return String(v).replace(/_x000D_/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}
const PORTAL_KEYS = [
  "id",
  "title",
  "applicationId",
  "scope",
  "environment",
  "assessmentType",
  "priority",
  "status",
  "targetDate",
  "notes",
  "createdAt",
  "updatedAt"
];
function toPaRequestFile(r) {
  const rec = r;
  const portal = {};
  for (const k of PORTAL_KEYS) portal[k] = rec[k] ?? "";
  const source = r.source ?? {};
  return {
    ...source,
    requestNumber: r.projectCode,
    name: r.requestedBy,
    emailAddress: r.requesterEmail,
    departmentDivision: r.department,
    systemName: r.systemName,
    targetDateToGoLive: isoToSerial(r.goLiveDate) || r.goLiveDate || "",
    targetDateOfUatCompletionServerReadiness: isoToSerial(r.targetUatDate) || r.targetUatDate || "",
    purpose: r.purpose,
    typeOfSystem: source.typeOfSystem || TYPE_OF_SYSTEM_LABELS[r.assessmentType] || "",
    portal
  };
}
function fromPaRequestFile(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return void 0;
  const d = data;
  if (typeof d.id === "string") return d;
  if (!d.requestNumber && !d.portal) return void 0;
  const portal = d.portal ?? {};
  const { portal: _omit, ...source } = d;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    priority: "Medium",
    environment: "Production",
    assessmentType: assessmentTypeOf(String(d.typeOfSystem ?? "")) ?? "Web",
    title: String(d.systemName ?? d.requestNumber ?? ""),
    applicationId: "",
    scope: "",
    // Notes stay empty — the detail view shows every export field directly.
    notes: "",
    targetDate: "",
    ...portal,
    // Untriaged requests (still 'New') follow the export's approvalStatus;
    // once an analyst moves the status manually, their value wins.
    status: portal.status && portal.status !== "New" ? portal.status : requestStatusOf(d.approvalStatus) ?? "New",
    id: portal.id || String(d.requestNumber),
    createdAt: portal.createdAt || now,
    updatedAt: portal.updatedAt || now,
    projectCode: String(d.requestNumber ?? ""),
    requestedBy: String(d.name ?? ""),
    requesterEmail: String(d.emailAddress ?? ""),
    department: String(d.departmentDivision ?? ""),
    systemName: String(d.systemName ?? ""),
    goLiveDate: normalizeDate(d.targetDateToGoLive),
    targetUatDate: normalizeDate(d.targetDateOfUatCompletionServerReadiness),
    purpose: String(d.purpose ?? ""),
    source
  };
}
const COLLECTIONS = [
  "requests",
  "applications",
  "hosts",
  "assessments",
  "findings",
  "kb",
  "notifications"
];
const FINDINGS_DIRS = {
  web: "web-findings",
  internal: "internal-findings",
  external: "external-findings",
  host: "host-findings"
};
const LEGACY_INT_EXT_DIR = "internal-external-findings";
function safeSeg(s) {
  return (s || "unknown").replace(/[^\w.\- ]+/g, "_").trim() || "unknown";
}
function walkJsonFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(p));
    else if (entry.name.endsWith(".json")) out.push(p);
  }
  return out;
}
class Store {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
    this.settings = this.loadSettings();
    this.ensureDataDir();
  }
  get configPath() {
    const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
    return path.join(portableRoot ?? electron.app.getPath("userData"), "config.json");
  }
  loadSettings() {
    const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
    const baseDir = portableRoot ? path.join(portableRoot, "tvm-data") : path.join(electron.app.getPath("userData"), "tvm-data");
    const defaults = {
      dataDir: baseDir,
      reportsDir: path.join(baseDir, "reports"),
      scanners: [],
      appearance: "system",
      logRetentionDays: 30,
      debugLogging: false
    };
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(this.configPath, "utf-8")) };
    } catch {
      return defaults;
    }
  }
  getSettings() {
    return this.settings;
  }
  setSettings(patch) {
    const storageKeys = ["requestsDir", "webFindingsDir", "internalFindingsDir", "externalFindingsDir"];
    const migrate = !("dataDir" in patch) && storageKeys.some((k) => k in patch && (patch[k] || "") !== (this.settings[k] || ""));
    const oldRoots = migrate ? [this.requestsRoot(), ...this.allFindingsRoots()] : [];
    if (migrate) {
      this.list("requests");
      this.list("findings");
      this.list("assessments");
      this.list("applications");
    }
    this.settings = { ...this.settings, ...patch };
    this.atomicWrite(this.configPath, JSON.stringify(this.settings, null, 2));
    if (migrate) {
      this.ensureDataDir();
      this.persistRequests();
      this.persistFindings();
      const current = /* @__PURE__ */ new Set([this.requestsRoot(), ...this.allFindingsRoots()]);
      for (const root of oldRoots) {
        if (current.has(root)) continue;
        for (const file of walkJsonFiles(root)) {
          if (this.isPortalRecordFile(file)) fs.rmSync(file);
        }
      }
    } else {
      this.cache.clear();
    }
    this.ensureDataDir();
    return this.settings;
  }
  /**
   * True when a JSON file holds portal-written record(s) — a top-level `id`
   * (flat records) or a `portal.id` block (PA-schema request files, v6.6.6).
   * Never delete anything else (e.g. raw Power Automate exports).
   */
  isPortalRecordFile(file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      const first = Array.isArray(data) ? data[0] : data;
      return !!first && (typeof first.id === "string" || typeof first.portal?.id === "string");
    } catch {
      return false;
    }
  }
  ensureDataDir() {
    fs.mkdirSync(this.settings.dataDir, { recursive: true });
    fs.mkdirSync(this.settings.reportsDir, { recursive: true });
    fs.mkdirSync(path.join(this.settings.dataDir, "imports"), { recursive: true });
    fs.mkdirSync(path.join(this.settings.dataDir, "evidence"), { recursive: true });
  }
  /** Absolute path for a data-folder-relative path (e.g. an evidence attachment). Absolute paths pass through (relocated storage roots). */
  resolve(rel) {
    return path.isAbsolute(rel) ? rel : path.join(this.settings.dataDir, rel);
  }
  /** Store `abs` relative to the data folder when inside it, absolute otherwise. */
  storablePath(abs) {
    const rel = path.relative(this.settings.dataDir, abs);
    return rel.startsWith("..") ? abs : rel;
  }
  // -------------------------------------------------- storage roots (v6.6.3)
  /** Effective requests folder: Settings override or `<dataDir>/requests`. */
  requestsRoot() {
    return this.settings.requestsDir || path.join(this.settings.dataDir, "requests");
  }
  /** Effective requests folder — public for the live folder watcher (v6.6.7). */
  requestsDirPath() {
    return this.requestsRoot();
  }
  /** Drop a collection's cache so the next read reloads from disk (live external file edits). */
  invalidate(name) {
    this.cache.delete(name);
  }
  /** Effective findings folder for a storage bucket (web / internal / external / host). */
  findingsRoot(bucket) {
    const override = {
      web: this.settings.webFindingsDir,
      internal: this.settings.internalFindingsDir,
      external: this.settings.externalFindingsDir,
      host: void 0
    }[bucket];
    return override || path.join(this.settings.dataDir, FINDINGS_DIRS[bucket]);
  }
  /** Every folder findings may live in: effective roots, defaults, and the legacy combined tree. */
  allFindingsRoots() {
    const roots = /* @__PURE__ */ new Set();
    for (const bucket of ["web", "internal", "external", "host"]) {
      roots.add(this.findingsRoot(bucket));
      roots.add(path.join(this.settings.dataDir, FINDINGS_DIRS[bucket]));
    }
    roots.add(path.join(this.settings.dataDir, LEGACY_INT_EXT_DIR));
    return [...roots];
  }
  filePath(name) {
    return path.join(this.settings.dataDir, `${name}.json`);
  }
  atomicWrite(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, file);
  }
  readJson(file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      const items = Array.isArray(data) ? data : [data];
      return items.filter((x) => x && typeof x.id === "string");
    } catch {
      return [];
    }
  }
  // ------------------------------------------------------------- loading
  load(name) {
    if (name === "findings") return this.loadFindings();
    if (name === "hosts") return this.loadHosts();
    if (name === "requests") return this.loadRequests();
    return this.readJson(this.filePath(name));
  }
  /**
   * One file per request (`requests/VAPT-<code>.json`) in the Power Automate
   * export schema (v6.6.6, see pa-format.ts). Flat pre-v6.6.6 records and raw
   * PA exports without a `portal` block are accepted too.
   */
  loadRequests() {
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = /* @__PURE__ */ new Set([this.requestsRoot(), path.join(this.settings.dataDir, "requests")]);
    for (const root of roots) {
      for (const file of walkJsonFiles(root)) {
        try {
          const data = JSON.parse(fs.readFileSync(file, "utf-8"));
          for (const entry of Array.isArray(data) ? data : [data]) {
            const item = fromPaRequestFile(entry);
            if (!item || seen.has(item.id)) continue;
            seen.add(item.id);
            items.push(item);
          }
        } catch {
        }
      }
    }
    if (fs.existsSync(this.filePath("requests"))) {
      items.push(...this.readJson(this.filePath("requests")).filter((x) => !seen.has(x.id)));
    }
    return items;
  }
  loadFindings() {
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    for (const root of this.allFindingsRoots()) {
      for (const file of walkJsonFiles(root)) {
        for (const item of this.readJson(file)) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
      }
    }
    if (fs.existsSync(this.filePath("findings"))) {
      items.push(...this.readJson(this.filePath("findings")).filter((x) => !seen.has(x.id)));
    }
    return items;
  }
  loadHosts() {
    const items = [];
    for (const file of walkJsonFiles(path.join(this.settings.dataDir, "hosts"))) {
      if (path.basename(file) === "summary.json") continue;
      items.push(...this.readJson(file));
    }
    if (fs.existsSync(this.filePath("hosts"))) {
      const ids = new Set(items.map((x) => x.id));
      items.push(...this.readJson(this.filePath("hosts")).filter((x) => !ids.has(x.id)));
    }
    return items;
  }
  // ------------------------------------------------------------- persisting
  persist(name) {
    if (name === "findings") return this.persistFindings();
    if (name === "hosts") return this.persistHosts();
    if (name === "requests") return this.persistRequests();
    this.atomicWrite(this.filePath(name), JSON.stringify(this.cache.get(name) ?? [], null, 2));
  }
  persistRequests() {
    const requests = this.cache.get("requests") ?? [];
    const root = this.requestsRoot();
    const expected = /* @__PURE__ */ new Set();
    for (const r of requests) {
      let file = path.join(root, `${safeSeg(r.projectCode || r.id)}.json`);
      if (expected.has(file)) file = path.join(root, `${safeSeg(r.projectCode || "request")}-${r.id}.json`);
      expected.add(file);
      this.atomicWrite(file, JSON.stringify(toPaRequestFile(r), null, 2));
    }
    for (const dir of /* @__PURE__ */ new Set([root, path.join(this.settings.dataDir, "requests")])) {
      for (const file of walkJsonFiles(dir)) {
        if (!expected.has(file) && this.isPortalRecordFile(file)) fs.rmSync(file);
      }
    }
    fs.rmSync(this.filePath("requests"), { force: true });
  }
  /**
   * Context directory (v6.6.14): everything belonging to one working context
   * lives together — findings.json, evidence/ (POC) and generated reports —
   * so the tree is browsable from SharePoint:
   *   <findings-root>/<timeframe>/<projectCode | application | assessment name>/
   * Adhoc contexts prefer the project code; annual/quarterly the application;
   * unmapped scanner imports fall back to the assessment name.
   */
  contextDir(a, fallbackApplicationId) {
    const category = a ? a.category || categoryOfType(a.type) : "web";
    const storageBucket = category === "internal-external" ? a?.type === "External VA" ? "external" : "internal" : category;
    const timeframe = a?.timeframe || "adhoc";
    let name = "";
    if (timeframe === "adhoc") {
      const req = a?.requestId ? this.get("requests", a.requestId) : void 0;
      name = req?.projectCode || "";
    }
    const appId = a?.applicationId || fallbackApplicationId;
    if (!name && appId) name = this.get("applications", appId)?.name ?? "";
    if (!name) name = a?.name || "";
    return path.join(
      this.findingsRoot(storageBucket),
      timeframe,
      safeSeg(name || "unassigned")
    );
  }
  /** Directory for one finding, per SRS v3 §3.3 (+ v6.6.14 context layout). */
  findingFile(f, assessments) {
    const a = f.assessmentId ? assessments.get(f.assessmentId) : void 0;
    const dir = this.contextDir(a, f.applicationId);
    const category = a ? a.category || categoryOfType(a.type) : "web";
    if (category === "host" && (a?.timeframe || "adhoc") === "adhoc") {
      const host = f.hostId ? this.get("hosts", f.hostId) : void 0;
      return path.join(dir, safeSeg(host?.ip || f.hostId), "findings.json");
    }
    return path.join(dir, "findings.json");
  }
  persistFindings() {
    const findings = this.cache.get("findings") ?? [];
    const assessments = new Map(this.list("assessments").map((a) => [a.id, a]));
    const byFile = /* @__PURE__ */ new Map();
    for (const f of findings) {
      const file = this.findingFile(f, assessments);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(f);
    }
    for (const root of this.allFindingsRoots()) {
      for (const file of walkJsonFiles(root)) {
        if (!byFile.has(file) && this.isPortalRecordFile(file)) fs.rmSync(file);
      }
    }
    for (const [file, group] of byFile) {
      this.atomicWrite(file, JSON.stringify(group, null, 2));
    }
    fs.rmSync(this.filePath("findings"), { force: true });
  }
  persistHosts() {
    const hosts = this.cache.get("hosts") ?? [];
    const root = path.join(this.settings.dataDir, "hosts");
    const byDir = /* @__PURE__ */ new Map();
    for (const h of hosts) {
      const dir = path.join(root, safeSeg(h.sourceFile || "manual"));
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(h);
    }
    const expected = /* @__PURE__ */ new Set();
    for (const [dir, group] of byDir) {
      for (const h of group) {
        const file = path.join(dir, `${safeSeg(h.ip || h.id)}.json`);
        expected.add(file);
        this.atomicWrite(file, JSON.stringify(h, null, 2));
      }
      const summary = path.join(dir, "summary.json");
      expected.add(summary);
      this.atomicWrite(
        summary,
        JSON.stringify(
          {
            source: path.basename(dir),
            hostCount: group.length,
            ips: group.map((h) => h.ip).sort(),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          null,
          2
        )
      );
    }
    for (const file of walkJsonFiles(root)) {
      if (!expected.has(file)) fs.rmSync(file);
    }
    fs.rmSync(this.filePath("hosts"), { force: true });
  }
  // ------------------------------------------------------------- CRUD
  list(name) {
    if (!this.cache.has(name)) this.cache.set(name, this.load(name));
    return this.cache.get(name);
  }
  get(name, id) {
    return this.list(name).find((x) => x.id === id);
  }
  create(name, data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const item = { ...data, id: data.id || crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.list(name).push(item);
    this.persist(name);
    return item;
  }
  createMany(name, rows) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const items = rows.map(
      (data) => ({ ...data, id: data.id || crypto.randomUUID(), createdAt: now, updatedAt: now })
    );
    this.list(name).push(...items);
    this.persist(name);
    return items;
  }
  update(name, id, patch) {
    const items = this.list(name);
    const idx = items.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error(`${name}/${id} not found`);
    items[idx] = { ...items[idx], ...patch, id, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    this.persist(name);
    return items[idx];
  }
  remove(name, id) {
    this.cache.set(
      name,
      this.list(name).filter((x) => x.id !== id)
    );
    this.persist(name);
  }
  /** Bulk removal with a single persist — the on-disk tree is rewritten once. */
  removeMany(name, ids) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.cache.set(
      name,
      this.list(name).filter((x) => !gone.has(x.id))
    );
    this.persist(name);
  }
  /** Repartition stored findings/hosts after metadata that affects their paths changes. */
  repartition() {
    this.list("findings");
    this.list("hosts");
    this.persistFindings();
    this.persistHosts();
  }
  /** Copy of every collection, e.g. for export/backup. */
  snapshot() {
    const out = {};
    for (const c of COLLECTIONS) out[c] = this.list(c);
    return out;
  }
}
const SLA_DAYS = {
  Critical: 30,
  High: 60,
  Medium: 90,
  Low: 180,
  Info: 365
};
function slaDueDate(severity, discoveredDate) {
  const d = new Date(discoveredDate || Date.now());
  d.setDate(d.getDate() + SLA_DAYS[severity]);
  return d.toISOString().slice(0, 10);
}
function isFindingOpen(f) {
  return f.status === "Open" || f.status === "In Remediation";
}
function isOverdue(f, now = /* @__PURE__ */ new Date()) {
  return isFindingOpen(f) && !!f.slaDueDate && new Date(f.slaDueDate) < now;
}
function slaDaysRemaining(f, now = /* @__PURE__ */ new Date()) {
  return Math.ceil((new Date(f.slaDueDate).getTime() - now.getTime()) / 864e5);
}
function slaStats(findings) {
  const withSla = findings.filter((f) => f.slaDueDate);
  const open = findings.filter(isFindingOpen);
  const closed = findings.filter((f) => !isFindingOpen(f));
  const overdue = findings.filter((f) => isOverdue(f));
  let compliant = 0;
  for (const f of withSla) {
    if (isFindingOpen(f)) {
      if (!isOverdue(f)) compliant++;
    } else if (!f.closedDate || new Date(f.closedDate) <= new Date(f.slaDueDate)) {
      compliant++;
    }
  }
  const closedWithDates = closed.filter((f) => f.closedDate && f.discoveredDate);
  const avgClosureDays = closedWithDates.length ? Math.round(
    closedWithDates.reduce(
      (s, f) => s + (new Date(f.closedDate).getTime() - new Date(f.discoveredDate).getTime()) / 864e5,
      0
    ) / closedWithDates.length
  ) : 0;
  return {
    total: findings.length,
    open: open.length,
    closed: closed.length,
    overdue: overdue.length,
    complianceRate: withSla.length ? Math.round(compliant / withSla.length * 100) : 100,
    avgClosureDays
  };
}
function fingerprintOf(f) {
  const norm = (v) => (v ?? "").trim().toLowerCase();
  const discriminator = norm(f.pluginId) || norm(f.title);
  const material = [norm(f.hostId), norm(f.ip), norm(f.port), discriminator, norm(f.endpoint), norm(f.parameter)].join(
    "|"
  );
  return crypto.createHash("sha256").update(material).digest("hex");
}
function classifyFinding(fingerprint, hostId, ctx) {
  const matches = ctx.priorFindings.filter((f) => f.fingerprint === fingerprint && f.assessmentId !== ctx.assessment.id);
  if (matches.length === 0) return "New";
  const latest = matches.reduce((a, b) => a.discoveredDate > b.discoveredDate ? a : b);
  const priorHost = ctx.hostsById.get(latest.hostId);
  const currentHost = ctx.hostsById.get(hostId);
  if (priorHost && currentHost && priorHost.exposure !== currentHost.exposure) return "Context Change";
  return isFindingOpen(latest) ? "Retest" : "Regression";
}
function classifyLifecycle(fingerprint, assessment, allAssessments, allFindings, requestsById) {
  if (assessment.timeframe !== "annual" && assessment.timeframe !== "quarterly") return null;
  const sortKey = (a) => a.startDate || a.createdAt;
  const previous = allAssessments.filter(
    (a) => a.id !== assessment.id && a.applicationId === assessment.applicationId && a.type === assessment.type && (a.timeframe || "adhoc") === assessment.timeframe && sortKey(a) < sortKey(assessment)
  ).sort((a, b) => sortKey(a) < sortKey(b) ? 1 : -1)[0];
  const asNew = {
    classification: "New",
    firstIdentifiedAssessmentType: "",
    firstIdentifiedPeriod: "",
    firstIdentifiedProjectCode: "",
    firstIdentifiedDate: ""
  };
  if (!previous) return asNew;
  const match = allFindings.find((f) => f.assessmentId === previous.id && f.fingerprint === fingerprint);
  if (!match) return asNew;
  if (match.firstIdentifiedPeriod) {
    return {
      classification: "Existing",
      firstIdentifiedAssessmentType: match.firstIdentifiedAssessmentType,
      firstIdentifiedPeriod: match.firstIdentifiedPeriod,
      firstIdentifiedProjectCode: match.firstIdentifiedProjectCode,
      firstIdentifiedDate: match.firstIdentifiedDate
    };
  }
  const request = previous.requestId ? requestsById.get(previous.requestId) : void 0;
  return {
    classification: "Existing",
    firstIdentifiedAssessmentType: previous.type,
    firstIdentifiedPeriod: periodLabel(previous.timeframe || "adhoc", previous.startDate || previous.createdAt),
    firstIdentifiedProjectCode: match.projectCode || request?.projectCode || "",
    firstIdentifiedDate: match.discoveredDate || ""
  };
}
const NESSUS_SEVERITY = {
  "4": "Critical",
  "3": "High",
  "2": "Medium",
  "1": "Low",
  "0": "Info"
};
const RISK_SEVERITY = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "Info",
  info: "Info",
  informational: "Info"
};
function asArray(x) {
  if (x === void 0 || x === null) return [];
  return Array.isArray(x) ? x : [x];
}
function parseNessusXml(xml) {
  const parser = new fastXmlParser.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    isArray: (name) => ["ReportHost", "ReportItem", "tag", "cve"].includes(name)
  });
  const doc = parser.parse(xml);
  const report = doc?.NessusClientData_v2?.Report;
  if (!report) throw new Error("Not a Nessus v2 export (missing NessusClientData_v2/Report)");
  const rows = [];
  for (const host of asArray(report.ReportHost)) {
    const tags = asArray(host.HostProperties?.tag);
    const prop = (n) => tags.find((t) => t["@_name"] === n)?.["#text"] ?? "";
    const ip = String(prop("host-ip") || host["@_name"] || "");
    const hostname = String(prop("host-fqdn") || prop("netbios-name") || host["@_name"] || ip);
    const os2 = String(prop("operating-system") || prop("os") || "");
    for (const item of asArray(host.ReportItem)) {
      const cvss = parseFloat(item.cvss3_base_score ?? item.cvss_base_score ?? "0") || 0;
      const checkName = String(item["cm:compliance-check-name"] ?? "");
      const actualValue = String(item["cm:compliance-actual-value"] ?? "");
      const pluginName = String(item["@_pluginName"] ?? item.plugin_name ?? "Unknown plugin");
      rows.push({
        ip,
        hostname,
        os: os2,
        port: String(item["@_port"] ?? "0"),
        pluginId: String(item["@_pluginID"] ?? ""),
        name: checkName || pluginName,
        pluginName,
        cve: asArray(item.cve).map(String).join(", "),
        cvss,
        severity: NESSUS_SEVERITY[String(item["@_severity"] ?? "0")] ?? "Info",
        description: String(item["cm:compliance-info"] ?? item.description ?? item.synopsis ?? ""),
        solution: String(item["cm:compliance-solution"] ?? item.solution ?? ""),
        evidence: actualValue ? `Actual value:
${actualValue}` : String(item["cm:compliance-output"] ?? item.plugin_output ?? ""),
        complianceResult: String(item["cm:compliance-result"] ?? "").toUpperCase()
      });
    }
  }
  return rows;
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}
function parseNessusCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    pluginId: col("plugin id"),
    cve: col("cve"),
    cvss: col("cvss v3.0 base score") !== -1 ? col("cvss v3.0 base score") : col("cvss"),
    risk: col("risk"),
    host: col("host"),
    port: col("port"),
    name: col("name"),
    description: col("description"),
    solution: col("solution"),
    output: col("plugin output")
  };
  if (idx.pluginId === -1 || idx.host === -1) {
    throw new Error('CSV is missing required Nessus columns ("Plugin ID", "Host")');
  }
  const cell = (r, i) => i >= 0 && i < r.length ? r[i].trim() : "";
  return rows.slice(1).map((r) => ({
    ip: cell(r, idx.host),
    hostname: cell(r, idx.host),
    os: "",
    port: cell(r, idx.port) || "0",
    pluginId: cell(r, idx.pluginId),
    name: cell(r, idx.name) || "Unknown plugin",
    pluginName: cell(r, idx.name) || "Unknown plugin",
    cve: cell(r, idx.cve),
    cvss: parseFloat(cell(r, idx.cvss)) || 0,
    severity: RISK_SEVERITY[cell(r, idx.risk).toLowerCase()] ?? "Info",
    description: cell(r, idx.description),
    solution: cell(r, idx.solution),
    evidence: cell(r, idx.output),
    complianceResult: ""
  }));
}
function importNessusFile(store, assessmentId, filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const isCsv = path.extname(filePath).toLowerCase() === ".csv";
  return importNessusContent(store, assessmentId, raw, path.basename(filePath), isCsv);
}
function importNessusContent(store, assessmentId, raw, sourceName, isCsv) {
  const assessment = store.get("assessments", assessmentId);
  if (!assessment) throw new Error("Assessment not found");
  const rows = isCsv ? parseNessusCsv(raw) : parseNessusXml(raw);
  const result = {
    imported: 0,
    duplicates: 0,
    hostsCreated: 0,
    classifications: { New: 0, Existing: 0, Retest: 0, Regression: 0, "Context Change": 0 },
    errors: []
  };
  const hosts = store.list("hosts");
  const sourceFile = sourceName;
  const hostByIp = new Map(hosts.filter((h) => h.sourceFile === sourceFile).map((h) => [h.ip, h]));
  const allFindings = store.list("findings");
  const priorFindings = allFindings.filter((f) => f.applicationId === assessment.applicationId);
  const existingInAssessment = new Set(
    allFindings.filter((f) => f.assessmentId === assessmentId).map((f) => f.fingerprint)
  );
  const hostsById = new Map(hosts.map((h) => [h.id, h]));
  const allAssessments = store.list("assessments");
  const requestsById = new Map(store.list("requests").map((r) => [r.id, r]));
  const assessmentProjectCode = assessment.requestId ? requestsById.get(assessment.requestId)?.projectCode ?? "" : "";
  const newFindings = [];
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const attachedHostIds = new Set(assessment.hostIds);
  for (const row of rows) {
    try {
      if (!row.ip) continue;
      let host = hostByIp.get(row.ip);
      if (!host) {
        host = store.create("hosts", {
          ip: row.ip,
          hostname: row.hostname,
          environment: "Production",
          exposure: assessment.type === "External VA" ? "external" : "internal",
          applicationId: assessment.applicationId,
          os: row.os,
          status: "Pending",
          notes: `Auto-created by Nessus import on ${today}`,
          sourceFile
        });
        hostByIp.set(row.ip, host);
        hostsById.set(host.id, host);
        result.hostsCreated++;
      }
      attachedHostIds.add(host.id);
      if (row.os && !host.os) {
        host = store.update("hosts", host.id, { os: row.os });
        hostsById.set(host.id, host);
      }
      const fingerprint = fingerprintOf({
        hostId: "",
        ip: row.ip,
        port: row.port,
        pluginId: row.pluginId,
        endpoint: "",
        parameter: row.complianceResult ? row.name : ""
      });
      if (existingInAssessment.has(fingerprint)) {
        result.duplicates++;
        continue;
      }
      existingInAssessment.add(fingerprint);
      const lifecycle = classifyLifecycle(fingerprint, assessment, allAssessments, allFindings, requestsById);
      const classification = lifecycle ? lifecycle.classification : classifyFinding(fingerprint, host.id, { priorFindings, hostsById, assessment });
      result.classifications[classification]++;
      newFindings.push({
        title: row.name,
        assessmentId,
        applicationId: assessment.applicationId,
        hostId: host.id,
        affectedAsset: "",
        severity: row.severity,
        cvss: row.cvss,
        cve: row.cve,
        cwe: "",
        owasp: "",
        pluginId: row.pluginId,
        pluginName: row.pluginName,
        endpoint: "",
        port: row.port,
        parameter: "",
        description: row.description,
        evidence: row.evidence,
        attachments: [],
        recommendation: row.solution,
        // Compliance results map onto the finding lifecycle: PASSED checks
        // arrive closed (shown as "Passed" in the host module), everything
        // else is an open issue (shown as "Failed").
        status: row.complianceResult === "PASSED" ? "Closed" : "Open",
        classification,
        fingerprint,
        projectCode: assessmentProjectCode,
        firstIdentifiedAssessmentType: lifecycle?.firstIdentifiedAssessmentType ?? "",
        firstIdentifiedPeriod: lifecycle?.firstIdentifiedPeriod ?? "",
        firstIdentifiedProjectCode: lifecycle?.firstIdentifiedProjectCode ?? "",
        firstIdentifiedDate: lifecycle?.firstIdentifiedDate ?? "",
        discoveredDate: today,
        slaDueDate: slaDueDate(row.severity, today),
        closedDate: row.complianceResult === "PASSED" ? today : ""
      });
      result.imported++;
    } catch (e) {
      result.errors.push(String(e));
    }
  }
  store.createMany("findings", newFindings);
  store.update("assessments", assessmentId, { hostIds: [...attachedHostIds] });
  try {
    const importsDir = path.join(store.getSettings().dataDir, "imports");
    fs.writeFileSync(path.join(importsDir, `${Date.now()}-${sourceName}`), raw);
  } catch {
  }
  return result;
}
async function api(conn, opts) {
  const url = conn.url.replace(/\/+$/, "") + opts.path;
  const headers = {
    "X-ApiKeys": `accessKey=${conn.accessKey}; secretKey=${conn.secretKey}`,
    Accept: "application/json"
  };
  if (opts.body) headers["Content-Type"] = "application/json";
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (conn.type === "Nessus") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : void 0,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3e4)
    });
    if (!res.ok && !opts.raw) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res;
  } finally {
    if (conn.type === "Nessus") {
      if (prev === void 0) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }
}
async function testConnection(conn) {
  try {
    const res = await api(conn, { path: "/scans", raw: true });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Authentication failed — check the access/secret keys." };
    }
    if (!res.ok) return { ok: false, message: `Scanner responded ${res.status} ${res.statusText}.` };
    await res.json();
    return { ok: true, message: `Connected to ${conn.type} at ${conn.url}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach scanner: ${e instanceof Error ? e.message : String(e)}` };
  }
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}
async function listScans(conn, includePolicy = false) {
  const res = await api(conn, { path: "/scans" });
  const data = await res.json();
  const base = (data.scans ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    lastModified: s.last_modification_date ? new Date(s.last_modification_date * 1e3).toISOString().slice(0, 16).replace("T", " ") : "",
    policy: ""
  }));
  if (!includePolicy) return base;
  return mapLimit(base, 5, async (scan) => {
    try {
      const detailRes = await api(conn, { path: `/scans/${scan.id}` });
      const detail = await detailRes.json();
      return { ...scan, policy: detail.info?.policy ?? "" };
    } catch {
      return scan;
    }
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchScanXml(conn, scanId, onProgress) {
  const progress = onProgress ?? (() => {
  });
  progress({ stage: "export", percent: 5, message: "Requesting export from scanner…" });
  const exportRes = await api(conn, {
    method: "POST",
    path: `/scans/${scanId}/export`,
    body: { format: "nessus" }
  });
  const { file, token } = await exportRes.json();
  let ready = false;
  for (let i = 0; i < 90; i++) {
    const statusRes = await api(conn, { path: `/scans/${scanId}/export/${file}/status` });
    const { status } = await statusRes.json();
    if (status === "ready") {
      ready = true;
      break;
    }
    if (status === "error") throw new Error("Scanner reported an export error for this scan.");
    progress({
      stage: "generating",
      percent: Math.min(70, 10 + i * 2),
      message: `Scanner is preparing the export… (${status || "queued"})`
    });
    await sleep(2e3);
  }
  if (!ready) {
    throw new Error("Export was not ready within 3 minutes — try again, or upload the .nessus file manually.");
  }
  progress({ stage: "downloading", percent: 75, message: "Downloading scan export…" });
  const downloadPath = token ? `/tokens/${token}/download` : `/scans/${scanId}/export/${file}/download`;
  const res = await api(conn, { path: downloadPath, raw: true, timeoutMs: 3e5 });
  if (!res.ok) throw new Error(`Export download failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  progress({
    stage: "downloading",
    percent: 88,
    message: `Downloaded ${(xml.length / 1024 / 1024).toFixed(1)} MB`
  });
  return xml;
}
function collectData(store, assessmentId) {
  const assessment = assessmentId ? store.get("assessments", assessmentId) : void 0;
  const request = assessment?.requestId ? store.get("requests", assessment.requestId) : void 0;
  const findings = store.list("findings").filter((f) => !assessmentId || f.assessmentId === assessmentId).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const allHosts = store.list("hosts");
  const hostList = assessment ? allHosts.filter((h) => assessment.hostIds.includes(h.id)) : allHosts;
  const hosts = new Map(allHosts.map((h) => [h.id, h]));
  const apps = new Map(store.list("applications").map((a) => [a.id, a]));
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const retestCounts = { New: 0, Existing: 0, Retest: 0, Regression: 0, "Context Change": 0 };
  for (const f of findings) {
    bySeverity[f.severity]++;
    retestCounts[f.classification] = (retestCounts[f.classification] ?? 0) + 1;
  }
  return {
    title: assessment ? `VAPT Report — ${assessment.name}` : "TVM Portal — Portfolio Vulnerability Report",
    projectCode: request?.projectCode ?? "",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " "),
    assessment,
    request,
    application: assessment?.applicationId ? apps.get(assessment.applicationId) : void 0,
    findings,
    hosts: hostList,
    hostName: (id) => {
      const h = hosts.get(id);
      return h ? h.hostname || h.ip : "—";
    },
    appName: (id) => apps.get(id)?.name ?? "—",
    attachmentPath: (att) => store.resolve(att.path),
    bySeverity,
    sla: slaStats(findings),
    retestCounts
  };
}
function firstIdentifiedLabel(f) {
  if (f.classification !== "Existing" || !f.firstIdentifiedPeriod) return "";
  return [f.firstIdentifiedPeriod, f.firstIdentifiedProjectCode].filter(Boolean).join(" · ");
}
function execSummaryText(d) {
  const open = d.findings.filter(isFindingOpen).length;
  return `This report covers ${d.findings.length} finding(s)` + (d.assessment ? ` from assessment "${assessmentPeriodTitle(d)}"` : " across the portfolio") + `. ${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issues were identified. ${open} finding(s) remain open, of which ${d.sla.overdue} are past their remediation SLA. Current SLA compliance is ${d.sla.complianceRate}% with an average closure time of ${d.sla.avgClosureDays} day(s).`;
}
const REPORT_SEVERITIES = SEVERITIES.filter((severity) => severity !== "Info");
const SEVERITY_XLSX_COLORS = {
  Critical: { fill: "FFDC2626", font: "FFFFFFFF" },
  High: { fill: "FFD97706", font: "FFFFFFFF" },
  Medium: { fill: "FFFFF2CC", font: "FF111827" },
  Low: { fill: "FF16A34A", font: "FFFFFFFF" }
};
function reportFindings(d) {
  return d.findings.filter((f) => f.severity !== "Info");
}
function assessmentAreaName(d) {
  switch (reportAssessmentKind(d)) {
    case "web":
      return "Web";
    case "api":
      return "API";
    case "mobile":
      return "Mobile";
    case "source-code":
      return "Source Code";
    case "internal":
      return "Internal";
    case "external":
      return "External";
    case "internal-external":
      return "Internal/External";
    case "host":
      return "Host";
    default:
      return assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? "")) || "Assessment";
  }
}
function excelSubjectName(d) {
  return (d.application?.name || d.request?.systemName || "").trim();
}
function assessmentPeriodTitle(d) {
  const subject = excelSubjectName(d) || assessmentAreaName(d);
  const dateIso = d.assessment?.startDate || d.assessment?.endDate || d.generatedAt;
  const date = new Date(dateIso);
  const year = Number.isNaN(date.getTime()) ? (/* @__PURE__ */ new Date()).getFullYear() : date.getFullYear();
  const quarter = Number.isNaN(date.getTime()) ? Math.floor((/* @__PURE__ */ new Date()).getMonth() / 3) + 1 : Math.floor(date.getMonth() / 3) + 1;
  if (d.assessment?.timeframe === "annual") return `Annual ${year} - ${subject}`;
  if (d.assessment?.timeframe === "quarterly") return `Q${quarter} Assessment - ${subject}`;
  return [d.projectCode, subject].filter(Boolean).join(" - ") || subject;
}
function excelBlank(value) {
  if (value === void 0 || value === null) return "";
  const text = String(value).trim();
  return text === "—" ? "" : value;
}
function excelDash(value) {
  const blank = excelBlank(value);
  return String(blank).trim() ? blank : "-";
}
function applyHeaderStyle(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB8C7D9" } },
      left: { style: "thin", color: { argb: "FFB8C7D9" } },
      bottom: { style: "thin", color: { argb: "FFB8C7D9" } },
      right: { style: "thin", color: { argb: "FFB8C7D9" } }
    };
  });
}
function applyHeaderRangeStyle(row, from = 1, to = 4) {
  for (let col = from; col <= to; col++) {
    const cell = row.getCell(col);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { vertical: "middle", horizontal: col === from ? "left" : "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB8C7D9" } },
      left: { style: "thin", color: { argb: "FFB8C7D9" } },
      bottom: { style: "thin", color: { argb: "FFB8C7D9" } },
      right: { style: "thin", color: { argb: "FFB8C7D9" } }
    };
  }
}
function applyDashboardCell(cell, horizontal = "left") {
  cell.alignment = { horizontal, vertical: "middle", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: "FFD9E2EC" } },
    left: { style: "thin", color: { argb: "FFD9E2EC" } },
    bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
    right: { style: "thin", color: { argb: "FFD9E2EC" } }
  };
}
function addDashboardPairHeader(sheet, left, right) {
  const rowNumber = sheet.rowCount + 1;
  sheet.addRow([left, right, "", ""]);
  applyHeaderRangeStyle(sheet.getRow(rowNumber), 1, 4);
}
function addDashboardPairRow(sheet, label, value, valueAlign = "left") {
  const rowNumber = sheet.rowCount + 1;
  sheet.addRow([label, value, "", ""]);
  applyDashboardCell(sheet.getCell(`A${rowNumber}`), "left");
  applyDashboardCell(sheet.getCell(`B${rowNumber}`), valueAlign);
  applyDashboardCell(sheet.getCell(`C${rowNumber}`), "left");
  applyDashboardCell(sheet.getCell(`D${rowNumber}`), "left");
}
function applyTableStyle(sheet, headerRow = 1) {
  applyHeaderStyle(sheet.getRow(headerRow));
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9E2EC" } },
        left: { style: "thin", color: { argb: "FFD9E2EC" } },
        bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
        right: { style: "thin", color: { argb: "FFD9E2EC" } }
      };
      if (rowNumber > headerRow && rowNumber % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    });
  });
}
function applySeverityStyle(cell, severity) {
  if (severity === "Info") return;
  const tone = SEVERITY_XLSX_COLORS[severity];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
  cell.font = { bold: true, color: { argb: tone.font } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}
async function writeExcel(d, outputPath) {
  const wb = new ExcelJS.Workbook();
  wb.created = /* @__PURE__ */ new Date();
  const findings = reportFindings(d);
  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 38 }, { width: 18 }, { width: 18 }];
  summary.getCell("A1").value = assessmentPeriodTitle(d);
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  summary.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
  applyHeaderRangeStyle(summary.getRow(1), 1, 4);
  summary.getRow(1).height = 28;
  summary.addRow([]);
  summary.addRow(["Report Information", "", "", ""]);
  applyHeaderRangeStyle(summary.getRow(3), 1, 4);
  addDashboardPairHeader(summary, "Field", "Details");
  const metaRows = [
    ["Project Code", excelDash(d.projectCode)],
    ["Application / System", excelDash(excelSubjectName(d))],
    ["Owner Name", excelDash(d.application?.owner)],
    ["Department", excelDash(d.request?.department || d.application?.businessUnit)],
    ["Assessment Type", excelDash(assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? "")))],
    ["Assessment Window", excelDash([d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(" to "))],
    ["Generated At", excelDash(d.generatedAt)]
  ];
  for (const [label, value] of metaRows) addDashboardPairRow(summary, label, value, "left");
  summary.addRow([]);
  const severityHeaderRow = summary.rowCount + 1;
  summary.addRow(["Severity Dashboard", "", "", ""]);
  applyHeaderRangeStyle(summary.getRow(severityHeaderRow), 1, 4);
  const severityTableHeaderRow = summary.rowCount + 1;
  summary.addRow(["Severity", "Number of Finding", "Open", "Closed"]);
  applyHeaderRangeStyle(summary.getRow(severityTableHeaderRow), 1, 4);
  for (const severity of REPORT_SEVERITIES) {
    const severityFindings = findings.filter((f) => f.severity === severity);
    const row = summary.addRow([
      severity,
      severityFindings.length,
      severityFindings.filter(isFindingOpen).length,
      severityFindings.filter((f) => !isFindingOpen(f)).length
    ]);
    applySeverityStyle(row.getCell(1), severity);
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).alignment = { horizontal: "center" };
  }
  summary.addRow([]);
  const slaHeaderRow = summary.rowCount + 1;
  summary.addRow(["SLA Dashboard", "", "", ""]);
  applyHeaderRangeStyle(summary.getRow(slaHeaderRow), 1, 4);
  addDashboardPairHeader(summary, "Metric", "Value");
  addDashboardPairRow(summary, "Open Findings", d.sla.open, "center");
  addDashboardPairRow(summary, "Closed Findings", d.sla.closed, "center");
  addDashboardPairRow(summary, "Overdue Findings", d.sla.overdue, "center");
  addDashboardPairRow(summary, "SLA Compliance", `${d.sla.complianceRate}%`, "center");
  addDashboardPairRow(summary, "Average Closure Days", d.sla.avgClosureDays, "center");
  summary.addRow([]);
  const execHeaderRow = summary.rowCount + 1;
  summary.addRow(["Executive Summary", "", "", ""]);
  applyHeaderRangeStyle(summary.getRow(execHeaderRow), 1, 4);
  summary.addRow([execSummaryText({ ...d, findings })]);
  summary.getCell(`A${summary.rowCount}`).alignment = { wrapText: true, vertical: "top", horizontal: "left" };
  for (let col = 2; col <= 4; col++) applyDashboardCell(summary.getRow(summary.rowCount).getCell(col), "left");
  summary.getRow(summary.rowCount).height = 54;
  summary.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9E2EC" } },
        left: { style: "thin", color: { argb: "FFD9E2EC" } },
        bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
        right: { style: "thin", color: { argb: "FFD9E2EC" } }
      };
      cell.alignment = { ...cell.alignment ?? {}, vertical: "top", wrapText: true };
    });
  });
  const tracker = wb.addWorksheet("Report Tracker");
  tracker.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Project Code", key: "projectCode", width: 20 },
    { header: "Application", key: "app", width: 24 },
    { header: "Finding", key: "title", width: 42 },
    { header: "Severity", key: "severity", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "CVSS", key: "cvss", width: 8 },
    { header: "Description", key: "description", width: 55 },
    { header: "Affected Asset", key: "asset", width: 34 },
    { header: "Host", key: "host", width: 22 },
    { header: "Affected Endpoint", key: "endpoint", width: 28 },
    { header: "Affected Parameter", key: "parameter", width: 20 },
    { header: "Recommendation", key: "recommendation", width: 60 },
    { header: "Proof of Concept", key: "poc", width: 55 },
    { header: "OWASP", key: "owasp", width: 22 },
    { header: "Discovered", key: "discovered", width: 14 }
  ];
  for (const [index, f] of findings.entries()) {
    tracker.addRow({
      id: "F-" + String(index + 1).padStart(3, "0"),
      projectCode: excelBlank(f.projectCode || d.projectCode),
      app: excelBlank(d.appName(f.applicationId)),
      title: excelBlank(f.title),
      severity: excelBlank(f.severity),
      status: excelBlank(f.status),
      cvss: excelBlank(f.cvss || ""),
      description: excelBlank(f.description),
      asset: excelBlank(f.affectedAsset || f.endpoint || (f.hostId ? d.hostName(f.hostId) : "")),
      host: excelBlank(f.hostId ? d.hostName(f.hostId) : ""),
      endpoint: excelBlank(f.endpoint),
      parameter: excelBlank(f.parameter),
      recommendation: excelBlank(f.recommendation),
      poc: excelBlank([f.evidence, (f.attachments ?? []).map((a) => a.filename).join("; ")].filter(Boolean).join("\n")),
      owasp: excelBlank(f.owasp),
      discovered: excelBlank(f.discoveredDate)
    });
  }
  tracker.autoFilter = { from: "A1", to: "P1" };
  applyTableStyle(tracker);
  tracker.eachRow((row, rowNumber) => {
    if (rowNumber > 1) applySeverityStyle(row.getCell("severity"), row.getCell("severity").value);
  });
  const slaSheet = wb.addWorksheet("SLA Tracking");
  slaSheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Finding", key: "title", width: 45 },
    { header: "Severity", key: "severity", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "Discovered", key: "discovered", width: 14 },
    { header: "SLA Due", key: "due", width: 14 },
    { header: "Days Remaining", key: "days", width: 16 },
    { header: "Overdue", key: "overdue", width: 10 },
    { header: "Closed", key: "closed", width: 14 }
  ];
  for (const [index, f] of findings.entries()) {
    slaSheet.addRow({
      id: "F-" + String(index + 1).padStart(3, "0"),
      title: excelBlank(f.title),
      severity: excelBlank(f.severity),
      status: excelBlank(f.status),
      discovered: excelBlank(f.discoveredDate),
      due: excelBlank(f.slaDueDate),
      days: isFindingOpen(f) && f.slaDueDate ? slaDaysRemaining(f) : "",
      overdue: isOverdue(f) ? "YES" : "",
      closed: excelBlank(f.closedDate)
    });
  }
  slaSheet.autoFilter = { from: "A1", to: "I1" };
  applyTableStyle(slaSheet);
  slaSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) applySeverityStyle(row.getCell("severity"), row.getCell("severity").value);
  });
  await wb.xlsx.writeFile(outputPath);
}
function displayValue(value) {
  if (value === void 0 || value === null) return "";
  return String(value);
}
function paragraph(text = "", options = {}) {
  return new docx.Paragraph({
    style: "Normal",
    alignment: docx.AlignmentType.JUSTIFIED,
    children: [new docx.TextRun({ text, size: 24 })],
    spacing: { after: 120 },
    ...options
  });
}
function blankLine() {
  return new docx.Paragraph({ text: "", spacing: { before: 80, after: 80 } });
}
function headingTextRun(text, size) {
  return new docx.TextRun({ text, bold: true, size });
}
function headingChildren(text, size, bookmarkId) {
  const run = headingTextRun(text, size);
  return bookmarkId ? [new docx.Bookmark({ id: bookmarkId, children: [run] })] : [run];
}
function heading1(text, bookmarkId) {
  return new docx.Paragraph({
    heading: docx.HeadingLevel.HEADING_1,
    spacing: { before: 340, after: 200 },
    children: headingChildren(text, 36, bookmarkId)
  });
}
function heading2(text, bookmarkId) {
  return new docx.Paragraph({
    heading: docx.HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 160 },
    children: headingChildren(text, 28, bookmarkId)
  });
}
function tocTitle(text) {
  return new docx.Paragraph({
    spacing: { before: 260, after: 160 },
    children: [new docx.TextRun({ text, bold: true, size: 40 })]
  });
}
function reportDate(d) {
  return d.generatedAt.split(" ")[0] || d.generatedAt;
}
function applicationName(d) {
  return d.application?.name || d.request?.systemName || d.assessment?.name || "";
}
function normalizeAssessmentKind(...values) {
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const text = raw.toLowerCase().replace(/[\s_\-/]+/g, " ");
    if (text.includes("source code") || text.includes("code review") || text.includes("secure code") || text.includes("sast") || text.includes("static application security")) return "source-code";
    if (text === "web" || text.includes("web application") || text.includes("wapt")) return "web";
    if (text === "api" || text.includes("api security") || text.includes("api assessment")) return "api";
    if (text.includes("mobile") || text.includes("mapt")) return "mobile";
    if (text.includes("internal external") || text.includes("internal / external")) return "internal-external";
    if (text.includes("external") || text.includes(" eva") || text === "eva" || text.includes("external va")) return "external";
    if (text.includes("internal") || text.includes(" iva") || text === "iva" || text.includes("internal va")) return "internal";
    if (text === "host" || text.includes("host va") || text.includes("host vulnerability")) return "host";
    if (text.includes("retest")) return "retest";
    if (text === "web application") return "web";
  }
  return void 0;
}
function reportAssessmentKind(d) {
  return normalizeAssessmentKind(
    d.assessment?.type,
    d.request?.assessmentType,
    d.request?.source?.typeOfSystem,
    d.assessment?.category,
    d.assessment?.name,
    d.request?.title
  );
}
function reportTitle(d) {
  switch (reportAssessmentKind(d)) {
    case "web":
      return "Web Application Penetration Testing (WAPT) Report";
    case "api":
      return "API Security Assessment Report";
    case "mobile":
      return "Mobile Application Penetration Testing (MAPT) Report";
    case "source-code":
      return "Source Code Security Review Report";
    case "internal":
      return "Internal Vulnerability Assessment (IVA) Report";
    case "external":
      return "External Vulnerability Assessment (EVA) Report";
    case "internal-external":
      return "Internal / External Vulnerability Assessment Report";
    case "host":
      return "Host Vulnerability Assessment Report";
    case "retest":
      return "Security Retest Report";
    default:
      return d.assessment || d.request ? "Security Assessment Report" : "Portfolio Vulnerability Report";
  }
}
function executiveReportTitle(d) {
  return reportTitle(d).replace(/ Report$/, " Executive Summary Report");
}
function coverTextParagraph(text, size, bold = false, after = 0) {
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    spacing: { line: 360, after },
    children: [new docx.TextRun({ text, bold, size })]
  });
}
function coverSubjectParagraphs(d) {
  const appName = applicationName(d);
  const lines = d.projectCode ? [d.projectCode, appName].filter(Boolean) : [appName || detailValue("")];
  return lines.map((line, index) => coverTextParagraph(line, 44, true, index === lines.length - 1 ? 0 : 90));
}
function coverLogo() {
  const candidates = [
    path.join(process.cwd(), "image", "bankislam-logo.png"),
    path.join(__dirname, "..", "..", "image", "bankislam-logo.png")
  ];
  const logoPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!logoPath) return void 0;
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [
      new docx.ImageRun({
        type: "png",
        data: fs.readFileSync(logoPath),
        transformation: { width: 680, height: 234 },
        altText: { title: "Bank Islam Logo", description: "Bank Islam logo", name: "Bank Islam Logo" }
      })
    ]
  });
}
function assessmentTypeLabel(type, fallback) {
  switch (normalizeAssessmentKind(type, fallback)) {
    case "web":
      return "Web Application Testing";
    case "api":
      return "API Security Assessment";
    case "mobile":
      return "Mobile Application Testing";
    case "source-code":
      return "Source Code Security Review";
    case "internal":
      return "Internal Vulnerability Assessment";
    case "external":
      return "External Vulnerability Assessment";
    case "internal-external":
      return "Internal / External Vulnerability Assessment";
    case "host":
      return "Host Vulnerability Assessment";
    case "retest":
      return "Security Retest";
    default:
      return type || fallback || "";
  }
}
function subsection(text, bookmarkId) {
  return heading2(text, bookmarkId);
}
function numberedLine(text) {
  return new docx.Paragraph({
    style: "Normal",
    numbering: { reference: "owasp-roman", level: 0 },
    spacing: { after: 70 },
    children: [new docx.TextRun({ text, size: 24 })]
  });
}
function tocEntries(findings) {
  return [
    { id: "toc_document_control", title: "Document Control", level: 1, page: 2 },
    { id: "toc_executive_summary", title: "1 Executive Summary", level: 1, page: 4 },
    { id: "toc_executive_introduction", title: "1.1 Introduction", level: 2, page: 4 },
    { id: "toc_background_information", title: "1.2 Background Information", level: 2, page: 4 },
    { id: "toc_reference_standards", title: "1.3 Reference Standards", level: 2, page: 4 },
    { id: "toc_purpose_of_testing", title: "1.4 Purpose of Testing", level: 2, page: 4 },
    { id: "toc_summary_technical_findings", title: "2 Summary of Technical Findings", level: 1, page: 5 },
    { id: "toc_summary_introduction", title: "2.1 Introduction", level: 2, page: 5 },
    { id: "toc_project_scope", title: "2.2 Project Scope", level: 2, page: 5 },
    { id: "toc_summary_findings", title: "2.3 Summary of Findings", level: 2, page: 5 },
    { id: "toc_detailed_technical_findings", title: "3 Detailed Technical Findings", level: 1, page: 6 },
    ...findings.map((finding, index) => ({ id: `toc_finding_${index + 1}`, title: `3.${index + 1} ${finding.title}`, level: 2, page: 6 }))
  ];
}
function tocField(findings) {
  return new docx.TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-2",
    hideTabAndPageNumbersInWebView: true,
    cachedEntries: tocEntries(findings).map((entry) => ({ title: entry.title, level: entry.level, page: entry.page, href: entry.id })),
    beginDirty: true
  });
}
function referenceRiskIntro(d) {
  switch (reportAssessmentKind(d)) {
    case "web":
      return "The assessment is aligned to the latest OWASP Top 10:2025 application security risk categories where applicable:";
    case "api":
      return "The assessment is aligned to the OWASP API Security Top 10 2023 risk categories where applicable:";
    case "mobile":
      return "The assessment is aligned to the OWASP Mobile Top 10 2024 risk categories and OWASP MASVS guidance where applicable:";
    case "source-code":
      return "The review is aligned to secure code review references and common software weakness categories where applicable:";
    case "internal":
    case "external":
    case "internal-external":
    case "host":
      return "The assessment is aligned to vulnerability assessment and secure configuration reference areas where applicable:";
    default:
      return "The assessment is aligned to general security assessment reference areas where a specific risk category is not available:";
  }
}
function referenceRiskCategories(d) {
  switch (reportAssessmentKind(d)) {
    case "web":
      return [
        "A01:2025 - Broken Access Control",
        "A02:2025 - Security Misconfiguration",
        "A03:2025 - Software Supply Chain Failures",
        "A04:2025 - Cryptographic Failures",
        "A05:2025 - Injection",
        "A06:2025 - Insecure Design",
        "A07:2025 - Authentication Failures",
        "A08:2025 - Software or Data Integrity Failures",
        "A09:2025 - Security Logging and Alerting Failures",
        "A10:2025 - Mishandling of Exceptional Conditions"
      ];
    case "api":
      return [
        "API1:2023 - Broken Object Level Authorization",
        "API2:2023 - Broken Authentication",
        "API3:2023 - Broken Object Property Level Authorization",
        "API4:2023 - Unrestricted Resource Consumption",
        "API5:2023 - Broken Function Level Authorization",
        "API6:2023 - Unrestricted Access to Sensitive Business Flows",
        "API7:2023 - Server Side Request Forgery",
        "API8:2023 - Security Misconfiguration",
        "API9:2023 - Improper Inventory Management",
        "API10:2023 - Unsafe Consumption of APIs"
      ];
    case "mobile":
      return [
        "M1:2024 - Improper Credential Usage",
        "M2:2024 - Inadequate Supply Chain Security",
        "M3:2024 - Insecure Authentication/Authorization",
        "M4:2024 - Insufficient Input/Output Validation",
        "M5:2024 - Insecure Communication",
        "M6:2024 - Inadequate Privacy Controls",
        "M7:2024 - Insufficient Binary Protections",
        "M8:2024 - Security Misconfiguration",
        "M9:2024 - Insecure Data Storage",
        "M10:2024 - Insufficient Cryptography"
      ];
    case "source-code":
      return [
        "OWASP ASVS - Architecture, authentication, session, access control, validation, cryptography, error handling, logging, API, and configuration controls",
        "CWE Top 25 - Common and impactful software weakness classes",
        "Input validation and output encoding weaknesses",
        "Authentication, authorisation, and session management logic flaws",
        "Cryptographic implementation and secrets-handling weaknesses",
        "Dependency, supply chain, and insecure component usage",
        "Error handling, logging, and security monitoring gaps",
        "Secure configuration and environment-specific assumptions"
      ];
    case "internal":
      return [
        "CVE/CWE mapping and vulnerability validation",
        "CVSS severity scoring and technical risk prioritisation",
        "Patch status, unsupported software, and vulnerable service versions",
        "Weak configuration, insecure protocols, and unnecessary services",
        "Credential, privilege, and access-control exposure",
        "Network segmentation and lateral-movement exposure",
        "CIS Controls / CIS Benchmarks secure configuration alignment where applicable"
      ];
    case "external":
      return [
        "CVE/CWE mapping and vulnerability validation",
        "CVSS severity scoring and external exposure prioritisation",
        "Internet-facing service exposure and perimeter configuration",
        "TLS/SSL, certificate, and weak encryption findings",
        "Unsupported software, missing patches, and exposed vulnerable services",
        "Unnecessary public exposure, information disclosure, and attack surface reduction",
        "CIS Controls / CIS Benchmarks secure configuration alignment where applicable"
      ];
    case "internal-external":
      return [
        "CVE/CWE mapping and vulnerability validation",
        "CVSS severity scoring and risk prioritisation",
        "Internal network exposure, segmentation, and lateral-movement risk",
        "External attack surface, perimeter configuration, and internet-facing exposure",
        "Patch status, unsupported software, insecure services, and weak protocols",
        "Secure configuration alignment using CIS Controls / CIS Benchmarks where applicable"
      ];
    case "host":
      return [
        "CVE/CWE mapping and vulnerability validation",
        "CVSS severity scoring and host-level risk prioritisation",
        "Operating system and installed software patch status",
        "Service exposure, insecure protocols, and unnecessary listening services",
        "Host hardening, account configuration, and privilege exposure",
        "CIS Benchmarks / secure configuration alignment where applicable"
      ];
    default:
      return [
        "CVE/CWE mapping and vulnerability validation where applicable",
        "CVSS severity scoring and remediation prioritisation",
        "Secure configuration and hardening review",
        "Authentication, authorisation, and access-control review",
        "Patch status, dependency, and vulnerable component review",
        "Evidence-based remediation guidance and closure tracking"
      ];
  }
}
function referenceRiskParagraphs(d) {
  return referenceRiskCategories(d).map((category) => numberedLine(category));
}
function assessmentDisplayName(d) {
  return [d.projectCode, applicationName(d)].filter(Boolean).join(" - ") || d.assessment?.name || d.request?.title || "Security Assessment";
}
function executiveIntroductionParagraph(d, findings) {
  const open = findings.filter(isFindingOpen).length;
  const assessment = d.assessment || d.request;
  const assessmentLabel = assessmentDisplayName(d);
  const suffix = `${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issue(s) were identified, and ${open} finding(s) remain open. The report presents the agreed testing scope, validated security weaknesses, risk context, and practical recommendations to support remediation and management decision-making.`;
  return new docx.Paragraph({
    style: "Normal",
    alignment: docx.AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    children: assessment ? [
      new docx.TextRun({ text: `This report covers ${findings.length} finding(s) from assessment "`, size: 24 }),
      new docx.TextRun({ text: assessmentLabel, bold: true, size: 24 }),
      new docx.TextRun({ text: `". ${suffix}`, size: 24 })
    ] : [new docx.TextRun({ text: `This report covers ${findings.length} finding(s) across the assessed portfolio. ${suffix}`, size: 24 })]
  });
}
function isReportContextNoise(value) {
  const text = value.toLowerCase();
  return text.startsWith("auto-created for adhoc") || text.includes("srs v6.2");
}
function backgroundContext(d) {
  const detail = [d.application?.description, d.request?.scope, d.assessment?.notes, d.request?.notes].map((value) => displayValue(value).trim()).find((value) => value && !isReportContextNoise(value));
  return detail ? `The assessment context provided for this report is: ${detail}. ` : "";
}
function backgroundInformation(d) {
  const context = backgroundContext(d);
  switch (reportAssessmentKind(d)) {
    case "web":
      return `${context}Web applications are commonly targeted through weaknesses in access control, authentication, session management, input validation, business logic, configuration, and third-party components. This assessment focuses on identifying web application weaknesses that could affect confidentiality, integrity, availability, or business operations.`;
    case "api":
      return `${context}APIs expose application functionality and data through structured interfaces that are frequently consumed by web, mobile, partner, and system integrations. This assessment focuses on API-specific risks such as broken object-level authorisation, weak authentication, excessive data exposure, injection, rate-limit gaps, insecure configuration, and insufficient logging or monitoring.`;
    case "mobile":
      return `${context}Mobile applications introduce security considerations across client-side storage, platform permissions, authentication flows, transport security, tamper resistance, backend communication, and session handling. This assessment focuses on weaknesses that may expose user data, weaken transaction integrity, or create unauthorised access paths through the mobile application or its supporting services.`;
    case "source-code":
      return `${context}Source code security review focuses on identifying weaknesses in implementation before or alongside runtime testing. The review considers insecure coding patterns, input handling, authentication and authorisation logic, cryptographic usage, secrets handling, error handling, dependency usage, and security control implementation that may introduce exploitable vulnerabilities.`;
    case "internal":
      return `${context}Internal vulnerability assessment evaluates assets that are reachable from within the organisation's network or trusted zones. The assessment focuses on weaknesses such as outdated software, missing patches, weak configuration, unnecessary services, insecure protocols, excessive exposure between network segments, and control gaps that could support lateral movement or privilege escalation.`;
    case "external":
      return `${context}External vulnerability assessment evaluates internet-facing or externally reachable assets from an attacker-facing perspective. The assessment focuses on exposed services, perimeter configuration, outdated software, weak encryption, unnecessary public exposure, and vulnerabilities that could be discovered or exploited without internal network access.`;
    case "internal-external":
      return `${context}Internal and external vulnerability assessment evaluates the security posture of in-scope infrastructure across both trusted network zones and externally reachable attack surfaces. The assessment focuses on identifying exposed weaknesses, configuration gaps, outdated software, insecure services, and prioritised remediation actions based on technical risk and business exposure.`;
    case "host":
      return `${context}Host vulnerability assessment evaluates the security posture of individual servers, endpoints, or network hosts. The assessment focuses on operating system and service vulnerabilities, patch status, insecure configuration, weak protocols, unnecessary services, local exposure, and host-level hardening gaps that may increase compromise or operational risk.`;
    default:
      return `${context}This assessment evaluates the security posture of the in-scope application, system, hosts, endpoints, or supporting components. Where a specific testing category is not available, the background is treated as a general security assessment context focused on validated weaknesses, business risk, operational resilience, and remediation priorities.`;
  }
}
function purposeOfTesting(d) {
  const statedPurpose = displayValue(d.request?.purpose).trim();
  const scope = displayValue(d.request?.scope).trim();
  const driver = statedPurpose ? `The stated business driver for this activity is ${statedPurpose}. ` : "";
  const scopeText = scope ? `Testing is performed within the agreed scope: ${scope}. ` : "Testing is performed within the agreed in-scope application, system, host, endpoint, or supporting component boundaries. ";
  const releaseContext = "The testing supports new system onboarding, system updates, release readiness, change assurance, or continued operation by identifying security weaknesses before they can materially affect users, data, services, or business processes. ";
  switch (reportAssessmentKind(d)) {
    case "web":
      return `${driver}The purpose of this web application security testing is to evaluate the security posture of the in-scope web application and supporting components. ${scopeText}${releaseContext}Testing focuses on validating exposure to common web application risks such as access control flaws, authentication and session weaknesses, injection, insecure configuration, sensitive data exposure, business logic abuse, and vulnerable dependencies. The outcome provides evidence-based findings and practical remediation guidance for risk-based prioritisation.`;
    case "api":
      return `${driver}The purpose of this API security testing is to evaluate the security posture of the in-scope APIs, endpoints, data flows, and supporting services. ${scopeText}${releaseContext}Testing focuses on authorisation, authentication, object and function-level access control, input handling, rate limiting, sensitive data exposure, unsafe API consumption, and configuration weaknesses. The outcome helps teams reduce integration risk and strengthen API control coverage.`;
    case "mobile":
      return `${driver}The purpose of this mobile application security testing is to evaluate the in-scope mobile application, its platform interactions, local data handling, network communication, authentication flows, and backend integration points. ${scopeText}${releaseContext}Testing focuses on risks such as insecure storage, weak communication protection, insufficient authentication or authorisation, credential handling, input/output validation, privacy controls, binary protection, and backend service exposure.`;
    case "source-code":
      return `${driver}The purpose of this source code security review is to evaluate whether the in-scope codebase implements security controls correctly and avoids common insecure coding patterns. ${scopeText}${releaseContext}The review focuses on authentication and authorisation logic, input validation, output handling, cryptography, secrets management, dependency usage, error handling, logging, configuration assumptions, and security-relevant business logic before or alongside runtime testing.`;
    case "internal":
      return `${driver}The purpose of this internal vulnerability assessment is to evaluate the security posture of assets reachable from internal or trusted network zones. ${scopeText}${releaseContext}Testing focuses on missing patches, outdated services, insecure configuration, weak protocols, unnecessary services, credential or privilege exposure, segmentation weaknesses, and conditions that could support lateral movement or operational impact.`;
    case "external":
      return `${driver}The purpose of this external vulnerability assessment is to evaluate the security posture of internet-facing or externally reachable assets from an attacker-facing perspective. ${scopeText}${releaseContext}Testing focuses on exposed services, perimeter configuration, outdated software, weak encryption, unnecessary public exposure, information disclosure, and vulnerabilities that could be discovered or exploited without internal network access.`;
    case "internal-external":
      return `${driver}The purpose of this internal and external vulnerability assessment is to evaluate the security posture of in-scope assets across both trusted network zones and externally reachable attack surfaces. ${scopeText}${releaseContext}Testing focuses on patch status, exposed services, insecure protocols, weak configuration, perimeter exposure, segmentation risk, and prioritised remediation across internal and external perspectives.`;
    case "host":
      return `${driver}The purpose of this host vulnerability assessment is to evaluate the security posture of in-scope servers, endpoints, or network hosts. ${scopeText}${releaseContext}Testing focuses on operating system and software patch status, service exposure, insecure protocols, unnecessary listening services, host hardening, account configuration, privilege exposure, and host-level configuration weaknesses.`;
    default:
      return `${driver}The purpose of this security testing is to evaluate the security posture of the in-scope application, system, hosts, endpoints, and supporting components. ${scopeText}${releaseContext}Testing is performed to identify vulnerabilities, validate likelihood and impact, provide evidence for remediation, and support risk-based prioritisation before production use, release, update, or continued operation.`;
  }
}
function detailValue(value) {
  const text = displayValue(value).trim();
  return text || "no value/details";
}
function shouldShowSlaDue(d) {
  return d.assessment?.timeframe === "quarterly" || d.assessment?.timeframe === "annual";
}
function detailSection(title, value) {
  return [
    new docx.Paragraph({ children: [new docx.TextRun({ text: `${title}:`, bold: true, size: 24 })], spacing: { before: 180, after: 60 } }),
    paragraph(detailValue(value), { spacing: { after: 180 } })
  ];
}
function cm(value) {
  return Math.round(value * 567);
}
const SEVERITY_DOCX_COLORS = {
  Critical: { fill: "DC2626", font: "FFFFFF" },
  High: { fill: "D97706", font: "FFFFFF" },
  Medium: { fill: "FACC15", font: "111827" },
  Low: { fill: "16A34A", font: "FFFFFF" }
};
function tableParagraph(children, alignment) {
  return new docx.Paragraph({ alignment, spacing: { before: 0, after: 0 }, children });
}
function tableCell(text, bold = false, options = {}) {
  return new docx.TableCell({
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    ...options,
    children: [
      tableParagraph(
        [new docx.TextRun({ text: displayValue(text), bold, size: 24, color: options.shading ? SEVERITY_DOCX_COLORS[text]?.font : void 0 })],
        options.shading ? docx.AlignmentType.CENTER : void 0
      )
    ]
  });
}
function centeredCell(text, bold = false, options = {}) {
  return new docx.TableCell({
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    ...options,
    children: [tableParagraph([new docx.TextRun({ text: displayValue(text), bold, size: 24 })], docx.AlignmentType.CENTER)]
  });
}
function headerCell(text, options = {}) {
  return new docx.TableCell({
    shading: { fill: "1F4E78" },
    ...options,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [tableParagraph([new docx.TextRun({ text, bold: true, color: "FFFFFF", size: 24 })], docx.AlignmentType.CENTER)]
  });
}
function severityCell(severity, options = {}) {
  if (severity === "Info") return tableCell(severity, true, options);
  return tableCell(severity, true, { ...options, shading: { fill: SEVERITY_DOCX_COLORS[severity].fill } });
}
const DOCX_TABLE_BORDER = { style: docx.BorderStyle.SINGLE, size: 4, color: "C9D3DF" };
const DOCX_METADATA_TABLE_WIDTHS = [cm(4.6), cm(11.9)];
const DOCX_SUMMARY_TABLE_WIDTHS = [cm(4), cm(4.5), cm(4.5)];
const DOCX_TECHNICAL_TABLE_WIDTHS = [cm(2.8), cm(5.4), cm(2.8), cm(5.4)];
function docxTableBorders() {
  return {
    top: DOCX_TABLE_BORDER,
    bottom: DOCX_TABLE_BORDER,
    left: DOCX_TABLE_BORDER,
    right: DOCX_TABLE_BORDER,
    insideHorizontal: DOCX_TABLE_BORDER,
    insideVertical: DOCX_TABLE_BORDER
  };
}
function kvLabelCell(text) {
  return new docx.TableCell({
    width: { size: DOCX_METADATA_TABLE_WIDTHS[0], type: docx.WidthType.DXA },
    shading: { fill: "EEF2F7" },
    margins: { top: 130, bottom: 130, left: 140, right: 140 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [
      tableParagraph([new docx.TextRun({ text, bold: true, size: 24, color: "1F2937" })], docx.AlignmentType.LEFT)
    ]
  });
}
function kvValueCell(text) {
  return new docx.TableCell({
    width: { size: DOCX_METADATA_TABLE_WIDTHS[1], type: docx.WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 160, right: 160 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [tableParagraph([new docx.TextRun({ text: displayValue(text) || "-", size: 24, color: "111827" })])]
  });
}
function kvTable(rows, width = 100, alignment = docx.AlignmentType.CENTER) {
  const safeRows = rows.length > 0 ? rows : [["", ""]];
  return new docx.Table({
    width: { size: width, type: docx.WidthType.PERCENTAGE },
    alignment,
    layout: docx.TableLayoutType.FIXED,
    columnWidths: DOCX_METADATA_TABLE_WIDTHS,
    borders: docxTableBorders(),
    rows: safeRows.map(
      ([k, v]) => new docx.TableRow({
        children: [kvLabelCell(k), kvValueCell(v)]
      })
    )
  });
}
function projectScopeTable(rows) {
  return new docx.Table({
    width: { size: cm(15), type: docx.WidthType.DXA },
    alignment: docx.AlignmentType.CENTER,
    layout: docx.TableLayoutType.AUTOFIT,
    columnWidths: [cm(5), cm(10)],
    borders: docxTableBorders(),
    rows: rows.map(
      ([k, v]) => new docx.TableRow({
        children: [
          new docx.TableCell({
            width: { size: cm(5), type: docx.WidthType.DXA },
            shading: { fill: "EEF2F7" },
            margins: { top: 130, bottom: 130, left: 140, right: 140 },
            verticalAlign: docx.VerticalAlignTable.CENTER,
            children: [tableParagraph([new docx.TextRun({ text: k, bold: true, size: 24, color: "1F2937" })])]
          }),
          new docx.TableCell({
            width: { size: cm(10), type: docx.WidthType.DXA },
            margins: { top: 130, bottom: 130, left: 160, right: 160 },
            verticalAlign: docx.VerticalAlignTable.CENTER,
            children: [tableParagraph([new docx.TextRun({ text: displayValue(v) || "-", size: 24, color: "111827" })])]
          })
        ]
      })
    )
  });
}
function summaryChart(d, findings) {
  const appName = applicationName(d) || "Application";
  const rows = REPORT_SEVERITIES.map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }));
  const max = Math.max(1, ...rows.map((row) => row.count));
  const chartWidth = 700;
  const chartHeight = 260;
  const barMaxWidth = 420;
  const svgRows = rows.map((row, index) => {
    const y = 78 + index * 38;
    const color = `#${SEVERITY_DOCX_COLORS[row.severity].fill}`;
    const barWidth = Math.max(8, Math.round(row.count / max * barMaxWidth));
    return `<text x="40" y="${y + 17}" font-family="Arial" font-size="16" fill="#111827">${row.severity}</text><rect x="145" y="${y}" width="${barWidth}" height="22" rx="3" fill="${color}"/><text x="${155 + barWidth}" y="${y + 17}" font-family="Arial" font-size="16" font-weight="700" fill="#111827">${row.count}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="40" y="42" font-family="Arial" font-size="20" font-weight="700" fill="#0F172A">${appName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>${svgRows}</svg>`;
  const fallback = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzE3WQAAAABJRU5ErkJggg==", "base64");
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    spacing: { before: 0, after: 180 },
    children: [
      new docx.ImageRun({
        type: "svg",
        data: Buffer.from(svg, "utf-8"),
        fallback: { type: "png", data: fallback },
        transformation: { width: 520, height: 193 },
        altText: { title: `Summary of Findings - ${appName}`, description: `Severity chart for ${appName}`, name: "Summary of Findings Chart" }
      })
    ]
  });
}
function severitySummaryTable(d, findings) {
  return new docx.Table({
    width: { size: DOCX_SUMMARY_TABLE_WIDTHS.reduce((total, columnWidth) => total + columnWidth, 0), type: docx.WidthType.DXA },
    alignment: docx.AlignmentType.CENTER,
    layout: docx.TableLayoutType.FIXED,
    columnWidths: DOCX_SUMMARY_TABLE_WIDTHS,
    borders: docxTableBorders(),
    rows: [
      new docx.TableRow({
        children: [
          headerCell("Severity", { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[0], type: docx.WidthType.DXA } }),
          headerCell("Number of Finding", { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[1], type: docx.WidthType.DXA } }),
          headerCell("Status Finding", { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[2], type: docx.WidthType.DXA } })
        ]
      }),
      ...REPORT_SEVERITIES.map((severity) => {
        const severityFindings = findings.filter((f) => f.severity === severity);
        return new docx.TableRow({
          children: [
            severityCell(severity, { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[0], type: docx.WidthType.DXA } }),
            centeredCell(severityFindings.length, false, { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[1], type: docx.WidthType.DXA } }),
            centeredCell(`Open: ${severityFindings.filter(isFindingOpen).length} / Closed: ${severityFindings.filter((f) => !isFindingOpen(f)).length}`, false, { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[2], type: docx.WidthType.DXA } })
          ]
        });
      })
    ]
  });
}
function metaLabelCell(text) {
  return new docx.TableCell({
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS[0], type: docx.WidthType.DXA },
    shading: { fill: "EEF2F7" },
    margins: { top: 130, bottom: 130, left: 140, right: 140 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [
      tableParagraph([new docx.TextRun({ text, bold: true, size: 24, color: "1F2937" })], docx.AlignmentType.LEFT)
    ]
  });
}
function metaValueCell(text) {
  return new docx.TableCell({
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS[1], type: docx.WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 160, right: 160 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [tableParagraph([new docx.TextRun({ text: detailValue(text), size: 24, color: "111827" })])]
  });
}
function metaValueWideCell(text) {
  return new docx.TableCell({
    columnSpan: 3,
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS.slice(1).reduce((total, columnWidth) => total + columnWidth, 0), type: docx.WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 160, right: 160 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [tableParagraph([new docx.TextRun({ text: detailValue(text), size: 24, color: "111827" })])]
  });
}
function findingSeverityHeaderCell(severity) {
  const color = severity === "Info" ? { fill: "6B7280", font: "FFFFFF" } : SEVERITY_DOCX_COLORS[severity];
  return new docx.TableCell({
    columnSpan: 4,
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS.reduce((total, columnWidth) => total + columnWidth, 0), type: docx.WidthType.DXA },
    shading: { fill: color.fill },
    margins: { top: 150, bottom: 150, left: 140, right: 140 },
    verticalAlign: docx.VerticalAlignTable.CENTER,
    children: [
      tableParagraph([new docx.TextRun({ text: severity, bold: true, color: color.font, size: 24 })], docx.AlignmentType.LEFT)
    ]
  });
}
function findingTechnicalTable(d, f) {
  const host = `${d.hostName(f.hostId)}${f.port ? ":" + f.port : ""}`;
  const classification = firstIdentifiedLabel(f) ? `Existing - First Identified: ${firstIdentifiedLabel(f)}` : f.classification;
  const slaDue = `${f.slaDueDate || ""}${isOverdue(f) ? " (OVERDUE)" : ""}`;
  const statusRow = shouldShowSlaDue(d) ? new docx.TableRow({ children: [metaLabelCell("Status"), metaValueCell(f.status), metaLabelCell("SLA due"), metaValueCell(slaDue)] }) : new docx.TableRow({ children: [metaLabelCell("Status"), metaValueWideCell(f.status)] });
  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    alignment: docx.AlignmentType.CENTER,
    layout: docx.TableLayoutType.FIXED,
    columnWidths: DOCX_TECHNICAL_TABLE_WIDTHS,
    borders: docxTableBorders(),
    rows: [
      new docx.TableRow({ children: [findingSeverityHeaderCell(f.severity)] }),
      new docx.TableRow({ children: [metaLabelCell("Host"), metaValueCell(host), metaLabelCell("Application"), metaValueCell(d.appName(f.applicationId))] }),
      new docx.TableRow({ children: [metaLabelCell("CVSS"), metaValueCell(f.cvss || ""), metaLabelCell("CVE"), metaValueCell(f.cve || "")] }),
      new docx.TableRow({ children: [metaLabelCell("Project Code"), metaValueCell(f.projectCode || d.projectCode || ""), metaLabelCell("Classification"), metaValueCell(classification)] }),
      statusRow
    ]
  });
}
function caption(text) {
  return new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text, italics: true, size: 24 })], spacing: { before: 100, after: 220 } });
}
function evidenceChildren(d, f) {
  const evidenceText = detailValue(f.evidence);
  const hasEvidence = displayValue(f.evidence).trim().length > 0;
  const children = [
    new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_3, children: [new docx.TextRun({ text: "Proof of Concept / Evidence", bold: true, size: 24 })], spacing: { before: 180, after: 80 } }),
    paragraph(evidenceText, { alignment: hasEvidence ? docx.AlignmentType.JUSTIFIED : docx.AlignmentType.LEFT })
  ];
  const attachments = f.attachments ?? [];
  const attachmentRows = [];
  for (const att of attachments) {
    const absolute = d.attachmentPath(att);
    const ext = path.extname(att.filename).toLowerCase().replace(".", "");
    attachmentRows.push([att.filename, `${Math.round(att.size / 1024)} KB`]);
    if (!["png", "jpg", "jpeg", "gif", "bmp"].includes(ext) || !fs.existsSync(absolute)) continue;
    try {
      children.push(
        new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          children: [
            new docx.ImageRun({
              type: ext === "jpeg" ? "jpg" : ext,
              data: fs.readFileSync(absolute),
              transformation: { width: 500, height: 300 },
              altText: { title: att.filename, description: att.filename, name: att.filename }
            })
          ],
          spacing: { before: 120, after: 80 }
        })
      );
      children.push(caption(`Figure: ${att.filename}`));
    } catch {
    }
  }
  if (attachmentRows.length > 0) {
    children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_3, text: "Evidence Attachments" }));
    children.push(kvTable(attachmentRows, 76));
  }
  return children;
}
function referenceStandardDetails(d) {
  const common = [
    ["CVSS", "Used to support severity scoring and remediation prioritisation based on exploitability, impact, attack complexity, privileges required, user interaction, scope, and confidentiality/integrity/availability impact."],
    ["CWE / CVE", "Used where available to map findings to known weakness classes and publicly disclosed vulnerabilities, improving traceability and remediation clarity."],
    ["Internal Security Policy / Remediation SLA", "Used to align findings with organisational risk appetite, ownership, remediation target dates, and closure expectations."]
  ];
  switch (reportAssessmentKind(d)) {
    case "web":
      return [
        ["OWASP Top 10:2025", "Used as the primary application security risk reference for web application weaknesses such as access control, configuration, supply chain, cryptography, injection, design, authentication, integrity, logging, and exception-handling risks."],
        ["OWASP ASVS", "Used as a verification reference for web application security controls, including authentication, session management, access control, validation, cryptography, error handling, logging, API controls, and secure configuration where applicable."],
        ...common
      ];
    case "api":
      return [
        ["OWASP API Security Top 10 2023", "Used as the primary API security risk reference for object-level authorisation, authentication, object property authorisation, resource consumption, function-level authorisation, sensitive business flows, SSRF, misconfiguration, inventory management, and unsafe API consumption."],
        ["OWASP ASVS / API Controls", "Used to guide API security control validation for authentication, authorisation, input validation, data protection, error handling, logging, and secure configuration where applicable."],
        ...common
      ];
    case "mobile":
      return [
        ["OWASP Mobile Top 10 2024", "Used as the primary mobile risk reference for credential usage, supply chain security, authentication/authorisation, input/output validation, communication, privacy controls, binary protection, configuration, data storage, and cryptography."],
        ["OWASP MASVS", "Used as a mobile application security verification reference covering storage, cryptography, authentication, network communication, platform interaction, code quality, resilience, privacy, and supporting controls where applicable."],
        ...common
      ];
    case "source-code":
      return [
        ["OWASP ASVS / Secure Code Review", "Used to guide secure implementation review across architecture, authentication, session management, access control, validation, cryptography, error handling, logging, API controls, and configuration."],
        ["CWE Top 25", "Used to support mapping of implementation weaknesses to common and impactful software weakness classes."],
        ...common
      ];
    case "internal":
    case "external":
    case "internal-external":
    case "host":
      return [
        ["CIS Controls / CIS Benchmarks", "Used where applicable as a secure configuration and hardening reference for enterprise assets, software, services, and host-level controls."],
        ["Vulnerability Assessment References", "Used to guide validation of patch status, vulnerable services, insecure protocols, unnecessary exposure, weak configuration, and remediation prioritisation across in-scope assets."],
        ...common
      ];
    default:
      return [
        ["General Security Assessment References", "Used when a specific application, API, mobile, source-code, infrastructure, or host risk category is not available. The report applies vulnerability validation, secure configuration, CVE/CWE mapping, CVSS scoring, and risk-based remediation guidance where applicable."],
        ...common
      ];
  }
}
async function writeDocx(d, outputPath) {
  const docFindings = reportFindings(d);
  const purposeText = purposeOfTesting(d);
  const referenceDetails = referenceStandardDetails(d);
  const findingBlocks = docFindings.flatMap((f, index) => [
    heading2(`3.${index + 1} ${f.title}`, `toc_finding_${index + 1}`),
    findingTechnicalTable(d, f),
    ...detailSection("Description", f.description),
    ...detailSection("Affected URL", f.affectedAsset || f.endpoint),
    ...detailSection("Affected Parameter", f.parameter),
    ...evidenceChildren(d, f),
    ...detailSection("Recommendation", f.recommendation)
  ]);
  const logoParagraph = coverLogo();
  const doc = new docx.Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { size: 24 },
          paragraph: { spacing: { after: 120 } }
        },
        heading1: {
          run: { bold: true, size: 36 },
          paragraph: { spacing: { before: 340, after: 200 } }
        },
        heading2: {
          run: { bold: true, size: 28 },
          paragraph: { spacing: { before: 260, after: 160 } }
        }
      },
      paragraphStyles: [
        { id: "TOC1", name: "TOC 1", basedOn: "Normal", run: { bold: true, size: 24 }, paragraph: { spacing: { after: 80 } } },
        { id: "TOC2", name: "TOC 2", basedOn: "Normal", run: { size: 24 }, paragraph: { indent: { left: 360 }, spacing: { after: 60 } } },
        { id: "TOC3", name: "TOC 3", basedOn: "Normal", run: { size: 24 }, paragraph: { indent: { left: 720 }, spacing: { after: 60 } } }
      ]
    },
    numbering: {
      config: [
        {
          reference: "owasp-roman",
          levels: [
            {
              level: 0,
              format: docx.LevelFormat.LOWER_ROMAN,
              text: "%1.",
              alignment: docx.AlignmentType.RIGHT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 }, spacing: { after: 70 } },
                run: { size: 24 }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: { page: { margin: { top: 1e3, right: 900, bottom: 900, left: 900 } }, titlePage: true },
        footers: {
          first: new docx.Footer({
            children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: "Prepared by: Threat Vulnerability Management, GISGD", bold: true, size: 24 })] })]
          }),
          default: new docx.Footer({
            children: [new docx.Paragraph({ alignment: docx.AlignmentType.RIGHT, children: [new docx.TextRun({ text: "Page ", size: 24 }), new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 24 })] })]
          })
        },
        children: [
          new docx.Paragraph({ spacing: { before: 760 } }),
          ...logoParagraph ? [logoParagraph] : [],
          coverTextParagraph(reportTitle(d), 48, true),
          blankLine(),
          ...coverSubjectParagraphs(d),
          blankLine(),
          coverTextParagraph(reportDate(d), 32),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          heading1("Document Control", "toc_document_control"),
          blankLine(),
          kvTable([
            ["Document Title", reportTitle(d)],
            ["Project Code", d.projectCode],
            ["Application / System", d.application?.name || d.request?.systemName || ""],
            ["Owner Name", d.application?.owner || ""],
            ["Business Unit / Department", d.application?.businessUnit || d.request?.department || ""],
            ["Requested By", d.request?.requestedBy || ""],
            ["Tester", d.assessment?.tester || ""],
            ["Assessment Type", assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? ""))],
            ["Assessment Window", [d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(" to ")],
            ["Report Date", reportDate(d)]
          ], 86, docx.AlignmentType.CENTER),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          tocTitle("Table of Contents"),
          tocField(docFindings),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          heading1("1 Executive Summary", "toc_executive_summary"),
          subsection("1.1 Introduction", "toc_executive_introduction"),
          executiveIntroductionParagraph(d, docFindings),
          blankLine(),
          subsection("1.2 Background Information", "toc_background_information"),
          paragraph(backgroundInformation(d)),
          paragraph(referenceRiskIntro(d)),
          ...referenceRiskParagraphs(d),
          blankLine(),
          subsection("1.3 Reference Standards", "toc_reference_standards"),
          kvTable(referenceDetails, 100),
          blankLine(),
          subsection("1.4 Purpose of Testing", "toc_purpose_of_testing"),
          paragraph(purposeText),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          heading1("2 Summary of Technical Findings", "toc_summary_technical_findings"),
          subsection("2.1 Introduction", "toc_summary_introduction"),
          paragraph("Testing activities include review of in-scope assets, vulnerability identification, validation of exploitable conditions, evidence capture, severity assessment, and remediation guidance. Findings are prioritised using technical severity, affected asset criticality, exploitability, and business impact."),
          blankLine(),
          subsection("2.2 Project Scope", "toc_project_scope"),
          projectScopeTable([
            ["In-Scope Application / System", d.application?.name || d.request?.systemName || ""],
            ["Environment", d.request?.environment || ""],
            ["Scope Description", d.request?.scope || ""],
            ["Hosts / Assets", d.hosts.map((h) => h.hostname || h.ip).filter(Boolean).join(", ")]
          ]),
          blankLine(),
          subsection("2.3 Summary of Findings", "toc_summary_findings"),
          summaryChart(d, docFindings),
          caption(`Figure 1: Findings Summary - ${applicationName(d) || "Application"}`),
          blankLine(),
          severitySummaryTable(d, docFindings),
          caption("Table 1: Summary of Findings by Severity"),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          heading1("3 Detailed Technical Findings", "toc_detailed_technical_findings"),
          paragraph(docFindings.length > 0 ? "This section provides detailed information about the security weaknesses identified during the exercise, including descriptions of findings, relevant observations or proof of concept, and recommendations to mitigate each issue." : "This section provides detailed information about the security weaknesses identified during the exercise. No findings were recorded for this report scope."),
          ...findingBlocks.length > 0 ? findingBlocks : [paragraph("No findings were recorded for this report scope.")]
        ]
      }
    ]
  });
  fs.writeFileSync(outputPath, await docx.Packer.toBuffer(doc));
}
const SEV_COLORS = {
  Critical: "#dc2626",
  High: "#d97706",
  Medium: "#facc15",
  Low: "#16a34a",
  Info: "#6b7280"
};
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlText(value) {
  return esc(displayValue(value));
}
function htmlDetail(value) {
  return esc(detailValue(value)).replace(/\r?\n/g, "<br>");
}
function pdfLogoDataUri() {
  const candidates = [
    path.join(process.cwd(), "image", "bankislam-logo.png"),
    path.join(__dirname, "..", "..", "image", "bankislam-logo.png")
  ];
  const logoPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!logoPath) return "";
  return `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
}
function pdfDocumentControlRows(d) {
  return [
    ["Document Title", reportTitle(d)],
    ["Project Code", d.projectCode],
    ["Application / System", d.application?.name || d.request?.systemName || ""],
    ["Owner Name", d.application?.owner || ""],
    ["Business Unit / Department", d.application?.businessUnit || d.request?.department || ""],
    ["Requested By", d.request?.requestedBy || ""],
    ["Tester", d.assessment?.tester || ""],
    ["Assessment Type", assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? ""))],
    ["Assessment Window", [d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(" to ")],
    ["Report Date", reportDate(d)]
  ];
}
function pdfProjectScopeRows(d) {
  return [
    ["In-Scope Application / System", d.application?.name || d.request?.systemName || ""],
    ["Environment", d.request?.environment || ""],
    ["Scope Description", d.request?.scope || ""],
    ["Hosts / Assets", d.hosts.map((h) => h.hostname || h.ip).filter(Boolean).join(", ")]
  ];
}
function pdfKvTable(rows, className = "kv-table") {
  return `<table class="${className}"><tbody>${rows.map(([label, value]) => `<tr><th>${htmlText(label)}</th><td>${htmlText(displayValue(value) || "-")}</td></tr>`).join("")}</tbody></table>`;
}
function pdfExecutiveIntroduction(d, findings) {
  const open = findings.filter(isFindingOpen).length;
  const assessment = d.assessment || d.request;
  const suffix = `${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issue(s) were identified, and ${open} finding(s) remain open. The report presents the agreed testing scope, validated security weaknesses, risk context, and practical recommendations to support remediation and management decision-making.`;
  if (!assessment) return `This report covers ${findings.length} finding(s) across the assessed portfolio. ${suffix}`;
  return `This report covers ${findings.length} finding(s) from assessment "<strong>${htmlText(assessmentDisplayName(d))}</strong>". ${htmlText(suffix)}`;
}
function pdfReferenceCategories(d) {
  return `<ol class="roman-list">${referenceRiskCategories(d).map((item) => `<li>${htmlText(item)}</li>`).join("")}</ol>`;
}
function pdfReferenceStandards(d) {
  return `<table class="reference-table"><tbody>${referenceStandardDetails(d).map(([standard, detail]) => `<tr><th>${htmlText(standard)}</th><td>${htmlText(detail)}</td></tr>`).join("")}</tbody></table>`;
}
function pdfSummaryChart(d, findings) {
  const rows = REPORT_SEVERITIES.map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }));
  const max = Math.max(1, ...rows.map((row) => row.count));
  return `<div class="chart" aria-label="Findings summary chart">
    <div class="chart-title">${htmlText(applicationName(d) || "Application")}</div>
    ${rows.map((row) => {
    const width = Math.max(4, Math.round(row.count / max * 100));
    return `<div class="bar-row"><div class="bar-label">${row.severity}</div><div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${SEV_COLORS[row.severity]}"></div></div><div class="bar-value">${row.count}</div></div>`;
  }).join("")}
  </div>`;
}
function pdfSeveritySummaryTable(findings) {
  return `<table class="summary-table"><thead><tr><th>Severity</th><th>Number of Finding</th><th>Status Finding</th></tr></thead><tbody>${REPORT_SEVERITIES.map((severity) => {
    const severityFindings = findings.filter((f) => f.severity === severity);
    const open = severityFindings.filter(isFindingOpen).length;
    const closed = severityFindings.filter((f) => !isFindingOpen(f)).length;
    const color = SEV_COLORS[severity];
    const textColor = severity === "Medium" ? "#111827" : "#ffffff";
    return `<tr><td class="severity-cell" style="background:${color};color:${textColor}">${severity}</td><td class="center-cell">${severityFindings.length}</td><td class="center-cell">Open: ${open} / Closed: ${closed}</td></tr>`;
  }).join("")}</tbody></table>`;
}
function pdfFindingMetaTable(d, f) {
  const host = `${d.hostName(f.hostId)}${f.port ? ":" + f.port : ""}`;
  const classification = firstIdentifiedLabel(f) ? `Existing - First Identified: ${firstIdentifiedLabel(f)}` : f.classification;
  const slaDue = `${f.slaDueDate || ""}${isOverdue(f) ? " (OVERDUE)" : ""}`;
  const statusRow = shouldShowSlaDue(d) ? `<tr><th>Status</th><td>${htmlDetail(f.status)}</td><th>SLA due</th><td>${htmlDetail(slaDue)}</td></tr>` : `<tr><th>Status</th><td colspan="3">${htmlDetail(f.status)}</td></tr>`;
  return `<table class="technical-table"><tbody>
    <tr><th colspan="4" class="technical-severity" style="background:${SEV_COLORS[f.severity]};color:${f.severity === "Medium" ? "#111827" : "#ffffff"}">${htmlText(f.severity)}</th></tr>
    <tr><th>Host</th><td>${htmlDetail(host)}</td><th>Application</th><td>${htmlDetail(d.appName(f.applicationId))}</td></tr>
    <tr><th>CVSS</th><td>${htmlDetail(f.cvss || "")}</td><th>CVE</th><td>${htmlDetail(f.cve || "")}</td></tr>
    <tr><th>Project Code</th><td>${htmlDetail(f.projectCode || d.projectCode || "")}</td><th>Classification</th><td>${htmlDetail(classification)}</td></tr>
    ${statusRow}
  </tbody></table>`;
}
function pdfAttachmentDataUri(d, att) {
  const absolute = d.attachmentPath(att);
  const ext = path.extname(att.filename).toLowerCase().replace(".", "");
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : ext === "png" ? "image/png" : "";
  if (!mime || !fs.existsSync(absolute)) return "";
  try {
    return `data:${mime};base64,${fs.readFileSync(absolute).toString("base64")}`;
  } catch {
    return "";
  }
}
function pdfEvidenceHtml(d, f) {
  const attachments = f.attachments ?? [];
  const images = attachments.map((att) => ({ att, uri: pdfAttachmentDataUri(d, att) })).filter((item) => item.uri).map((item) => `<figure class="evidence-image"><img src="${item.uri}" alt="${htmlText(item.att.filename)}"><figcaption>${htmlText(item.att.filename)}</figcaption></figure>`).join("");
  const attachmentTable = attachments.length ? `<table class="attachment-table"><thead><tr><th>Attachment</th><th>Size</th></tr></thead><tbody>${attachments.map((att) => `<tr><td>${htmlText(att.filename)}</td><td>${Math.round(att.size / 1024)} KB</td></tr>`).join("")}</tbody></table>` : "";
  return `<div class="detail-block"><h4>Proof of Concept / Evidence:</h4><p>${htmlDetail(f.evidence)}</p>${images}${attachmentTable}</div>`;
}
function pdfFindingDetails(d, f, index) {
  return `<section class="finding-section">
    <h2 id="pdf_finding_${index + 1}">3.${index + 1} ${htmlText(f.title)}</h2>
    ${pdfFindingMetaTable(d, f)}
    <div class="detail-block"><h4>Description:</h4><p>${htmlDetail(f.description)}</p></div>
    <div class="detail-block"><h4>Affected URL:</h4><p>${htmlDetail(f.affectedAsset || f.endpoint)}</p></div>
    <div class="detail-block"><h4>Affected Parameter:</h4><p>${htmlDetail(f.parameter)}</p></div>
    ${pdfEvidenceHtml(d, f)}
    <div class="detail-block"><h4>Recommendation:</h4><p>${htmlDetail(f.recommendation)}</p></div>
  </section>`;
}
function businessValue(value) {
  const text = displayValue(value).trim();
  return text || "no info";
}
function highestSeverity(findings) {
  const openFindings = findings.filter(isFindingOpen);
  const source = openFindings.length > 0 ? openFindings : findings;
  for (const severity of REPORT_SEVERITIES) {
    if (source.some((finding) => finding.severity === severity)) return severity;
  }
  return "Satisfactory";
}
function overallRisk(d, findings) {
  const rating = highestSeverity(findings);
  const open = findings.filter(isFindingOpen);
  if (rating === "Satisfactory") return { rating, reason: "No reportable security findings were recorded for the assessed scope." };
  const count = open.filter((finding) => finding.severity === rating).length || findings.filter((finding) => finding.severity === rating).length;
  const statusText = open.length > 0 ? `${open.length} finding(s) remain open` : "all recorded findings are remediated or closed";
  return { rating, reason: `${count} ${rating.toLowerCase()} severity finding(s) drive the rating, and ${statusText}.` };
}
function businessImpactText(f) {
  switch (f.severity) {
    case "Critical":
      return "This issue could create a material business impact, including unauthorised access, data exposure, service disruption, or compromise of critical functions.";
    case "High":
      return "This issue could expose sensitive data, weaken key controls, or allow a meaningful security compromise if exploited.";
    case "Medium":
      return "This issue may increase security risk and could support further attack steps when combined with other weaknesses.";
    case "Low":
      return "This issue has limited direct business impact but should be corrected to improve control maturity and reduce avoidable exposure.";
    default:
      return "This item is informational and should be reviewed for awareness or improvement planning.";
  }
}
function executiveRecommendation(d, findings) {
  const rating = overallRisk(d, findings).rating;
  const openCritical = findings.some((finding) => finding.severity === "Critical" && isFindingOpen(finding));
  const openHigh = findings.some((finding) => finding.severity === "High" && isFindingOpen(finding));
  if (openCritical) return "Not recommended for production until critical findings are remediated, retested, and formally accepted by the responsible risk owner.";
  if (openHigh) return "Can proceed only after high-priority remediation is completed or formally risk accepted, followed by targeted retesting.";
  if (findings.some(isFindingOpen)) return "Can proceed after planned remediation of remaining findings, with risk owner agreement on any accepted residual risk.";
  if (rating === "Satisfactory") return "Can proceed to production from a security assessment perspective, subject to normal operational approvals.";
  return "Can proceed after remediation has been confirmed and any remaining residual risk has been accepted.";
}
function executiveOverviewRows(d) {
  return [
    ["Application / System", businessValue(applicationName(d) || d.request?.systemName)],
    ["Assessment Type", businessValue(assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? "")))],
    ["Testing Period", businessValue([d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(" to "))],
    ["Environment", businessValue(d.request?.environment)],
    ["Scope", businessValue(d.request?.scope)],
    ["Limitations", "no info"]
  ];
}
function executiveFindingsSummaryTable(findings) {
  return `<table class="summary-table executive-summary-table"><thead><tr><th>Severity</th><th>Total</th><th>Open</th><th>Remediated</th></tr></thead><tbody>${REPORT_SEVERITIES.map((severity) => {
    const severityFindings = findings.filter((finding) => finding.severity === severity);
    const open = severityFindings.filter(isFindingOpen).length;
    const remediated = severityFindings.length - open;
    const color = SEV_COLORS[severity];
    const textColor = severity === "Medium" ? "#111827" : "#ffffff";
    return `<tr><td class="severity-cell" style="background:${color};color:${textColor}">${severity}</td><td class="center-cell">${severityFindings.length}</td><td class="center-cell">${open}</td><td class="center-cell">${remediated}</td></tr>`;
  }).join("")}</tbody></table>`;
}
function executiveKeyRisks(d, findings) {
  const keyFindings = [...findings].sort((a, b) => {
    const openDelta = Number(isFindingOpen(b)) - Number(isFindingOpen(a));
    return openDelta || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
  }).slice(0, 5);
  if (keyFindings.length === 0) return "<p>No key business risks were identified from the available findings.</p>";
  return keyFindings.map((finding, index) => `<div class="key-risk"><h2 id="pdf_key_risk_${index + 1}" class="key-risk-heading">5.${index + 1} ${htmlText(finding.title)}</h2><table class="kv-table"><tbody>
      <tr><th>Issue</th><td>${htmlDetail(finding.description || finding.title)}</td></tr>
      <tr><th>Business Impact</th><td>${htmlText(businessImpactText(finding))}</td></tr>
      <tr><th>Current Status</th><td>${htmlText(finding.status || "no info")}</td></tr>
      <tr><th>Action Required</th><td>${htmlDetail(finding.recommendation || "Remediate the issue, validate the fix, and update the finding status.")}</td></tr>
    </tbody></table></div>`).join("");
}
function executiveRemediationPriority(d, findings) {
  const open = findings.filter(isFindingOpen);
  if (open.length === 0) return "No open remediation actions are recorded. The application or system owner should maintain normal security monitoring and evidence retention.";
  const firstSeverity = highestSeverity(open);
  const owner = businessValue(d.application?.owner || d.application?.businessUnit || d.request?.department);
  const firstTarget = open.filter((finding) => firstSeverity === "Satisfactory" || finding.severity === firstSeverity).map((finding) => finding.slaDueDate).filter(Boolean).sort()[0];
  return `Fix ${String(firstSeverity).toLowerCase()} severity open findings first, followed by high, medium, and low items. The responsible owner is ${owner}. Expected completion target is ${firstTarget || "to be confirmed"}.`;
}
function executiveRetestStatus(findings) {
  const retestFindings = findings.filter((finding) => finding.classification === "Retest");
  const open = findings.filter(isFindingOpen);
  if (retestFindings.length === 0) return `No retest result is recorded in the available report data. ${open.length} finding(s) remain open.`;
  return `${retestFindings.length} finding(s) are marked for retest. ${open.length} finding(s) remain open and require closure evidence or formal risk acceptance.`;
}
function executiveScopeLimitations(d) {
  const included = businessValue(d.request?.scope || d.hosts.map((host) => host.hostname || host.ip).filter(Boolean).join(", "));
  const unavailable = "no info";
  return `Included scope: ${included}. Excluded, unavailable, or not-tested items: ${unavailable}.`;
}
function executiveReportBody(d, findings) {
  const risk = overallRisk(d, findings);
  const open = findings.filter(isFindingOpen).length;
  return `<section class="executive-report">
      <h1 id="pdf_executive_summary">1 Executive Summary</h1>
      <p>This executive report summarises the security assessment for ${htmlText(businessValue(applicationName(d)))}. Testing covered the agreed scope and recorded ${findings.length} reportable finding(s), with ${open} currently open. The overall result is ${risk.rating}. Action is ${open > 0 ? "required to address the remaining findings and reduce business risk." : "not currently required beyond normal monitoring and governance."}</p>
      <p>The main risk is driven by ${htmlText(risk.reason)} Management should ensure that remediation owners, target dates, and retest evidence are tracked until closure.</p>

      <h1 id="pdf_assessment_overview">2 Assessment Overview</h1>
      ${pdfKvTable(executiveOverviewRows(d), "scope-table")}

      <h1 id="pdf_overall_risk_rating">3 Overall Risk Rating</h1>
      <table class="risk-rating-table"><tbody><tr><th>Overall Rating</th><td class="risk-rating risk-${risk.rating.toLowerCase()}">${risk.rating}</td></tr><tr><th>Reason</th><td>${htmlText(risk.reason)}</td></tr></tbody></table>

      <h1 id="pdf_findings_summary">4 Findings Summary</h1>
      ${executiveFindingsSummaryTable(findings)}
      ${pdfSummaryChart(d, findings)}
      <p class="caption">Figure 1: Findings Summary - ${htmlText(applicationName(d) || "Application")}</p>

      <h1 id="pdf_key_risks">5 Key Risks</h1>
      ${executiveKeyRisks(d, findings)}

      <h1 id="pdf_remediation_priority">6 Remediation Priority</h1>
      <p>${htmlText(executiveRemediationPriority(d, findings))}</p>

      <h1 id="pdf_retest_status">7 Retest Status</h1>
      <p>${htmlText(executiveRetestStatus(findings))}</p>

      <h1 id="pdf_conclusion">8 Conclusion</h1>
      <p>${htmlText(executiveRecommendation(d, findings))}</p>

      <h1 id="pdf_scope_limitations">9 Scope and Limitations</h1>
      <p>${htmlText(executiveScopeLimitations(d))}</p>
    </section>`;
}
function pdfTocRows(variant, findings) {
  if (variant === "executive") {
    return [
      { title: "Document Control", page: "2", level: 1, href: "pdf_document_control" },
      { title: "1 Executive Summary", page: "4", level: 1, href: "pdf_executive_summary" },
      { title: "2 Assessment Overview", page: "4", level: 1, href: "pdf_assessment_overview" },
      { title: "3 Overall Risk Rating", page: "4", level: 1, href: "pdf_overall_risk_rating" },
      { title: "4 Findings Summary", page: "4", level: 1, href: "pdf_findings_summary" },
      { title: "5 Key Risks", page: "5", level: 1, href: "pdf_key_risks" },
      ...findings.slice(0, 5).map((finding, index) => ({ title: `5.${index + 1} ${finding.title}`, page: "5", level: 2, href: `pdf_key_risk_${index + 1}` })),
      { title: "6 Remediation Priority", page: "5", level: 1, href: "pdf_remediation_priority" },
      { title: "7 Retest Status", page: "5", level: 1, href: "pdf_retest_status" },
      { title: "8 Conclusion", page: "5", level: 1, href: "pdf_conclusion" },
      { title: "9 Scope and Limitations", page: "5", level: 1, href: "pdf_scope_limitations" }
    ];
  }
  const rows = [
    { title: "Document Control", page: "2", level: 1, href: "pdf_document_control" },
    { title: "1 Executive Summary", page: "4", level: 1, href: "pdf_executive_summary" },
    { title: "1.1 Introduction", page: "4", level: 2, href: "pdf_executive_introduction" },
    { title: "1.2 Background Information", page: "4", level: 2, href: "pdf_background_information" },
    { title: "1.3 Reference Standards", page: "4", level: 2, href: "pdf_reference_standards" },
    { title: "1.4 Purpose of Testing", page: "4", level: 2, href: "pdf_purpose_of_testing" },
    { title: "2 Summary of Technical Findings", page: "5", level: 1, href: "pdf_summary_technical_findings" },
    { title: "2.1 Introduction", page: "5", level: 2, href: "pdf_summary_introduction" },
    { title: "2.2 Project Scope", page: "5", level: 2, href: "pdf_project_scope" },
    { title: "2.3 Summary of Findings", page: "5", level: 2, href: "pdf_summary_findings" },
    { title: "3 Detailed Technical Findings", page: "6", level: 1, href: "pdf_detailed_technical_findings" },
    ...findings.map((finding, index) => ({ title: `3.${index + 1} ${finding.title}`, page: "6", level: 2, href: `pdf_finding_${index + 1}` }))
  ];
  return rows;
}
function pdfTableOfContents(variant, findings) {
  return `<section class="page toc-page"><h1 class="toc-title">Table of Contents</h1><table class="toc-table"><tbody>${pdfTocRows(variant, findings).map((entry) => `<tr class="toc-level-${entry.level}"><td><a href="#${entry.href}">${htmlText(entry.title)}</a></td><td><a href="#${entry.href}">${entry.page}</a></td></tr>`).join("")}</tbody></table></section>`;
}
function reportHtml(d, variant) {
  const findings = reportFindings(d);
  const logo = pdfLogoDataUri();
  const coverLines = d.projectCode ? [d.projectCode, applicationName(d)].filter(Boolean) : [applicationName(d) || detailValue("")];
  const findingDetails = findings.map((finding, index) => pdfFindingDetails(d, finding, index)).join("");
  const technicalSection = variant === "full" ? `<section class="page technical-start"><h1 id="pdf_detailed_technical_findings">3 Detailed Technical Findings</h1><p>${findings.length > 0 ? "This section provides detailed information about the security weaknesses identified during the exercise, including descriptions of findings, relevant observations or proof of concept, and recommendations to mitigate each issue." : "This section provides detailed information about the security weaknesses identified during the exercise. No findings were recorded for this report scope."}</p>${findingDetails || "<p>No findings were recorded for this report scope.</p>"}</section>` : "";
  const fullReportBody = `<section>
      <h1 id="pdf_executive_summary">1 Executive Summary</h1>
      <h2 id="pdf_executive_introduction">1.1 Introduction</h2>
      <p>${pdfExecutiveIntroduction(d, findings)}</p>
      <div class="section-gap"></div>
      <h2 id="pdf_background_information">1.2 Background Information</h2>
      <p>${htmlText(backgroundInformation(d))}</p>
      <p>${htmlText(referenceRiskIntro(d))}</p>
      ${pdfReferenceCategories(d)}
      <div class="section-gap"></div>
      <h2 id="pdf_reference_standards">1.3 Reference Standards</h2>
      ${pdfReferenceStandards(d)}
      <div class="section-gap"></div>
      <h2 id="pdf_purpose_of_testing">1.4 Purpose of Testing</h2>
      <p>${htmlText(purposeOfTesting(d))}</p>
    </section>

    <section class="summary-start">
      <h1 id="pdf_summary_technical_findings">2 Summary of Technical Findings</h1>
      <h2 id="pdf_summary_introduction">2.1 Introduction</h2>
      <p>Testing activities include review of in-scope assets, vulnerability identification, validation of exploitable conditions, evidence capture, severity assessment, and remediation guidance. Findings are prioritised using technical severity, affected asset criticality, exploitability, and business impact.</p>
      <div class="section-gap"></div>
      <h2 id="pdf_project_scope">2.2 Project Scope</h2>
      ${pdfKvTable(pdfProjectScopeRows(d), "scope-table")}
      <div class="section-gap"></div>
      <h2 id="pdf_summary_findings">2.3 Summary of Findings</h2>
      ${pdfSummaryChart(d, findings)}
      <p class="caption">Figure 1: Findings Summary - ${htmlText(applicationName(d) || "Application")}</p>
      ${pdfSeveritySummaryTable(findings)}
      <p class="caption">Table 1: Summary of Findings by Severity</p>
    </section>`;
  const reportBody = variant === "executive" ? executiveReportBody(d, findings) : fullReportBody;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:22mm 18mm 18mm 18mm;@bottom-right{content:'Page ' counter(page);font-family:Arial,sans-serif;font-size:9pt;color:#4b5563}}
    *{box-sizing:border-box} body{font-family:Arial,'Segoe UI',sans-serif;color:#111827;margin:0;font-size:12pt;line-height:1.42;background:#fff} p{margin:0 0 10px;text-align:justify} h1{font-size:18pt;line-height:1.25;margin:0 0 14px;font-weight:700;color:#0f172a;page-break-after:avoid} h2{font-size:14pt;line-height:1.28;margin:22px 0 10px;font-weight:700;color:#0f172a;page-break-after:avoid} h4{font-size:12pt;margin:0 0 6px;font-weight:700;color:#111827}.page{page-break-after:always}.page:last-child{page-break-after:auto}.cover{min-height:250mm;display:flex;flex-direction:column;text-align:center;page-break-after:always}.cover-main{margin-top:20mm}.logo{width:18cm;max-width:100%;height:auto;margin:0 auto 18px;display:block}.cover-title{font-size:24pt;font-weight:700;line-height:1.5;margin:0 0 30px}.cover-subject{font-size:22pt;font-weight:700;line-height:1.5;margin:0 0 6px}.cover-date{font-size:16pt;line-height:1.5;margin-top:12px}.prepared{margin-top:auto;text-align:center;font-weight:700}.doc-control{width:86%;margin:12px auto 0}.kv-table,.reference-table,.scope-table,.summary-table,.technical-table,.attachment-table{border-collapse:collapse;margin:8px auto 14px;color:#111827}.kv-table th,.kv-table td,.reference-table th,.reference-table td,.scope-table th,.scope-table td,.summary-table th,.summary-table td,.technical-table th,.technical-table td,.attachment-table th,.attachment-table td{border:1px solid #c9d3df;padding:7px 9px;vertical-align:top;word-break:break-word}.kv-table th,.reference-table th,.scope-table th,.technical-table th{background:#eef2f7;color:#1f2937;text-align:left;font-weight:700}.kv-table td,.reference-table td,.scope-table td,.technical-table td{text-align:left}.reference-table,.scope-table{width:86%}.reference-table th{width:28%}.scope-table th{width:34%}.summary-table{width:74%;table-layout:fixed}.summary-table th{background:#1f4e78;color:#fff;text-align:center;font-weight:700}.summary-table td{text-align:left}.summary-table th:nth-child(2),.summary-table th:nth-child(3),.summary-table td:nth-child(2),.summary-table td:nth-child(3){width:4.5cm}.center-cell{text-align:center!important}.severity-cell{text-align:center!important;font-weight:700}.technical-table{width:100%;table-layout:fixed}.technical-table th{width:17%}.technical-table td{width:33%}.technical-severity{text-align:left!important;font-weight:700}.toc-title{font-size:20pt}.toc-table{width:100%;border-collapse:collapse;margin-top:12px}.toc-table td{border:0;padding:5px 0;font-size:12pt}.toc-table td:last-child{text-align:right;width:1.5cm}.toc-table a{color:#111827;text-decoration:none}.toc-level-1 td{font-weight:700;padding-top:9px}.toc-level-2 td:first-child{padding-left:18px;color:#374151}.roman-list{list-style-type:lower-roman;padding-left:32px;margin:8px 0 16px}.roman-list li{margin:0 0 5px;text-align:justify}.chart{width:74%;margin:0 auto 8px;border:1px solid #c9d3df;padding:14px 18px;background:#fff}.chart-title{text-align:center;font-weight:700;margin-bottom:12px}.bar-row{display:grid;grid-template-columns:90px 1fr 40px;gap:10px;align-items:center;margin:9px 0}.bar-label{font-weight:700}.bar-track{height:18px;background:#eef2f7;border-radius:3px;overflow:hidden}.bar-fill{height:18px}.bar-value{text-align:right;font-weight:700}.caption{text-align:center!important;font-style:italic;margin:4px 0 16px;color:#374151}.summary-start{page-break-before:always}.technical-start{page-break-before:always}.finding-section{margin-top:18px;page-break-inside:auto}.detail-block{margin:13px 0}.detail-block p{text-align:justify;white-space:normal}.evidence-image{margin:10px auto 12px;text-align:center;page-break-inside:avoid}.evidence-image img{max-width:100%;max-height:130mm;border:1px solid #c9d3df}.evidence-image figcaption{font-style:italic;color:#374151;margin-top:4px}.attachment-table{width:76%}.attachment-table th{background:#1f4e78;color:#fff;text-align:center}.muted{color:#6b7280}.section-gap{height:10px}.executive-report h1{margin-top:30px}.executive-report h1:first-child{margin-top:0}.key-risk{page-break-inside:avoid;margin:12px 0 18px}.key-risk-heading{font-size:14pt!important;margin:20px 0 8px!important;color:#0f172a}.risk-rating-table{width:74%;border-collapse:collapse;margin:8px auto 14px}.risk-rating-table th,.risk-rating-table td{border:1px solid #c9d3df;padding:8px 10px}.risk-rating-table th{width:34%;background:#eef2f7;text-align:left}.risk-rating{font-weight:700;text-align:center}.risk-critical{background:#dc2626;color:#fff}.risk-high{background:#d97706;color:#fff}.risk-medium{background:#facc15;color:#111827}.risk-low{background:#16a34a;color:#fff}.risk-satisfactory{background:#0f766e;color:#fff}.executive-summary-table th:nth-child(2),.executive-summary-table th:nth-child(3),.executive-summary-table td:nth-child(2),.executive-summary-table td:nth-child(3){width:auto}
  </style></head><body>
    <section class="cover">
      <div class="cover-main">
        ${logo ? `<img class="logo" src="${logo}" alt="Bank Islam Logo">` : ""}
        <div class="cover-title">${htmlText(variant === "executive" ? executiveReportTitle(d) : reportTitle(d))}</div>
        ${coverLines.map((line) => `<div class="cover-subject">${htmlText(line)}</div>`).join("")}
        <div class="cover-date">${htmlText(reportDate(d))}</div>
      </div>
      <div class="prepared">Prepared by: Threat Vulnerability Management, GISGD</div>
    </section>

    <section class="page" id="pdf_document_control">
      <h1>Document Control</h1>
      <div class="section-gap"></div>
      <div class="doc-control">${pdfKvTable(pdfDocumentControlRows(d))}</div>
    </section>

    ${pdfTableOfContents(variant, findings)}

    ${reportBody}

    ${technicalSection}
  </body></html>`;
}
async function writePdf(d, outputPath, variant) {
  const win = new electron.BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(reportHtml(d, variant)));
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    fs.writeFileSync(outputPath, pdf);
  } finally {
    win.destroy();
  }
}
async function generateReport(store, req) {
  const data = collectData(store, req.assessmentId);
  fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
  if (req.format === "xlsx") await writeExcel(data, req.outputPath);
  else if (req.format === "docx") await writeDocx(data, req.outputPath);
  else await writePdf(data, req.outputPath, req.variant ?? "full");
  return req.outputPath;
}
function refreshNotifications(store) {
  const existing = store.list("notifications");
  const readMap = new Map(existing.map((n) => [`${n.kind}:${n.entityId}`, n.read]));
  for (const n of [...existing]) store.remove("notifications", n.id);
  const now = /* @__PURE__ */ new Date();
  const soon = new Date(now.getTime() + 7 * 864e5);
  const findings = store.list("findings");
  const assessments = store.list("assessments");
  const apps = new Map(store.list("applications").map((a) => [a.id, a]));
  const fresh = [];
  for (const f of findings) {
    if (isOverdue(f, now)) {
      fresh.push({
        kind: "sla-breach",
        entityId: f.id,
        message: `SLA breached: [${f.severity}] ${f.title} (due ${f.slaDueDate})`,
        read: readMap.get(`sla-breach:${f.id}`) ?? false
      });
    }
  }
  for (const a of assessments) {
    if (a.status === "Planned" && a.startDate) {
      const start = new Date(a.startDate);
      if (start >= now && start <= soon) {
        fresh.push({
          kind: "upcoming-assessment",
          entityId: a.id,
          message: `Assessment starting ${a.startDate}: ${a.name} (${apps.get(a.applicationId)?.name ?? "—"})`,
          read: readMap.get(`upcoming-assessment:${a.id}`) ?? false
        });
      }
    }
  }
  for (const f of findings) {
    if ((f.status === "Resolved" || f.status === "Closed") && f.closedDate) {
      const closed = new Date(f.closedDate);
      if (now.getTime() - closed.getTime() > 30 * 864e5) {
        const retested = assessments.some(
          (a) => a.type === "Retest" && a.applicationId === f.applicationId && a.createdAt >= f.closedDate
        );
        if (!retested) {
          fresh.push({
            kind: "retest-due",
            entityId: f.id,
            message: `Retest due: ${f.title} closed ${f.closedDate}, no retest scheduled`,
            read: readMap.get(`retest-due:${f.id}`) ?? false
          });
        }
      }
    }
  }
  return store.createMany("notifications", fresh);
}
const SECRET_RE = /\b(accesskey|secretkey|apikey|api[-_]key|password|passwd|pwd|token|secret|authorization|bearer|cookie|x-apikeys?)\b\s*[=:]\s*("[^"]*"|'[^']*'|[^\s;,)&"']+)/gi;
function redact(text) {
  if (!text) return "";
  return text.replace(SECRET_RE, "$1=[redacted]");
}
function safeStack(err) {
  const stack = err instanceof Error ? err.stack ?? err.message : String(err);
  const home = os.homedir();
  return redact(
    stack.split("\n").slice(0, 12).map((l) => l.split(home).join("~")).join("\n")
  );
}
const FILE_RE = /^(application|errors)-(\d{4}-\d{2}-\d{2})\.log$/;
class Logger {
  constructor() {
    this.getSettings = null;
  }
  /** Called once at startup; also triggers retention cleanup. */
  init(getSettings) {
    this.getSettings = getSettings;
    this.rotate();
  }
  get dir() {
    return path.join(this.getSettings().dataDir, "logs");
  }
  write(e) {
    try {
      const settings = this.getSettings?.();
      if (!settings) return;
      const level = e.level ?? "INFO";
      if (level === "DEBUG" && !settings.debugLogging) return;
      const entry = {
        id: crypto.randomUUID(),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level,
        category: e.category ?? "System",
        module: e.module ?? "main",
        source: e.source ?? "",
        page: e.page ?? "",
        action: e.action ?? "",
        status: e.status ?? (level === "ERROR" ? "failed" : "ok"),
        message: redact(e.message ?? ""),
        failureReason: redact(e.failureReason ?? ""),
        details: redact(e.details ?? ""),
        projectCode: e.projectCode ?? "",
        applicationId: e.applicationId ?? ""
      };
      const day = entry.timestamp.slice(0, 10);
      const line = JSON.stringify(entry) + "\n";
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, `application-${day}.log`), line);
      if (level === "ERROR") fs.appendFileSync(path.join(this.dir, `errors-${day}.log`), line);
    } catch {
    }
  }
  /** ERROR entry from a caught exception: what/where/why/when (SRS v6.3 §8). */
  error(e) {
    const { error, ...rest } = e;
    this.write({
      category: "Coding Errors",
      failureReason: error instanceof Error ? error.message : error !== void 0 ? String(error) : "",
      details: error !== void 0 ? safeStack(error) : "",
      ...rest,
      level: "ERROR"
    });
  }
  files(prefix) {
    try {
      return fs.readdirSync(this.dir).map((f) => FILE_RE.exec(f)).filter((m) => !!m && m[1] === prefix).map((m) => ({ file: path.join(this.dir, m[0]), day: m[2] })).sort((a, b) => a.day < b.day ? 1 : -1);
    } catch {
      return [];
    }
  }
  /** Filtered query, newest first (SRS v6.3 §11). */
  query(q) {
    const limit = q.limit ?? 500;
    const keyword = (q.keyword ?? "").trim().toLowerCase();
    const out = [];
    for (const { file, day } of this.files("application")) {
      if (q.dateFrom && day < q.dateFrom) continue;
      if (q.dateTo && day > q.dateTo) continue;
      let lines;
      try {
        lines = fs.readFileSync(file, "utf-8").split("\n");
      } catch {
        continue;
      }
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        let entry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (q.level && entry.level !== q.level) continue;
        if (q.category && entry.category !== q.category) continue;
        if (q.module && !entry.module.toLowerCase().includes(q.module.toLowerCase())) continue;
        if (q.projectCode && !entry.projectCode.toLowerCase().includes(q.projectCode.toLowerCase())) continue;
        if (q.applicationId && entry.applicationId !== q.applicationId) continue;
        if (keyword && !JSON.stringify(entry).toLowerCase().includes(keyword)) continue;
        out.push(entry);
      }
      if (out.length >= limit) break;
    }
    return out;
  }
  /** Newest content of the daily files, capped, for exports and the bundle. */
  tail(prefix, maxBytes) {
    let out = "";
    for (const { file } of this.files(prefix)) {
      try {
        out += fs.readFileSync(file, "utf-8");
      } catch {
      }
      if (out.length >= maxBytes) break;
    }
    return out.slice(0, maxBytes);
  }
  /** Manual cleanup (SRS v6.3 §12); caller is responsible for export-first UX. */
  clear() {
    let removed = 0;
    for (const prefix of ["application", "errors"]) {
      for (const { file } of this.files(prefix)) {
        try {
          fs.rmSync(file, { force: true });
          removed++;
        } catch {
        }
      }
    }
    return removed;
  }
  /** Retention: delete daily files older than the configured window. */
  rotate() {
    const settings = this.getSettings?.();
    if (!settings) return;
    const days = Math.max(1, settings.logRetentionDays || 30);
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    for (const prefix of ["application", "errors"]) {
      for (const { file, day } of this.files(prefix)) {
        if (day < cutoff) {
          try {
            fs.rmSync(file, { force: true });
          } catch {
          }
        }
      }
    }
  }
}
const logger = new Logger();
const CHANNEL_CATEGORY = [
  [/^scanner:/, "Scanner"],
  [/^report:/, "Reports"],
  [/^chart:/, "Charts"],
  [/^(nessus|evidence):/, "Import / Export"],
  [/^settings:/, "Settings"],
  [/^log:/, "Diagnostics"],
  [/^db:/, "Storage"]
];
function categoryFor(channel) {
  return CHANNEL_CATEGORY.find(([re]) => re.test(channel))?.[1] ?? "System";
}
function handle(channel, fn) {
  electron.ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await fn(e, ...args);
    } catch (err) {
      logger.error({
        category: categoryFor(channel),
        module: "ipc",
        source: channel,
        action: channel,
        message: `IPC ${channel} failed`,
        error: err
      });
      throw err;
    }
  });
}
function logAudit(action, name, entity) {
  if (name === "notifications") return;
  logger.write({
    category: "User Activity",
    module: "ipc",
    source: `db:${action}`,
    action: `${action} ${name}`,
    message: `${action} ${name} ${entity?.id ?? ""}`.trim(),
    projectCode: typeof entity?.projectCode === "string" ? entity.projectCode : "",
    applicationId: typeof entity?.applicationId === "string" ? entity.applicationId : ""
  });
}
function prepareFinding(store, data, existing) {
  const merged = { ...existing, ...data };
  if (merged.projectCode) {
    const req = store.list("requests").find((r) => r.projectCode === merged.projectCode);
    if (req?.applicationId) merged.applicationId = req.applicationId;
    if (!merged.assessmentId && req) {
      const adhocAssessment = store.list("assessments").find(
        (a) => a.requestId === req.id && (a.category || categoryOfType(a.type)) === "web" && (a.timeframe || "adhoc") === "adhoc"
      ) ?? store.create(
        "assessments",
        prepareAssessment({
          name: `Adhoc Web — ${req.projectCode}`,
          requestId: req.id,
          applicationId: req.applicationId,
          type: "Web",
          category: "web",
          timeframe: "adhoc",
          status: "In Progress",
          startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          endDate: "",
          hostIds: [],
          tester: "",
          baselineAssessmentId: "",
          notes: `Auto-created for adhoc web findings of ${req.projectCode} (SRS v6.2 §7)`
        })
      );
      merged.assessmentId = adhocAssessment.id;
    }
  }
  const host = merged.hostId ? store.get("hosts", merged.hostId) : void 0;
  merged.fingerprint = fingerprintOf({
    hostId: host?.ip ? "" : merged.hostId,
    ip: host?.ip,
    port: merged.port,
    pluginId: merged.pluginId,
    // Web findings have no host; the affected asset (URL/endpoint) is their identity.
    endpoint: merged.endpoint || merged.affectedAsset,
    parameter: merged.parameter,
    title: merged.title
  });
  if (merged.severity && merged.discoveredDate) {
    merged.slaDueDate = slaDueDate(merged.severity, merged.discoveredDate);
  }
  if (!isFindingOpen(merged) && !merged.closedDate) {
    merged.closedDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  } else if (isFindingOpen(merged)) {
    merged.closedDate = "";
  }
  if (!existing) {
    const assessment = merged.assessmentId ? store.get("assessments", merged.assessmentId) : void 0;
    if (assessment) {
      const requestsById = new Map(store.list("requests").map((r) => [r.id, r]));
      if (!merged.projectCode && assessment.requestId) {
        merged.projectCode = requestsById.get(assessment.requestId)?.projectCode ?? "";
      }
      const hosts = store.list("hosts");
      const lifecycle = classifyLifecycle(
        merged.fingerprint,
        assessment,
        store.list("assessments"),
        store.list("findings"),
        requestsById
      );
      if (lifecycle) Object.assign(merged, lifecycle);
      else
        merged.classification = classifyFinding(merged.fingerprint, merged.hostId, {
          priorFindings: store.list("findings").filter((f) => f.applicationId === assessment.applicationId),
          hostsById: new Map(hosts.map((h) => [h.id, h])),
          assessment
        });
    }
  }
  return merged;
}
function evidenceAddFile(store, findingId, srcPaths) {
  const finding = store.get("findings", findingId);
  if (!finding) throw new Error("Finding not found");
  const assessment = finding.assessmentId ? store.get("assessments", finding.assessmentId) : void 0;
  const dir = path.join(store.contextDir(assessment, finding.applicationId), "evidence", findingId);
  fs.mkdirSync(dir, { recursive: true });
  const attachments = [...finding.attachments ?? []];
  for (const src of srcPaths) {
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!EVIDENCE_EXTENSIONS.includes(ext)) continue;
    const id = crypto.randomUUID();
    const filename = path.basename(src);
    const stored = `${id}-${filename}`;
    fs.copyFileSync(src, path.join(dir, stored));
    attachments.push({
      id,
      filename,
      path: store.storablePath(path.join(dir, stored)),
      size: fs.statSync(src).size,
      addedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return store.update("findings", findingId, { attachments });
}
function compareAssessments(store, baselineId, currentId) {
  const all = store.list("findings");
  const a = all.filter((f) => f.assessmentId === baselineId);
  const b = all.filter((f) => f.assessmentId === currentId);
  const aByFp = new Map(a.map((f) => [f.fingerprint, f]));
  const bByFp = new Map(b.map((f) => [f.fingerprint, f]));
  const result = { newFindings: [], resolvedFindings: [], recurringFindings: [], severityChanges: [] };
  for (const f of b) {
    const prior = aByFp.get(f.fingerprint);
    if (!prior) result.newFindings.push(f);
    else {
      result.recurringFindings.push({ a: prior, b: f });
      if (prior.severity !== f.severity) result.severityChanges.push({ a: prior, b: f });
    }
  }
  for (const f of a) if (!bByFp.has(f.fingerprint)) result.resolvedFindings.push(f);
  return result;
}
function prepareRequest(data, existing) {
  const merged = { ...existing, ...data };
  if (merged.title?.includes("[")) {
    const parsed = parseProjectCode(merged.title);
    if (parsed.projectCode) {
      merged.projectCode = parsed.projectCode;
      merged.title = parsed.title;
    }
  }
  if (!merged.projectCode) merged.projectCode = generateProjectCode();
  return merged;
}
function prepareAssessment(data, existing) {
  const merged = { ...existing, ...data };
  if (merged.type && !merged.category) merged.category = categoryOfType(merged.type);
  if (!merged.timeframe) merged.timeframe = "adhoc";
  return merged;
}
function registerIpc(store, onSettingsChanged) {
  handle("db:list", (_e, name) => store.list(name));
  handle("db:get", (_e, name, id) => store.get(name, id));
  handle("db:create", (_e, name, data) => {
    const created = (() => {
      if (name === "findings") return store.create(name, prepareFinding(store, data));
      if (name === "requests") return store.create(name, prepareRequest(data));
      if (name === "assessments") return store.create(name, prepareAssessment(data));
      return store.create(name, data);
    })();
    logAudit("create", name, created);
    return created;
  });
  handle("db:update", (_e, name, id, patch) => {
    const updated = (() => {
      if (name === "findings") {
        const existing = store.get("findings", id);
        return store.update(name, id, prepareFinding(store, patch, existing));
      }
      if (name === "requests") {
        const next = store.update(name, id, prepareRequest(patch, store.get("requests", id)));
        store.repartition();
        return next;
      }
      if (name === "assessments") {
        const next = store.update(
          name,
          id,
          prepareAssessment(patch, store.get("assessments", id))
        );
        store.repartition();
        return next;
      }
      if (name === "applications") {
        const next = store.update(name, id, patch);
        store.repartition();
        return next;
      }
      return store.update(name, id, patch);
    })();
    logAudit("update", name, updated);
    return updated;
  });
  handle("db:remove", (_e, name, id) => {
    const entity = store.get(name, id);
    store.remove(name, id);
    logAudit("remove", name, entity ?? { id });
  });
  handle("settings:get", () => store.getSettings());
  handle("settings:set", (_e, patch) => {
    const result = store.setSettings(patch);
    onSettingsChanged?.();
    logger.write({
      category: "Settings",
      module: "ipc",
      source: "settings:set",
      action: "update settings",
      message: `Settings updated: ${Object.keys(patch).join(", ")}`
    });
    if (patch.logRetentionDays !== void 0) logger.rotate();
    return result;
  });
  handle("settings:chooseDir", async () => {
    const res = await electron.dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return res.canceled ? null : res.filePaths[0];
  });
  handle("nessus:import", async (_e, assessmentId, kind) => {
    const res = await electron.dialog.showOpenDialog({
      title: kind === "csv" ? "Select CSV export" : "Select .nessus export",
      filters: kind === "csv" ? [{ name: "CSV", extensions: ["csv"] }] : [{ name: "Nessus export", extensions: ["nessus", "xml"] }],
      properties: ["openFile"]
    });
    if (res.canceled) return null;
    const result = importNessusFile(store, assessmentId, res.filePaths[0]);
    logger.write({
      category: "Import / Export",
      module: "ipc",
      source: "nessus:import",
      action: "import scan",
      status: result.errors.length ? "partial" : "ok",
      message: `Imported ${path.basename(res.filePaths[0])}: ${result.imported} finding(s), ${result.duplicates} duplicate(s), ${result.hostsCreated} host(s)`,
      failureReason: result.errors.slice(0, 3).join("; "),
      details: `assessmentId=${assessmentId}`
    });
    return result;
  });
  handle("assessments:removeMany", (_e, ids) => {
    const idSet = new Set(ids);
    const doomedFindings = store.list("findings").filter((f) => idSet.has(f.assessmentId));
    for (const f of doomedFindings) {
      fs.rmSync(store.resolve(path.join("evidence", f.id)), { recursive: true, force: true });
    }
    store.removeMany(
      "findings",
      doomedFindings.map((f) => f.id)
    );
    const removedAssessments = store.list("assessments").filter((a) => idSet.has(a.id));
    const candidateHosts = new Set(removedAssessments.flatMap((a) => a.hostIds ?? []));
    const stillUsed = /* @__PURE__ */ new Set([
      ...store.list("assessments").filter((a) => !idSet.has(a.id)).flatMap((a) => a.hostIds ?? []),
      ...store.list("findings").map((f) => f.hostId)
    ]);
    const doomedHosts = [...candidateHosts].filter((h) => h && !stillUsed.has(h));
    store.removeMany("hosts", doomedHosts);
    store.removeMany("assessments", ids);
    logger.write({
      category: "Assessment",
      module: "ipc",
      source: "assessments:removeMany",
      action: "bulk remove",
      message: `Removed ${ids.length} assessment(s), ${doomedFindings.length} finding(s), ${doomedHosts.length} host(s) (cascade)`
    });
    return { assessments: ids.length, findings: doomedFindings.length, hosts: doomedHosts.length };
  });
  handle("nessus:importFiles", async (_e, category) => {
    const res = await electron.dialog.showOpenDialog({
      title: "Select Nessus / CSV export(s)",
      filters: [
        { name: "Nessus / CSV export", extensions: ["nessus", "xml", "csv"] },
        { name: "Nessus export", extensions: ["nessus", "xml"] },
        { name: "CSV", extensions: ["csv"] }
      ],
      properties: ["openFile", "multiSelections"]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const summary = {
      created: 0,
      imported: 0,
      duplicates: 0,
      hostsCreated: 0,
      failures: []
    };
    for (const filePath of res.filePaths) {
      const fileName = path.basename(filePath);
      try {
        const type = category === "internal-external" ? /external/i.test(fileName) ? "External VA" : "Internal VA" : CATEGORY_TYPES[category][0];
        const assessment = store.create(
          "assessments",
          prepareAssessment({
            name: fileName.replace(/\.(nessus|xml|csv)$/i, ""),
            applicationId: "",
            requestId: "",
            type,
            category,
            timeframe: "adhoc",
            status: "Completed",
            startDate: "",
            endDate: "",
            hostIds: [],
            tester: "",
            baselineAssessmentId: "",
            notes: `Manually imported from ${fileName}`
          })
        );
        const r = importNessusFile(store, assessment.id, filePath);
        summary.created++;
        summary.imported += r.imported;
        summary.duplicates += r.duplicates;
        summary.hostsCreated += r.hostsCreated;
        if (r.errors.length) summary.failures.push(`${fileName}: ${r.errors.slice(0, 2).join("; ")}`);
      } catch (err) {
        summary.failures.push(`${fileName}: ${err instanceof Error ? err.message : err}`);
      }
    }
    logger.write({
      category: "Import / Export",
      module: "ipc",
      source: "nessus:importFiles",
      action: "import scan files",
      status: summary.failures.length ? "partial" : "ok",
      message: `Imported ${summary.created}/${res.filePaths.length} file(s) into ${category}: ${summary.imported} finding(s), ${summary.duplicates} duplicate(s), ${summary.hostsCreated} host(s)`,
      failureReason: summary.failures.slice(0, 3).join(" · ")
    });
    return summary;
  });
  handle("scanner:test", async (_e, conn) => {
    const result = await testConnection(conn);
    logger.write({
      category: "Scanner",
      module: "ipc",
      source: "scanner:test",
      action: "test connection",
      level: result.ok ? "INFO" : "WARNING",
      status: result.ok ? "ok" : "failed",
      message: `Scanner "${conn.name || conn.url}" test ${result.ok ? "succeeded" : "failed"}`,
      failureReason: result.ok ? "" : result.message
    });
    return result;
  });
  handle("scanner:listScans", (_e, connId, includePolicy) => {
    const conn = store.getSettings().scanners.find((s) => s.id === connId);
    if (!conn) throw new Error("Scanner connection not found");
    return listScans(conn, includePolicy ?? false);
  });
  handle("scanner:fetch", async (e, assessmentId, connId, scanId, scanName) => {
    const conn = store.getSettings().scanners.find((s) => s.id === connId);
    if (!conn) throw new Error("Scanner connection not found");
    const send = (p) => {
      try {
        e.sender.send("scanner:progress", { scanId, ...p });
      } catch {
      }
    };
    const xml = await fetchScanXml(conn, scanId, send);
    const safe = `${scanName.replace(/[^\w.-]+/g, "_")}-${scanId}.nessus`;
    send({ stage: "importing", percent: 92, message: "Importing findings…" });
    const result = importNessusContent(store, assessmentId, xml, safe, false);
    send({ stage: "done", percent: 100, message: `Imported ${result.imported} finding(s)` });
    logger.write({
      category: "Scanner",
      module: "ipc",
      source: "scanner:fetch",
      action: "fetch scan",
      status: result.errors.length ? "partial" : "ok",
      message: `Fetched "${scanName}" from ${conn.name || conn.url}: ${result.imported} finding(s), ${result.hostsCreated} host(s)`,
      failureReason: result.errors.slice(0, 3).join("; "),
      details: `assessmentId=${assessmentId}`
    });
    return result;
  });
  handle("evidence:add", async (e, findingId) => {
    const finding = store.get("findings", findingId);
    if (!finding) throw new Error("Finding not found");
    const win = electron.BrowserWindow.fromWebContents(e.sender) ?? void 0;
    const res = await electron.dialog.showOpenDialog(win, {
      title: "Attach evidence",
      filters: [{ name: "Evidence", extensions: [...EVIDENCE_EXTENSIONS] }],
      properties: ["openFile", "multiSelections"]
    });
    if (res.canceled || res.filePaths.length === 0) return finding;
    return evidenceAddFile(store, findingId, res.filePaths);
  });
  handle("evidence:open", (_e, relPath) => electron.shell.openPath(store.resolve(relPath)));
  handle("evidence:remove", (_e, findingId, attachmentId) => {
    const finding = store.get("findings", findingId);
    if (!finding) throw new Error("Finding not found");
    const att = (finding.attachments ?? []).find((a) => a.id === attachmentId);
    if (att) fs.rmSync(store.resolve(att.path), { force: true });
    return store.update("findings", findingId, {
      attachments: (finding.attachments ?? []).filter((a) => a.id !== attachmentId)
    });
  });
  handle("report:generate", async (_e, req) => {
    const assessment = req.assessmentId ? store.get("assessments", req.assessmentId) : void 0;
    const baseDir = assessment ? store.contextDir(assessment) : store.getSettings().reportsDir;
    try {
      fs.mkdirSync(baseDir, { recursive: true });
    } catch {
    }
    const res = await electron.dialog.showSaveDialog({
      title: "Save report",
      defaultPath: path.join(baseDir, `${req.suggestedName}.${req.format}`),
      filters: [{ name: req.format.toUpperCase(), extensions: [req.format] }]
    });
    if (res.canceled || !res.filePath) return null;
    const out = await generateReport(store, { ...req, outputPath: res.filePath });
    logger.write({
      category: "Reports",
      module: "ipc",
      source: "report:generate",
      action: "generate report",
      message: `Generated ${req.format.toUpperCase()} report ${path.basename(out)}`
    });
    electron.shell.showItemInFolder(out);
    return out;
  });
  handle(
    "assessments:compare",
    (_e, baselineId, currentId) => compareAssessments(store, baselineId, currentId)
  );
  handle("notifications:refresh", () => refreshNotifications(store));
  handle("chart:exportPdf", async (_e, pngDataUrl, title, suggestedName) => {
    const res = await electron.dialog.showSaveDialog({
      title: "Export chart as PDF",
      defaultPath: `${store.getSettings().reportsDir}/${suggestedName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (res.canceled || !res.filePath) return null;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;margin:40px;color:#111}
      h1{font-size:20px} img{max-width:100%}
    </style></head><body><h1>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h1>
    <p>Generated ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ")}</p>
    <img src="${pngDataUrl}"></body></html>`;
    const win = new electron.BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
      fs.writeFileSync(res.filePath, pdf);
    } finally {
      win.destroy();
    }
    logger.write({
      category: "Charts",
      module: "ipc",
      source: "chart:exportPdf",
      action: "export chart pdf",
      message: `Chart exported to PDF: ${path.basename(res.filePath)}`
    });
    electron.shell.showItemInFolder(res.filePath);
    return res.filePath;
  });
  handle("shell:openPath", (_e, p) => electron.shell.openPath(p));
  handle("log:write", (_e, entry) => logger.write({ module: "renderer", ...entry }));
  handle("log:query", (_e, q) => logger.query(q ?? {}));
  handle("log:clear", () => {
    const removed = logger.clear();
    logger.write({
      category: "Diagnostics",
      module: "ipc",
      source: "log:clear",
      action: "clear logs",
      message: `Log files cleared (${removed} file(s) removed)`
    });
    return removed;
  });
  handle("log:export", async (_e, q) => {
    const res = await electron.dialog.showSaveDialog({
      title: "Export logs",
      defaultPath: `${store.getSettings().reportsDir}/tvm-logs-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.log`,
      filters: [{ name: "Log (JSON lines)", extensions: ["log", "json"] }]
    });
    if (res.canceled || !res.filePath) return null;
    const entries = logger.query({ ...q ?? {}, limit: 1e5 });
    fs.writeFileSync(res.filePath, entries.map((x) => JSON.stringify(x)).join("\n"));
    logger.write({
      category: "Diagnostics",
      module: "ipc",
      source: "log:export",
      action: "export logs",
      message: `Exported ${entries.length} log entrie(s) to ${path.basename(res.filePath)}`
    });
    electron.shell.showItemInFolder(res.filePath);
    return res.filePath;
  });
  handle("log:diagnostics", async () => {
    const res = await electron.dialog.showSaveDialog({
      title: "Generate diagnostic bundle",
      defaultPath: `${store.getSettings().reportsDir}/diagnostics-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }]
    });
    if (res.canceled || !res.filePath) return null;
    const s = store.getSettings();
    const redactScanner = (c) => ({
      ...c,
      accessKey: c.accessKey ? "[redacted]" : "",
      secretKey: c.secretKey ? "[redacted]" : ""
    });
    const zip = new JSZip();
    zip.file("application.log", logger.tail("application", 2e6));
    zip.file("errors.log", logger.tail("errors", 1e6));
    zip.file("configuration.json", JSON.stringify({ ...s, scanners: s.scanners.map(redactScanner) }, null, 2));
    zip.file(
      "system-info.json",
      JSON.stringify(
        {
          appVersion: electron.app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          osRelease: os.release(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          locale: electron.app.getLocale()
        },
        null,
        2
      )
    );
    zip.file("scanner-settings.json", JSON.stringify(s.scanners.map(redactScanner), null, 2));
    zip.file("version.json", JSON.stringify({ name: "TVM Portal", version: electron.app.getVersion() }, null, 2));
    fs.writeFileSync(res.filePath, await zip.generateAsync({ type: "nodebuffer" }));
    logger.write({
      category: "Diagnostics",
      module: "ipc",
      source: "log:diagnostics",
      action: "diagnostic bundle",
      message: `Diagnostic bundle generated: ${path.basename(res.filePath)}`
    });
    electron.shell.showItemInFolder(res.filePath);
    return res.filePath;
  });
}
class InboxWatcher {
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange;
    this.watcher = null;
    this.timer = null;
    this.scheduled = null;
  }
  get inboxDir() {
    return path.join(this.store.getSettings().dataDir, "inbox");
  }
  start() {
    this.stop();
    const dir = this.inboxDir;
    fs.mkdirSync(path.join(dir, "processed"), { recursive: true });
    fs.mkdirSync(path.join(dir, "failed"), { recursive: true });
    this.processAll();
    try {
      this.watcher = fs.watch(dir, () => this.schedule());
    } catch {
    }
    this.timer = setInterval(() => this.processAll(), 3e4);
  }
  stop() {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  schedule() {
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = setTimeout(() => this.processAll(), 500);
  }
  processAll() {
    const dir = this.inboxDir;
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => /^vapt.*\.(json|txt)$/i.test(f));
    } catch {
      return;
    }
    let created = 0;
    for (const name of entries) {
      const file = path.join(dir, name);
      try {
        if (this.processFile(file)) {
          created++;
          logger.write({
            category: "Import / Export",
            module: "inbox",
            source: "inbox.ts",
            action: "intake request",
            message: `Power Automate inbox created a request from ${name}`
          });
        }
        this.moveTo(file, "processed");
      } catch (e) {
        console.error(`inbox: failed to process ${name}:`, e);
        logger.error({
          category: "Import / Export",
          module: "inbox",
          source: "inbox.ts",
          action: "intake request",
          message: `Inbox file ${name} could not be parsed — moved to inbox/failed/`,
          error: e
        });
        this.moveTo(file, "failed");
      }
    }
    if (created > 0) this.onChange();
  }
  moveTo(file, bucket) {
    const dest = path.join(this.inboxDir, bucket, `${Date.now()}-${path.basename(file)}`);
    try {
      fs.renameSync(file, dest);
    } catch {
      fs.rmSync(file, { force: true });
    }
  }
  /** Returns true when a request was created (false = duplicate skipped). */
  processFile(file) {
    const raw = fs.readFileSync(file, "utf-8");
    let data;
    if (file.endsWith(".json")) {
      const j = JSON.parse(raw);
      data = {
        title: cleanPaText(j.subject || j.title || j.systemName || j.system) || "Untitled request",
        // `requestNumber` is the native Power Automate export field (VAPT-YYYYMMDD-HHMMSS).
        projectCode: j.projectCode || j.requestNumber || "",
        requestedBy: cleanPaText(j.name || j.requestedBy),
        requesterEmail: cleanPaText(j.email || j.emailAddress),
        department: cleanPaText(j.department || j.departmentDivision),
        systemName: cleanPaText(j.systemName || j.system),
        targetUatDate: normalizeDate(
          j.targetUatCompletion || j.targetUatDate || j.targetDateOfUatCompletionServerReadiness
        ),
        goLiveDate: normalizeDate(j.goLiveDate || j.goLive || j.targetDateToGoLive),
        purpose: cleanPaText(j.purpose),
        scope: cleanPaText(j.scope),
        // Notes stay empty for the analyst — every export field is shown in
        // the request detail view, so no auto-summary is duplicated here.
        notes: j.notes || "",
        // Keep the verbatim export so the stored request file round-trips
        // the Power Automate schema exactly (v6.6.6, see pa-format.ts).
        source: j
      };
      const assessmentType = assessmentTypeOf(j.typeOfSystem);
      if (assessmentType) data.assessmentType = assessmentType;
      const status = requestStatusOf(j.approvalStatus);
      if (status) data.status = status;
    } else {
      const [subject, ...rest] = raw.split("\n");
      data = {
        title: subject.trim() || "Untitled request",
        notes: rest.join("\n").trim() || `Imported from Power Automate inbox (${path.basename(file)})`
      };
    }
    const prepared = prepareRequest({
      status: "New",
      priority: "Medium",
      environment: "Production",
      assessmentType: "Web",
      ...data
    });
    if (prepared.projectCode && this.store.list("requests").some((r) => r.projectCode === prepared.projectCode)) {
      return false;
    }
    this.store.create("requests", prepared);
    return true;
  }
}
class RequestsWatcher {
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange;
    this.watcher = null;
    this.timer = null;
    this.scheduled = null;
    this.lastSig = "";
  }
  get dir() {
    return this.store.requestsDirPath();
  }
  /** Cheap change detector: file names + mtimes + sizes. */
  signature() {
    try {
      return fs.readdirSync(this.dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        return `${f}:${st.mtimeMs}:${st.size}`;
      }).join("|");
    } catch {
      return "";
    }
  }
  start() {
    this.stop();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
    }
    this.lastSig = this.signature();
    try {
      this.watcher = fs.watch(this.dir, () => this.schedule());
    } catch {
    }
    this.timer = setInterval(() => this.check(), 3e4);
  }
  stop() {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = null;
  }
  schedule() {
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = setTimeout(() => this.check(), 500);
  }
  check() {
    const sig = this.signature();
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.store.invalidate("requests");
    this.onChange();
    logger.write({
      category: "Import / Export",
      module: "inbox",
      source: "inbox.ts",
      action: "requests folder changed",
      message: "Requests folder changed on disk — reloaded live"
    });
  }
}
electron.app.setName("tvm-portal");
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    // shown maximized below — avoids a small-window flash
    title: "TVM Portal",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.maximize();
  win.show();
  win.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  const hash = process.env.TVM_PAGE ? `#${process.env.TVM_PAGE}` : "";
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + hash);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), { hash });
  }
  const shot = process.env.TVM_SCREENSHOT;
  if (shot) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(shot, image.toPNG());
        electron.app.quit();
      }, 2e3);
    });
  }
}
electron.app.whenReady().then(() => {
  const store = new Store();
  logger.init(() => store.getSettings());
  logger.write({
    category: "System",
    module: "main",
    source: "index.ts",
    action: "app-start",
    message: `TVM Portal ${electron.app.getVersion()} started (electron ${process.versions.electron}, ${process.platform})`
  });
  process.on(
    "uncaughtException",
    (err) => logger.error({ module: "main", source: "process", action: "uncaughtException", message: "Uncaught exception in main process", error: err })
  );
  process.on(
    "unhandledRejection",
    (reason) => logger.error({ module: "main", source: "process", action: "unhandledRejection", message: "Unhandled promise rejection in main process", error: reason })
  );
  const rotateTimer = setInterval(() => logger.rotate(), 24 * 3600 * 1e3);
  const notifyRenderers = () => electron.BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("data-changed"));
  const inbox = new InboxWatcher(store, notifyRenderers);
  const requestsWatcher = new RequestsWatcher(store, notifyRenderers);
  registerIpc(store, () => {
    inbox.start();
    requestsWatcher.start();
  });
  inbox.start();
  requestsWatcher.start();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  electron.app.on("will-quit", () => {
    inbox.stop();
    requestsWatcher.stop();
    clearInterval(rotateTimer);
    logger.write({ category: "System", module: "main", source: "index.ts", action: "app-quit", message: "TVM Portal shutting down" });
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
