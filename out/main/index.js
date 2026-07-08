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
  "internal-external": "internal-external-findings",
  host: "host-findings"
};
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
    this.settings = { ...this.settings, ...patch };
    this.atomicWrite(this.configPath, JSON.stringify(this.settings, null, 2));
    this.cache.clear();
    this.ensureDataDir();
    return this.settings;
  }
  ensureDataDir() {
    fs.mkdirSync(this.settings.dataDir, { recursive: true });
    fs.mkdirSync(this.settings.reportsDir, { recursive: true });
    fs.mkdirSync(path.join(this.settings.dataDir, "imports"), { recursive: true });
    fs.mkdirSync(path.join(this.settings.dataDir, "evidence"), { recursive: true });
  }
  /** Absolute path for a data-folder-relative path (e.g. an evidence attachment). */
  resolve(rel) {
    return path.join(this.settings.dataDir, rel);
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
      return Array.isArray(data) ? data : [data];
    } catch {
      return [];
    }
  }
  // ------------------------------------------------------------- loading
  load(name) {
    if (name === "findings") return this.loadFindings();
    if (name === "hosts") return this.loadHosts();
    return this.readJson(this.filePath(name));
  }
  loadFindings() {
    const items = [];
    for (const dir of Object.values(FINDINGS_DIRS)) {
      for (const file of walkJsonFiles(path.join(this.settings.dataDir, dir))) {
        items.push(...this.readJson(file));
      }
    }
    if (fs.existsSync(this.filePath("findings"))) {
      const ids = new Set(items.map((x) => x.id));
      items.push(...this.readJson(this.filePath("findings")).filter((x) => !ids.has(x.id)));
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
    this.atomicWrite(this.filePath(name), JSON.stringify(this.cache.get(name) ?? [], null, 2));
  }
  /** Directory for one finding, per SRS v3 §3.3. */
  findingFile(f, assessments) {
    const a = f.assessmentId ? assessments.get(f.assessmentId) : void 0;
    const category = a ? a.category || categoryOfType(a.type) : "web";
    const timeframe = a?.timeframe || "adhoc";
    const base = path.join(this.settings.dataDir, FINDINGS_DIRS[category], timeframe);
    let bucket;
    if (timeframe === "adhoc") {
      const req = a?.requestId ? this.get("requests", a.requestId) : void 0;
      bucket = safeSeg(req?.projectCode || a?.requestId || a?.id || "unassigned");
    } else {
      const appRec = f.applicationId ? this.get("applications", f.applicationId) : void 0;
      bucket = safeSeg(appRec?.name || "unassigned");
    }
    if (category === "host" && timeframe === "adhoc") {
      return path.join(base, bucket, safeSeg(f.hostId), "findings.json");
    }
    return path.join(base, bucket, "findings.json");
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
    for (const dir of Object.values(FINDINGS_DIRS)) {
      for (const file of walkJsonFiles(path.join(this.settings.dataDir, dir))) {
        if (!byFile.has(file)) fs.rmSync(file);
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
    for (const item of asArray(host.ReportItem)) {
      const cvss = parseFloat(item.cvss3_base_score ?? item.cvss_base_score ?? "0") || 0;
      rows.push({
        ip,
        hostname,
        port: String(item["@_port"] ?? "0"),
        pluginId: String(item["@_pluginID"] ?? ""),
        name: String(item["@_pluginName"] ?? item.plugin_name ?? "Unknown plugin"),
        cve: asArray(item.cve).map(String).join(", "),
        cvss,
        severity: NESSUS_SEVERITY[String(item["@_severity"] ?? "0")] ?? "Info",
        description: String(item.description ?? item.synopsis ?? ""),
        solution: String(item.solution ?? ""),
        evidence: String(item.plugin_output ?? "")
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
    port: cell(r, idx.port) || "0",
    pluginId: cell(r, idx.pluginId),
    name: cell(r, idx.name) || "Unknown plugin",
    cve: cell(r, idx.cve),
    cvss: parseFloat(cell(r, idx.cvss)) || 0,
    severity: RISK_SEVERITY[cell(r, idx.risk).toLowerCase()] ?? "Info",
    description: cell(r, idx.description),
    solution: cell(r, idx.solution),
    evidence: cell(r, idx.output)
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
          os: "",
          status: "Pending",
          notes: `Auto-created by Nessus import on ${today}`,
          sourceFile
        });
        hostByIp.set(row.ip, host);
        hostsById.set(host.id, host);
        result.hostsCreated++;
      }
      attachedHostIds.add(host.id);
      const fingerprint = fingerprintOf({
        hostId: "",
        ip: row.ip,
        port: row.port,
        pluginId: row.pluginId,
        endpoint: "",
        parameter: ""
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
        endpoint: "",
        port: row.port,
        parameter: "",
        description: row.description,
        evidence: row.evidence,
        attachments: [],
        recommendation: row.solution,
        status: "Open",
        classification,
        fingerprint,
        projectCode: assessmentProjectCode,
        firstIdentifiedAssessmentType: lifecycle?.firstIdentifiedAssessmentType ?? "",
        firstIdentifiedPeriod: lifecycle?.firstIdentifiedPeriod ?? "",
        firstIdentifiedProjectCode: lifecycle?.firstIdentifiedProjectCode ?? "",
        firstIdentifiedDate: lifecycle?.firstIdentifiedDate ?? "",
        discoveredDate: today,
        slaDueDate: slaDueDate(row.severity, today),
        closedDate: ""
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
    findings,
    hosts: hostList,
    hostName: (id) => {
      const h = hosts.get(id);
      return h ? h.hostname || h.ip : "—";
    },
    appName: (id) => apps.get(id)?.name ?? "—",
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
  return `This report covers ${d.findings.length} finding(s)` + (d.assessment ? ` from assessment "${d.assessment.name}" (${d.assessment.type})` : " across the portfolio") + `. ${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issues were identified. ${open} finding(s) remain open, of which ${d.sla.overdue} are past their remediation SLA. Current SLA compliance is ${d.sla.complianceRate}% with an average closure time of ${d.sla.avgClosureDays} day(s).`;
}
async function writeExcel(d, outputPath) {
  const wb = new ExcelJS.Workbook();
  wb.created = /* @__PURE__ */ new Date();
  const summary = wb.addWorksheet("Summary");
  summary.addRow([d.title]).font = { bold: true, size: 14 };
  summary.addRow([`Generated ${d.generatedAt}`]);
  summary.addRow([]);
  summary.addRow(["Executive Summary"]).font = { bold: true };
  summary.addRow([execSummaryText(d)]);
  summary.addRow([]);
  summary.addRow(["Findings by Severity"]).font = { bold: true };
  for (const s of SEVERITIES) summary.addRow([s, d.bySeverity[s]]);
  summary.addRow([]);
  summary.addRow(["SLA Summary"]).font = { bold: true };
  summary.addRow(["Open", d.sla.open]);
  summary.addRow(["Closed", d.sla.closed]);
  summary.addRow(["Overdue", d.sla.overdue]);
  summary.addRow(["Compliance rate", `${d.sla.complianceRate}%`]);
  summary.addRow(["Avg closure (days)", d.sla.avgClosureDays]);
  summary.addRow([]);
  summary.addRow(["Retest Summary"]).font = { bold: true };
  for (const [k, v] of Object.entries(d.retestCounts)) summary.addRow([k, v]);
  summary.getColumn(1).width = 40;
  const sheet = wb.addWorksheet("Findings");
  sheet.columns = [
    { header: "Title", key: "title", width: 45 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "CVSS", key: "cvss", width: 7 },
    { header: "Project Code", key: "projectCode", width: 22 },
    { header: "Application", key: "app", width: 22 },
    { header: "Host", key: "host", width: 22 },
    { header: "Port", key: "port", width: 8 },
    { header: "Endpoint", key: "endpoint", width: 25 },
    { header: "CVE", key: "cve", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Classification", key: "classification", width: 14 },
    { header: "First Identified", key: "firstIdentified", width: 18 },
    { header: "Discovered", key: "discovered", width: 12 },
    { header: "SLA Due", key: "sla", width: 12 },
    { header: "Overdue", key: "overdue", width: 9 },
    { header: "Recommendation", key: "rec", width: 60 }
  ];
  sheet.getRow(1).font = { bold: true };
  for (const f of d.findings) {
    sheet.addRow({
      title: f.title,
      severity: f.severity,
      cvss: f.cvss || "",
      projectCode: f.projectCode || "",
      app: d.appName(f.applicationId),
      host: d.hostName(f.hostId),
      port: f.port,
      endpoint: f.endpoint,
      cve: f.cve,
      status: f.status,
      classification: f.classification,
      firstIdentified: firstIdentifiedLabel(f),
      discovered: f.discoveredDate,
      sla: f.slaDueDate,
      overdue: isOverdue(f) ? "YES" : "",
      rec: f.recommendation
    });
  }
  sheet.autoFilter = { from: "A1", to: "P1" };
  const slaSheet = wb.addWorksheet("SLA Tracking");
  slaSheet.columns = [
    { header: "Title", key: "title", width: 45 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "Status", key: "status", width: 14 },
    { header: "Discovered", key: "discovered", width: 12 },
    { header: "SLA Due", key: "due", width: 12 },
    { header: "Days Remaining", key: "days", width: 15 },
    { header: "Overdue", key: "overdue", width: 9 },
    { header: "Closed", key: "closed", width: 12 }
  ];
  slaSheet.getRow(1).font = { bold: true };
  for (const f of d.findings) {
    slaSheet.addRow({
      title: f.title,
      severity: f.severity,
      status: f.status,
      discovered: f.discoveredDate,
      due: f.slaDueDate,
      days: isFindingOpen(f) && f.slaDueDate ? slaDaysRemaining(f) : "",
      overdue: isOverdue(f) ? "YES" : "",
      closed: f.closedDate
    });
  }
  slaSheet.autoFilter = { from: "A1", to: "H1" };
  const hostSheet = wb.addWorksheet("Host Mapping");
  hostSheet.columns = [
    { header: "IP Address", key: "ip", width: 16 },
    { header: "Hostname", key: "hostname", width: 26 },
    { header: "Application", key: "app", width: 22 },
    { header: "Environment", key: "env", width: 13 },
    { header: "Exposure", key: "exposure", width: 10 },
    { header: "Source Import", key: "source", width: 30 },
    { header: "Findings", key: "count", width: 10 }
  ];
  hostSheet.getRow(1).font = { bold: true };
  for (const h of d.hosts) {
    hostSheet.addRow({
      ip: h.ip,
      hostname: h.hostname,
      app: d.appName(h.applicationId),
      env: h.environment,
      exposure: h.exposure,
      source: h.sourceFile || "manual",
      count: d.findings.filter((f) => f.hostId === h.id).length
    });
  }
  const sevSheet = wb.addWorksheet("Severity Distribution");
  sevSheet.addRow(["Severity", "Count", "Share"]).font = { bold: true };
  const total = d.findings.length || 1;
  for (const s of SEVERITIES) {
    sevSheet.addRow([s, d.bySeverity[s], `${Math.round(d.bySeverity[s] / total * 100)}%`]);
  }
  sevSheet.getColumn(1).width = 14;
  await wb.xlsx.writeFile(outputPath);
}
async function writeDocx(d, outputPath) {
  const kv = (rows) => new docx.Table({
    width: { size: 60, type: docx.WidthType.PERCENTAGE },
    rows: rows.map(
      ([k, v]) => new docx.TableRow({
        children: [
          new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: k, bold: true })] })] }),
          new docx.TableCell({ children: [new docx.Paragraph(String(v))] })
        ]
      })
    )
  });
  const findingBlocks = d.findings.flatMap((f) => [
    new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, text: `${f.severity}: ${f.title}` }),
    kv([
      ["Application", d.appName(f.applicationId)],
      ["Project Code", f.projectCode || "—"],
      ["Host", `${d.hostName(f.hostId)}${f.port ? ":" + f.port : ""}`],
      ["Endpoint", f.endpoint || "—"],
      ["CVSS", f.cvss || "—"],
      ["CVE", f.cve || "—"],
      ["Status", f.status],
      ["Classification", firstIdentifiedLabel(f) ? `Existing • First Identified: ${firstIdentifiedLabel(f)}` : f.classification],
      ["SLA due", f.slaDueDate || "—"]
    ]),
    new docx.Paragraph({ children: [new docx.TextRun({ text: "Description", bold: true })], spacing: { before: 200 } }),
    new docx.Paragraph(f.description || "—"),
    new docx.Paragraph({ children: [new docx.TextRun({ text: "Evidence", bold: true })], spacing: { before: 200 } }),
    new docx.Paragraph(f.evidence || "—"),
    new docx.Paragraph({ children: [new docx.TextRun({ text: "Recommendation", bold: true })], spacing: { before: 200 } }),
    new docx.Paragraph({ text: f.recommendation || "—", spacing: { after: 400 } })
  ]);
  const doc = new docx.Document({
    features: { updateFields: true },
    sections: [
      {
        children: [
          // Cover page (§5.2.5) — project code front and centre.
          new docx.Paragraph({ spacing: { before: 3e3 } }),
          new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, alignment: docx.AlignmentType.CENTER, text: d.title }),
          ...d.projectCode ? [
            new docx.Paragraph({
              alignment: docx.AlignmentType.CENTER,
              children: [new docx.TextRun({ text: d.projectCode, bold: true, size: 36 })]
            })
          ] : [],
          new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, text: `Generated ${d.generatedAt}` }),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "Table of Contents" }),
          new docx.TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
          new docx.Paragraph({ children: [new docx.PageBreak()] }),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "1. Executive Summary" }),
          new docx.Paragraph(execSummaryText(d)),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "2. Risk Summary" }),
          kv(SEVERITIES.map((s) => [s, d.bySeverity[s]])),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "3. SLA Summary" }),
          kv([
            ["Open findings", d.sla.open],
            ["Closed findings", d.sla.closed],
            ["Overdue findings", d.sla.overdue],
            ["Compliance rate", `${d.sla.complianceRate}%`],
            ["Average closure time", `${d.sla.avgClosureDays} days`]
          ]),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "4. Retest Summary" }),
          kv(Object.entries(d.retestCounts)),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "5. Technical Findings" }),
          ...findingBlocks,
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "Appendix A. Host Mapping" }),
          kv(d.hosts.map((h) => [h.ip || h.hostname, `${h.hostname} · ${h.exposure} · ${h.sourceFile || "manual"}`])),
          new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: "Appendix B. SLA Reference" }),
          kv([
            ["Critical", "30 days"],
            ["High", "60 days"],
            ["Medium", "90 days"],
            ["Low", "180 days"]
          ])
        ]
      }
    ]
  });
  fs.writeFileSync(outputPath, await docx.Packer.toBuffer(doc));
}
const SEV_COLORS = {
  Critical: "#b91c1c",
  High: "#ea580c",
  Medium: "#ca8a04",
  Low: "#2563eb",
  Info: "#6b7280"
};
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function reportHtml(d, variant) {
  const sevRows = SEVERITIES.map(
    (s) => `<tr><td><span class="sev" style="background:${SEV_COLORS[s]}">${s}</span></td><td>${d.bySeverity[s]}</td></tr>`
  ).join("");
  const findingRows = d.findings.map(
    (f) => `
    <div class="finding">
      <h3><span class="sev" style="background:${SEV_COLORS[f.severity]}">${f.severity}</span> ${esc(f.title)}</h3>
      <table class="meta">
        <tr><td>Host</td><td>${esc(d.hostName(f.hostId))}${f.port ? ":" + esc(f.port) : ""}</td>
            <td>Application</td><td>${esc(d.appName(f.applicationId))}</td></tr>
        <tr><td>CVSS</td><td>${f.cvss || "—"}</td><td>CVE</td><td>${esc(f.cve) || "—"}</td></tr>
        <tr><td>Project Code</td><td>${esc(f.projectCode || "") || "—"}</td>
            <td>Classification</td><td>${firstIdentifiedLabel(f) ? `Existing • First Identified: ${esc(firstIdentifiedLabel(f))}` : f.classification}</td></tr>
        <tr><td>Status</td><td>${f.status}</td><td>SLA due</td><td>${f.slaDueDate || "—"}${isOverdue(f) ? ' <b style="color:#b91c1c">(OVERDUE)</b>' : ""}</td></tr>
      </table>
      <p><b>Description:</b> ${esc(f.description) || "—"}</p>
      <p><b>Recommendation:</b> ${esc(f.recommendation) || "—"}</p>
    </div>`
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#111;margin:40px;font-size:12px}
    h1{font-size:22px;border-bottom:3px solid #111;padding-bottom:8px}
    h2{font-size:16px;margin-top:28px}
    h3{font-size:13px;margin:0 0 6px}
    table{border-collapse:collapse;width:100%;margin:8px 0}
    td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
    .sev{color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:600}
    .finding{border:1px solid #ddd;border-radius:6px;padding:12px;margin:12px 0;page-break-inside:avoid}
    .meta td:nth-child(odd){font-weight:600;width:12%;background:#f5f5f5}
  </style></head><body>
    <h1>${esc(d.title)}</h1>
    ${d.projectCode ? `<p><b>Project Code:</b> ${esc(d.projectCode)}</p>` : ""}
    <p>Generated ${d.generatedAt}${variant === "executive" ? " · Executive Summary edition" : ""}</p>
    <h2>1. Executive Summary</h2><p>${esc(execSummaryText(d))}</p>
    <h2>2. Risk Summary</h2><table>${sevRows}</table>
    <h2>3. SLA Summary</h2>
    <table>
      <tr><td>Open</td><td>${d.sla.open}</td></tr>
      <tr><td>Closed</td><td>${d.sla.closed}</td></tr>
      <tr><td>Overdue</td><td>${d.sla.overdue}</td></tr>
      <tr><td>Compliance rate</td><td>${d.sla.complianceRate}%</td></tr>
      <tr><td>Average closure time</td><td>${d.sla.avgClosureDays} days</td></tr>
    </table>
    <h2>4. Retest Summary</h2>
    <table>${Object.entries(d.retestCounts).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    ${variant === "full" ? `<h2>5. Technical Findings</h2>${findingRows || "<p>No findings.</p>"}` : ""}
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
  const dir = store.resolve(path.join("evidence", findingId));
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
      path: path.join("evidence", findingId, stored),
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
    const res = await electron.dialog.showSaveDialog({
      title: "Save report",
      defaultPath: `${store.getSettings().reportsDir}/${req.suggestedName}.${req.format}`,
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
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".txt"));
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
        title: j.subject || j.title || "Untitled request",
        projectCode: j.projectCode || "",
        requestedBy: j.name || j.requestedBy || "",
        requesterEmail: j.email || "",
        department: j.department || "",
        systemName: j.systemName || j.system || "",
        targetUatDate: normalizeDate(j.targetUatCompletion || j.targetUatDate),
        goLiveDate: normalizeDate(j.goLiveDate || j.goLive),
        purpose: j.purpose || "",
        scope: j.scope || "",
        notes: j.notes || `Imported from Power Automate inbox (${path.basename(file)})`
      };
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
function normalizeDate(v) {
  if (!v) return "";
  const dmy = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = v.trim().match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : "";
}
electron.app.setName("tvm-portal");
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "TVM Portal",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
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
  registerIpc(store, () => inbox.start());
  inbox.start();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  electron.app.on("will-quit", () => {
    inbox.stop();
    clearInterval(rotateTimer);
    logger.write({ category: "System", module: "main", source: "index.ts", action: "app-quit", message: "TVM Portal shutting down" });
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
