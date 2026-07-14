# Technical Vulnerability Guidelines

Generated from `knowledge base/kb.json` on 2026-07-14. This guide is intentionally defensive and verification-oriented. It covers every current KB entry and gives reviewers/developers a consistent way to identify, evidence, remediate, and retest web, API, mobile, and source-code findings.

## Scope And Safety Rules

- Use only authorized test environments, test tenants, and test accounts.
- Keep sample verification non-destructive and avoid real customer, payment, credential, or production data.
- Redact tokens, cookies, personal data, account numbers, hostnames, and internal URLs in evidence.
- Treat client-side findings as symptoms; enforce final security decisions server-side or with platform security controls.
- A finding is not closed until the expected fixed result is demonstrated and a regression test or documented retest exists.

## Evidence Standard

Each finding record should include affected asset, user role, environment, request/response or screen evidence, source-code location where known, vulnerable behavior, expected secure behavior, business impact, mitigation owner, and retest result.

## Broader Reference Library

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) - Web
- [OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/) - Web
- [OWASP Code Review Guide](https://owasp.org/www-project-code-review-guide/) - Source
- [OWASP API Security](https://owasp.org/API-Security/) - API
- [OWASP MASVS / MASTG](https://mas.owasp.org/MASVS/) - Mobile
- [MITRE CWE](https://cwe.mitre.org/) - Weakness taxonomy
- [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - Secure SDLC

## Universal Review Flow

```mermaid
flowchart LR
  A["Scope and authorization"] --> B["Map feature and trust boundary"]
  B --> C["Identify source, sink, and control"]
  C --> D["Run safe verification"]
  D --> E{"Vulnerable behavior observed?"}
  E -- "Yes" --> F["Record evidence and impact"]
  E -- "No" --> G["Record expected secure behavior"]
  F --> H["Fix at enforcement point"]
  H --> I["Add regression test"]
  I --> J["Retest and close"]
```

## Framework And Source Review Quick Map

| Stack | Authentication / Authorization | Validation | Rendering | Storage / Files | Useful Review Locations |
| --- | --- | --- | --- | --- | --- |
| Laravel / PHP | middleware, gates, policies | FormRequest, validators | Blade escaped vs raw output | Storage facade, upload controllers | `routes/web.php`, `routes/api.php`, controllers, policies |
| Django / DRF | decorators, permissions, object permissions | forms, serializers | autoescape, `safe` filters | storage backend, upload views | `urls.py`, views, serializers, permissions |
| Flask / Python | decorators, blueprints, service checks | pydantic/marshmallow/custom validators | Jinja autoescape, `safe` | werkzeug uploads, filesystem joins | blueprints, views, service/repository layer |
| Express / NestJS | middleware, guards, interceptors | DTOs, zod/joi/class-validator | React/templates, manual DOM/API responses | multer/busboy, fs/path use | routers, controllers, guards, services |
| Spring Boot | Spring Security, method security | Bean Validation | Thymeleaf/JSP escaping | MultipartFile, storage service | controllers, filters, repositories |
| ASP.NET Core | policies, attributes, resource handlers | model validation, FluentValidation | Razor encoding, Html.Raw | IFormFile, storage service | controllers, middleware, handlers |
| Rails | before actions, Pundit/CanCan | strong params, model validations | ERB escaping, html_safe | ActiveStorage | routes, controllers, policies |
| React / Next.js | middleware/server actions/API auth | zod/yup/server validation | JSX escaping, dangerous HTML sinks | API routes, upload handlers | app/routes, components, middleware |
| Angular / Vue | route guards only for UX | reactive forms plus backend validation | innerHTML, v-html, sanitizer bypass | upload components and API service | components, services, guards |
| Android | backend auth plus platform checks | input validators | WebView and bridge settings | Keystore, encrypted DB/files | manifest, network config, Kotlin/Java |
| iOS | backend auth plus platform checks | input validators | WKWebView and bridge handlers | Keychain, data protection | Info.plist, entitlements, Swift/Obj-C |

## Finding Guidance

### kb-1: SQL Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Critical |
| CWE | CWE-89 |
| OWASP | A03:2021 Injection |

**Behavior**

User input is concatenated into SQL statements.

**Risk**

Full database compromise, data exfiltration.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-89 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "raw\(|whereRaw|query\(|execute\(|FromSqlRaw|\.raw\(|extra\(|\$where|find\(req\.|filter=.*req" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Query construction

```bash
rg -n "whereRaw|raw\(|query\(|execute\(|FromSqlRaw|createQuery|\.raw\(|extra\(|\$where|\$regex|filter\s*=|find\(req\.|params\.|body\." src app server
```

  - Source review vulnerable result: User-controlled values are concatenated into query strings or operators without binding/type allowlisting.
  - Source review fixed result: Parameterized queries, ORM bind variables, strict DTO types, and allowlisted operators/fields are used.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/search?q=%27 HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"error":"SQL syntax error near ..."} 

or: result count/authentication behavior changes unexpectedly.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"results":[]}

or: HTTP 400 with a generic validation error and no backend query details.
```

Notes: Use harmless metacharacters and compare behavior with a normal value. Do not run destructive payloads.

**Safe Sample Verification / PoC**

- Input: Submit a harmless metacharacter such as a single quote in a search/login parameter in a test account.
- Command or action:

```bash
curl -i "https://app.example.test/search?q=%27"
```

- Expected vulnerable result: HTTP 500, database/LDAP error, changed result count, or different authentication behavior.
- Expected fixed result: HTTP 200/400 with a generic validation message; no backend error details; query logic unchanged.

**Remediation At Code Level**

Use parameterized queries / ORM; least-privilege DB accounts. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 500, database/LDAP error, changed result count, or different authentication behavior. Expected fixed signal: HTTP 200/400 with a generic validation message; no backend error details; query logic unchanged.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-2: Missing Security Headers

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | Low |
| CWE | CWE-693 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

Responses lack important browser security headers such as Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy.

**Risk**

Increases exposure to clickjacking, MIME sniffing, downgrade attacks, and client-side injection impact.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-693 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Implement a hardened baseline of HTTP security headers appropriate to the application and test for regressions in CI/CD.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-3: Cross-Site Scripting (Reflected)

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-79 |
| OWASP | A03:2021 Injection |

**Behavior**

User-controlled input is reflected in the response without sufficient output encoding or sanitization.

**Risk**

An attacker may execute JavaScript in a victim browser, steal session data, perform actions as the user, or alter page content.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-79 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Apply context-aware output encoding, validate input, sanitize trusted HTML with a proven library, and deploy a restrictive Content-Security-Policy. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-4: Cross-Site Scripting (Stored)

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Critical |
| CWE | CWE-79 |
| OWASP | A03:2021 Injection |

**Behavior**

Untrusted input is stored by the application and later rendered to other users without sufficient output encoding or sanitization.

**Risk**

Persistent script execution can compromise multiple users, including privileged users, and may lead to account takeover or unauthorized administrative actions.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-79 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Perform context-aware output encoding on render, sanitize rich text on input and output, restrict dangerous HTML, and invalidate affected stored content. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-5: Broken Access Control / IDOR

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-639 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

The application exposes object identifiers that can be modified to access another user's records or resources.

**Risk**

Unauthorized disclosure, modification, or deletion of sensitive business data belonging to other users or tenants.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-639 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Enforce server-side authorization checks for every object access, use indirect identifiers where appropriate, and add automated authorization tests. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-6: Privilege Escalation

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Critical |
| CWE | CWE-269 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

A lower-privileged user can access administrative functions or perform actions beyond their assigned role.

**Risk**

Complete compromise of application administration, unauthorized data changes, or bypass of operational controls.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-269 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Implement centralized role and permission enforcement on the server, deny by default, and test horizontal and vertical authorization boundaries. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-7: Authentication Bypass

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Critical |
| CWE | CWE-287 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Authentication controls can be bypassed due to flawed logic, missing verification, or trust in client-controlled state.

**Risk**

Attackers may gain unauthorized access to accounts or protected application functionality without valid credentials.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-287 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Enforce authentication on the server for every protected route/API, avoid trusting client-side flags, and add negative authentication tests. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-8: Weak Password Policy

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-521 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

The application allows weak, common, short, or easily guessable passwords.

**Risk**

Accounts are more susceptible to credential guessing, password spraying, and brute-force attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-521 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Require strong password length and complexity or passphrase controls, block common passwords, and support MFA for sensitive roles. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-9: Missing Account Lockout / Brute Force Protection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-307 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Login or sensitive authentication endpoints do not sufficiently throttle repeated failed attempts.

**Risk**

Attackers can conduct password guessing or credential stuffing attacks at scale.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-307 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Implement rate limiting, progressive delays, account lockout or risk-based challenges, monitoring, and alerting for suspicious login attempts. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-10: Insecure Session Cookie Attributes

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-614 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

Session cookies are missing security attributes such as Secure, HttpOnly, or SameSite.

**Risk**

Session tokens may be exposed through client-side script, transmitted over insecure channels, or abused in cross-site request scenarios.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-614 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Set session cookies with Secure, HttpOnly, and an appropriate SameSite value; ensure cookies are only issued over HTTPS. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-11: Session Fixation

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-384 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

The application does not rotate the session identifier after successful authentication or privilege change.

**Risk**

An attacker who obtains or sets a victim session identifier may hijack the authenticated session.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-384 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Regenerate session identifiers after login, logout, password changes, MFA enrollment, and privilege changes; invalidate old session IDs. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-12: Cross-Site Request Forgery (CSRF)

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Medium |
| CWE | CWE-352 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

State-changing requests can be submitted without a valid anti-CSRF token or equivalent protection.

**Risk**

An attacker may trick authenticated users into performing unintended actions such as changing account settings or submitting transactions.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-352 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /account/change-email HTTP/1.1
Host: app.example.test
Cookie: session=TEST_SESSION
Content-Type: application/x-www-form-urlencoded

email=tester-new@example.test
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Email change succeeds without CSRF token, valid Origin/Referer, or bound OAuth state.
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden

Request rejected because CSRF/state value is missing, invalid, expired, or not bound to the session.
```

Notes: For OAuth/OIDC, verify state and PKCE where applicable. Do not use real identity-provider accounts for this check.

**Safe Sample Verification / PoC**

- Input: Repeat the state-changing request without CSRF/state token in a controlled test session.
- Command or action:

```bash
curl -i -X POST "https://app.example.test/account/change-email" -b "session=TEST" -d "email=test@example.test"
```

- Expected vulnerable result: Request succeeds without a valid anti-CSRF/state value or origin validation.
- Expected fixed result: Request fails with 403/400; valid token/state is single-use or session-bound where required.

**Remediation At Code Level**

Use per-request or per-session CSRF tokens, SameSite cookies, origin/referrer validation, and require re-authentication for high-risk actions. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Request succeeds without a valid anti-CSRF/state value or origin validation. Expected fixed signal: Request fails with 403/400; valid token/state is single-use or session-bound where required.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-13: Unrestricted File Upload

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | File handling |
| Severity | High |
| CWE | CWE-434 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application accepts file uploads without sufficient validation of file type, extension, content, size, or storage location.

**Risk**

Attackers may upload executable files, malware, web shells, or oversized files that lead to code execution, data compromise, or denial of service.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-434 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "upload|download|multer|IFormFile|MultipartFile|sendFile|readFile|writeFile|path\.join|Storage::|ActiveStorage" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- File path and content handling

```bash
rg -n "upload|download|multer|busboy|IFormFile|MultipartFile|sendFile|readFile|writeFile|createReadStream|path\.join|path\.resolve|Storage::|ActiveStorage|Content-Disposition|Content-Type" src app server
```

  - Source review vulnerable result: User-controlled filenames/paths/MIME types are trusted or file authorization is missing.
  - Source review fixed result: Server-generated filenames, base-directory checks, MIME signature validation, safe headers, and object authorization exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/files/FILE_ID_FROM_OTHER_USER HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="other-user-file.txt"

<file content returned>
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden

or HTTP/1.1 404 Not Found with no file content.
```

Notes: For upload checks, use harmless text/image samples. Verify extension, MIME signature, size, storage path, preview isolation, and authorization.

**Safe Sample Verification / PoC**

- Input: Upload/download a harmless text file and verify extension, MIME, path, and authorization controls.
- Command or action:

```bash
curl -i -F "file=@sample.txt" "https://app.example.test/upload"
```

- Expected vulnerable result: Unexpected file type accepted, path escapes storage root, or another user file is accessible.
- Expected fixed result: Only allowlisted files pass; generated filenames are used; access requires object authorization.

**Remediation At Code Level**

Allowlist file types, verify content signatures, rename files, store uploads outside the web root, scan files, enforce size limits, and disable execution in upload directories. Generate server-side filenames, verify content signatures, store outside web root, isolate previews, and authorize every file operation.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Unexpected file type accepted, path escapes storage root, or another user file is accessible. Expected fixed signal: Only allowlisted files pass; generated filenames are used; access requires object authorization.

**Recommended Review Flow**

```text
File request -> authenticate -> authorize object -> validate type/size/path -> safe storage/preview -> logged access
```

### kb-14: Path Traversal

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-22 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

User-controlled path input can access files or directories outside the intended application directory.

**Risk**

Sensitive files, configuration secrets, source code, or system files may be read or modified.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-22 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "upload|download|multer|IFormFile|MultipartFile|sendFile|readFile|writeFile|path\.join|Storage::|ActiveStorage" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- File path and content handling

```bash
rg -n "upload|download|multer|busboy|IFormFile|MultipartFile|sendFile|readFile|writeFile|createReadStream|path\.join|path\.resolve|Storage::|ActiveStorage|Content-Disposition|Content-Type" src app server
```

  - Source review vulnerable result: User-controlled filenames/paths/MIME types are trusted or file authorization is missing.
  - Source review fixed result: Server-generated filenames, base-directory checks, MIME signature validation, safe headers, and object authorization exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/files/FILE_ID_FROM_OTHER_USER HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="other-user-file.txt"

<file content returned>
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden

or HTTP/1.1 404 Not Found with no file content.
```

Notes: For upload checks, use harmless text/image samples. Verify extension, MIME signature, size, storage path, preview isolation, and authorization.

**Safe Sample Verification / PoC**

- Input: Upload/download a harmless text file and verify extension, MIME, path, and authorization controls.
- Command or action:

```bash
curl -i -F "file=@sample.txt" "https://app.example.test/upload"
```

- Expected vulnerable result: Unexpected file type accepted, path escapes storage root, or another user file is accessible.
- Expected fixed result: Only allowlisted files pass; generated filenames are used; access requires object authorization.

**Remediation At Code Level**

Normalize and validate paths using safe path APIs, enforce an allowlisted base directory, reject traversal sequences, and avoid direct use of user input in file paths. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Unexpected file type accepted, path escapes storage root, or another user file is accessible. Expected fixed signal: Only allowlisted files pass; generated filenames are used; access requires object authorization.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-15: Server-Side Request Forgery (SSRF)

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Protocol, integration, and trust boundary |
| Severity | High |
| CWE | CWE-918 |
| OWASP | A10:2021 Server-Side Request Forgery |

**Behavior**

The application fetches user-supplied URLs or network locations without restricting destination hosts or protocols.

**Risk**

Attackers may access internal services, cloud metadata endpoints, or perform network scanning through the server.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-918 and A10:2021 Server-Side Request Forgery. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/import-url HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"url":"https://example.test/allowed-sample.json"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Server fetches arbitrary user-supplied destinations or accepts unsigned webhook messages.
```

Expected fixed response or observation:

```http
HTTP/1.1 400 Bad Request

{"error":"Destination is not allowed"}

or webhook is rejected because signature/timestamp validation fails.
```

Notes: Use only controlled destinations. Confirm redirects are revalidated and private/link-local destinations are blocked.

**Safe Sample Verification / PoC**

- Input: Submit a URL or webhook event using a controlled internal/test destination and observe server-side fetch/acceptance behavior.
- Command or action:

```bash
curl -i -X POST "https://app.example.test/import-url" -d "url=https://example.test/file.json"
```

- Expected vulnerable result: Server fetches untrusted destinations or accepts unsigned/untrusted integration messages.
- Expected fixed result: Only allowlisted destinations/providers are accepted; signatures and replay windows are enforced.

**Remediation At Code Level**

Allowlist trusted destinations, block private/link-local/internal IP ranges, restrict protocols, disable redirects where possible, and isolate outbound fetch services. Validate origins, destinations, signatures, hosts, and replay windows at the trust boundary; avoid reflecting or trusting client-supplied routing metadata.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Server fetches untrusted destinations or accepts unsigned/untrusted integration messages. Expected fixed signal: Only allowlisted destinations/providers are accepted; signatures and replay windows are enforced.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-16: XML External Entity (XXE)

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-611 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

XML input is parsed with external entity processing enabled.

**Risk**

Attackers may read local files, trigger SSRF, or cause denial of service through malicious XML payloads.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-611 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Disable external entity resolution and DTD processing, use hardened XML parsers, and prefer safer data formats where possible. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-17: Command Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Critical |
| CWE | CWE-78 |
| OWASP | A03:2021 Injection |

**Behavior**

User-controlled input is passed to operating system commands without safe handling.

**Risk**

Attackers may execute arbitrary commands on the server, leading to full host compromise.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-78 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "exec\(|spawn\(|system\(|shell_exec|Runtime\.exec|ProcessBuilder|child_process" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Avoid shell execution with user input, use safe APIs, pass arguments as structured arrays, validate allowlisted values, and run processes with least privilege. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-18: LDAP Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-90 |
| OWASP | A03:2021 Injection |

**Behavior**

User input is inserted into LDAP queries without proper escaping or parameterization.

**Risk**

Attackers may bypass authentication, enumerate directory data, or modify LDAP query logic.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-90 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "raw\(|whereRaw|query\(|execute\(|FromSqlRaw|\.raw\(|extra\(|\$where|find\(req\.|filter=.*req" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Query construction

```bash
rg -n "whereRaw|raw\(|query\(|execute\(|FromSqlRaw|createQuery|\.raw\(|extra\(|\$where|\$regex|filter\s*=|find\(req\.|params\.|body\." src app server
```

  - Source review vulnerable result: User-controlled values are concatenated into query strings or operators without binding/type allowlisting.
  - Source review fixed result: Parameterized queries, ORM bind variables, strict DTO types, and allowlisted operators/fields are used.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/search?q=%27 HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"error":"SQL syntax error near ..."} 

or: result count/authentication behavior changes unexpectedly.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"results":[]}

or: HTTP 400 with a generic validation error and no backend query details.
```

Notes: Use harmless metacharacters and compare behavior with a normal value. Do not run destructive payloads.

**Safe Sample Verification / PoC**

- Input: Submit a harmless metacharacter such as a single quote in a search/login parameter in a test account.
- Command or action:

```bash
curl -i "https://app.example.test/search?q=%27"
```

- Expected vulnerable result: HTTP 500, database/LDAP error, changed result count, or different authentication behavior.
- Expected fixed result: HTTP 200/400 with a generic validation message; no backend error details; query logic unchanged.

**Remediation At Code Level**

Use safe LDAP query builders, escape special characters, validate input, and enforce least-privilege LDAP bind accounts. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 500, database/LDAP error, changed result count, or different authentication behavior. Expected fixed signal: HTTP 200/400 with a generic validation message; no backend error details; query logic unchanged.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-19: Insecure Direct API Endpoint Exposure

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-306 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

API endpoints expose sensitive operations or data without sufficient authentication, authorization, or server-side validation.

**Risk**

Attackers may bypass UI restrictions and directly call APIs to access or manipulate data.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-306 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Apply consistent authentication and authorization to every API, validate all server-side inputs, and add API abuse monitoring. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-20: Sensitive Data Exposure in Response

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-200 |
| OWASP | A02:2021 Cryptographic Failures |

**Behavior**

Application responses include sensitive data such as tokens, credentials, internal identifiers, PII, stack traces, or excessive account details.

**Risk**

Exposed data may support account takeover, privacy violations, fraud, or further attacks against internal systems.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-200 and A02:2021 Cryptographic Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Return only required fields, mask sensitive values, remove debug details, and review API response schemas for least disclosure. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-21: Sensitive Information in Client-Side Code

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-798 |
| OWASP | A02:2021 Cryptographic Failures |

**Behavior**

Secrets, API keys, internal URLs, credentials, or sensitive business logic are exposed in JavaScript, source maps, or bundled client files.

**Risk**

Attackers may extract secrets, discover hidden endpoints, or better understand application internals for targeted attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-798 and A02:2021 Cryptographic Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Remove secrets from client code, rotate exposed keys, restrict API keys by origin/scope, and disable source maps in production unless access-controlled. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-22: Verbose Error Messages / Stack Trace Disclosure

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | Low |
| CWE | CWE-209 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application exposes detailed error messages, stack traces, framework versions, or internal paths to users.

**Risk**

Attackers can use the information to fingerprint technologies, discover internal paths, and craft targeted exploits.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-209 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "rateLimit|throttle|limit|idempot|transaction|lock|mutex|regex|RegExp|complexity|depth|pagination|pageSize" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/transactions HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Idempotency-Key: TEST-KEY-001
Content-Type: application/json

{"amount":1,"currency":"MYR","target":"TEST_ACCOUNT"}
```

Expected vulnerable response or observation:

```http
Multiple rapid submissions create multiple state changes, excessive processing, or no rate-limit response.
```

Expected fixed response or observation:

```http
First request: HTTP 201 Created
Repeated same idempotency key: HTTP 200/409 with same result or duplicate rejected.
Excessive rate: HTTP 429 Too Many Requests.
```

Notes: Use low-value test transactions or non-financial test workflows. Agree concurrency/rate test limits before execution.

**Safe Sample Verification / PoC**

- Input: Send controlled repeated or concurrent requests in a test environment with agreed rate limits.
- Command or action:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.test/limited"; done
```

- Expected vulnerable result: No throttling, duplicate state changes, excessive query cost, or slow regex processing.
- Expected fixed result: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Remediation At Code Level**

Return generic error messages to users, log detailed errors server-side only, and disable debug mode in production.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: No throttling, duplicate state changes, excessive query cost, or slow regex processing. Expected fixed signal: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-26: Insecure CORS Configuration

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-942 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application allows overly broad cross-origin requests, such as wildcard origins with credentials or reflection of arbitrary origins.

**Risk**

Malicious websites may read sensitive API responses from authenticated users if browser credentials are included.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-942 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Allowlist trusted origins only, avoid wildcard origins for authenticated APIs, do not reflect arbitrary origins, and review credentialed CORS usage. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-27: Clickjacking

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | Low |
| CWE | CWE-1021 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application can be embedded in a frame by untrusted websites due to missing or weak frame protection.

**Risk**

Attackers may trick users into performing unintended clicks or actions through UI redressing attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-1021 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Set Content-Security-Policy frame-ancestors and/or X-Frame-Options to restrict framing to trusted origins.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-28: Open Redirect

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Low |
| CWE | CWE-601 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

The application redirects users to a URL controlled by user input without validation.

**Risk**

Attackers may craft trusted-looking links that redirect victims to phishing sites or malicious downloads.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-601 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Use relative redirects or allowlist trusted redirect destinations; avoid accepting arbitrary full URLs from user input. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-29: Business Logic Bypass

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | High |
| CWE | CWE-840 |
| OWASP | A04:2021 Insecure Design |

**Behavior**

Application workflow or server-side validation can be bypassed to perform actions out of sequence or outside business rules.

**Risk**

Attackers may manipulate transactions, approvals, limits, discounts, or operational controls without exploiting a technical injection flaw.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-840 and A04:2021 Insecure Design. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Enforce business rules server-side, validate state transitions, use idempotency and transaction controls, and test negative workflow paths.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-30: Insufficient Logging and Monitoring

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Low |
| CWE | CWE-778 |
| OWASP | A09:2021 Security Logging and Monitoring Failures |

**Behavior**

Security-relevant events such as login failures, privilege changes, data exports, or administrative actions are not logged or monitored adequately.

**Risk**

Security incidents may go undetected, investigation may be delayed, and audit requirements may not be met.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-778 and A09:2021 Security Logging and Monitoring Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Log security events with sufficient context, protect logs from tampering, alert on suspicious activity, and review logs regularly. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-31: Mobile Application Allows Cleartext Traffic

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | High |
| CWE | CWE-319 |
| OWASP | M3:2024 Insecure Communication |

**Behavior**

The mobile application permits HTTP or other cleartext network communication through platform configuration or runtime behavior.

**Risk**

Network attackers may intercept or modify sensitive traffic, credentials, tokens, or API responses.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-319 and M3:2024 Insecure Communication. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Disable cleartext traffic in Android Network Security Configuration and iOS App Transport Security exceptions unless strictly required; enforce HTTPS with modern TLS for all endpoints. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-32: Mobile Insecure Data Storage

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Access control |
| Severity | High |
| CWE | CWE-922 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

Sensitive information such as access tokens, credentials, PII, account data, or transaction details is stored insecurely on the device.

**Risk**

Attackers with device access, backup access, malware, or a compromised device may extract sensitive data.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-922 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Store secrets only in Android Keystore or iOS Keychain with appropriate access controls, avoid storing sensitive data unnecessarily, encrypt local databases, and clear temporary sensitive data. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-33: Mobile Hardcoded Secrets

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-798 |
| OWASP | M8:2024 Security Misconfiguration |

**Behavior**

The mobile application package contains hardcoded API keys, encryption keys, credentials, tokens, private URLs, or other sensitive secrets.

**Risk**

Attackers may reverse engineer the application and abuse exposed secrets to access backend services or bypass controls.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-798 and M8:2024 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Remove secrets from the client, rotate exposed values, move sensitive operations to the server, and restrict any unavoidable client keys by scope, platform, certificate, and backend authorization. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-34: Mobile Weak Certificate Pinning or Missing Pinning

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-295 |
| OWASP | M3:2024 Insecure Communication |

**Behavior**

The mobile application does not implement certificate pinning for sensitive connections, or the implemented pinning can be bypassed due to weak design.

**Risk**

Users on hostile networks or compromised devices may be exposed to interception if a rogue or user-installed certificate is trusted.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-295 and M3:2024 Insecure Communication. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Implement certificate or public-key pinning for high-risk APIs, use platform-supported TLS validation, fail closed on pinning errors, and maintain a secure pin rotation strategy. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-35: Mobile Improper TLS Certificate Validation

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Critical |
| CWE | CWE-295 |
| OWASP | M3:2024 Insecure Communication |

**Behavior**

The mobile application accepts invalid, self-signed, expired, mismatched, or untrusted TLS certificates.

**Risk**

Attackers may perform man-in-the-middle attacks and intercept or tamper with sensitive application traffic.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-295 and M3:2024 Insecure Communication. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use the platform default trust manager, reject invalid certificates, remove custom permissive trust logic, and test certificate validation on both trusted and untrusted networks. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-36: Mobile Root or Jailbreak Detection Missing

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-693 |
| OWASP | M8:2024 Security Misconfiguration |

**Behavior**

The application does not detect or respond to rooted Android devices or jailbroken iOS devices for sensitive workflows.

**Risk**

A compromised device can make runtime tampering, credential extraction, hooking, and local data access easier.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-693 and M8:2024 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Add layered root/jailbreak detection, integrity checks, risk-based restrictions for sensitive actions, and server-side fraud monitoring; do not rely on client checks as the only control. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-37: Mobile Runtime Tampering Protection Missing

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-693 |
| OWASP | M7:2024 Insufficient Binary Protections |

**Behavior**

The application lacks defenses against dynamic instrumentation, hooking frameworks, debugging, or runtime modification.

**Risk**

Attackers may bypass client-side controls, inspect secrets, alter transaction flows, or manipulate application behavior.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-693 and M7:2024 Insufficient Binary Protections. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Implement layered anti-debugging, anti-hooking, integrity validation, obfuscation, and server-side validation for critical decisions; monitor suspicious device and session signals. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-38: Mobile Debuggable Build Enabled

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | High |
| CWE | CWE-489 |
| OWASP | M8:2024 Security Misconfiguration |

**Behavior**

The production Android application is built with the debuggable flag enabled or exposes debugging capabilities.

**Risk**

Attackers may attach debuggers, inspect runtime state, extract data, or bypass client-side protections more easily.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-489 and M8:2024 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Disable debuggable mode for release builds, enforce release signing and build checks in CI/CD, and verify production artifacts before distribution. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-39: Mobile Backup Enabled for Sensitive App Data

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-922 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

The mobile application allows sensitive local data to be included in device backups or cloud backups.

**Risk**

Sensitive data may be restored to unauthorized devices or extracted from backup files.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-922 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Disable Android backup for sensitive apps or exclude sensitive files with backup rules; configure iOS data protection and avoid storing sensitive information in backup-accessible locations. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-40: Mobile Sensitive Data in Logs

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-532 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

The mobile application writes sensitive values such as tokens, passwords, OTPs, PII, or API responses to system or application logs.

**Risk**

Logs may be accessed by developers, support tooling, malware, or attackers with device access, exposing sensitive data.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-532 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Remove sensitive logging, mask values before logging, disable verbose logs in release builds, and review third-party SDK logging behavior. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-41: Mobile Sensitive Data in Clipboard

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | Low |
| CWE | CWE-200 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

The application places sensitive information such as OTPs, account numbers, tokens, or personal data into the system clipboard.

**Risk**

Other applications or system features may read clipboard content, causing unintended disclosure.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-200 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Avoid copying sensitive values to the clipboard, provide masked display options, clear clipboard data where supported, and warn users when sensitive copying is necessary. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-42: Mobile Insecure Deep Link Handling

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | High |
| CWE | CWE-939 |
| OWASP | M4:2024 Insufficient Input/Output Validation |

**Behavior**

The mobile application accepts deep links, app links, or universal links without proper validation of parameters, origins, or target actions.

**Risk**

Attackers may trigger unauthorized actions, steal tokens, perform phishing, or bypass intended navigation and authentication flows.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-939 and M4:2024 Insufficient Input/Output Validation. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Validate all deep link parameters server-side and client-side, require authentication for sensitive actions, restrict accepted hosts/schemes, and avoid placing secrets in URLs. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-43: Mobile Exported Android Component Exposure

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | High |
| CWE | CWE-926 |
| OWASP | M8:2024 Security Misconfiguration |

**Behavior**

Android activities, services, broadcast receivers, or content providers are exported without sufficient permission checks or input validation.

**Risk**

Other applications may invoke internal functionality, access data, or manipulate application behavior.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-926 and M8:2024 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Set exported=false for internal components, protect required exported components with signature-level permissions, validate intents, and avoid exposing sensitive content providers. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-44: Mobile Insecure Inter-Process Communication

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-927 |
| OWASP | M1:2024 Improper Credential Usage |

**Behavior**

The application exchanges sensitive data through intents, broadcasts, URL schemes, pasteboard, or IPC channels without sufficient protection.

**Risk**

Malicious applications may intercept, spoof, or tamper with messages and sensitive data.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-927 and M1:2024 Improper Credential Usage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use explicit intents, signature permissions, local-only communication where possible, encrypted payloads for sensitive data, and strict validation of IPC inputs. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-45: Mobile WebView JavaScript Interface Exposure

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Access control |
| Severity | High |
| CWE | CWE-749 |
| OWASP | M4:2024 Insufficient Input/Output Validation |

**Behavior**

A WebView exposes JavaScript bridges or unsafe settings that allow untrusted web content to interact with native application functions.

**Risk**

Attackers may execute native actions, access local data, or escalate impact from web content injection.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-749 and M4:2024 Insufficient Input/Output Validation. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Disable JavaScript when not required, restrict loaded origins, remove unsafe JavaScript interfaces, validate bridge inputs, and avoid loading untrusted content in privileged WebViews. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-46: Mobile Weak Cryptography

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Client-side and content rendering |
| Severity | High |
| CWE | CWE-327 |
| OWASP | M10:2024 Insufficient Cryptography |

**Behavior**

The application uses weak cryptographic algorithms, static keys, predictable IVs, insecure random generation, or custom cryptographic routines.

**Risk**

Encrypted data may be decrypted, forged, or tampered with by attackers.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-327 and M10:2024 Insufficient Cryptography. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Trace untrusted data from source to DOM/template sink and verify context-aware encoding or sanitization.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use modern vetted cryptographic libraries, AES-GCM or platform-approved algorithms, secure random generation, proper key management, and avoid custom crypto. Encode by output context, sanitize rich content with an allowlist, remove dangerous sinks, and use CSP as defense-in-depth.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Untrusted source -> validation/sanitization -> context-aware encoding -> safe DOM/template sink -> CSP/reporting
```

### kb-47: Mobile Biometric Authentication Bypass

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-287 |
| OWASP | M1:2024 Improper Credential Usage |

**Behavior**

The application relies on local biometric prompts without binding successful authentication to secure hardware or server-side session controls.

**Risk**

Attackers may bypass biometric checks through hooking, tampering, or insecure local state changes.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-287 and M1:2024 Improper Credential Usage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use platform biometric APIs with cryptographic objects where appropriate, require server-side authorization for sensitive actions, and avoid using local flags as proof of authentication. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-48: Mobile Screen Capture Protection Missing

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Client-side and content rendering |
| Severity | Low |
| CWE | CWE-200 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

Sensitive screens can be captured through screenshots, screen recording, recent-app previews, or overlays.

**Risk**

Sensitive information may be exposed through device galleries, app switcher thumbnails, support recordings, or malicious overlay techniques.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-200 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Trace untrusted data from source to DOM/template sink and verify context-aware encoding or sanitization.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Apply Android FLAG_SECURE and iOS screen privacy controls on sensitive views, mask app switcher previews, and reduce sensitive on-screen exposure. Encode by output context, sanitize rich content with an allowlist, remove dangerous sinks, and use CSP as defense-in-depth.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Untrusted source -> validation/sanitization -> context-aware encoding -> safe DOM/template sink -> CSP/reporting
```

### kb-49: Mobile Insecure Local Database Storage

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-922 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

The application stores sensitive data in local SQLite, Realm, Core Data, or flat files without encryption or adequate access controls.

**Risk**

Attackers with filesystem or backup access may extract sensitive business data, PII, or session information.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-922 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Encrypt local databases using vetted libraries, store keys in Android Keystore or iOS Keychain, minimize local retention, and clear stale sensitive data. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-50: Mobile Insecure Token Refresh Flow

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-613 |
| OWASP | M1:2024 Improper Credential Usage |

**Behavior**

Refresh tokens or session renewal logic are weakly protected, long-lived without rotation, or accepted without device/session binding.

**Risk**

Stolen refresh tokens may allow persistent account access even after access tokens expire.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-613 and M1:2024 Improper Credential Usage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use refresh token rotation, revoke reused tokens, bind sessions to device and risk signals where appropriate, store tokens securely, and require re-authentication for high-risk events. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-51: API Broken Object Level Authorization

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-639 |
| OWASP | API1:2023 Broken Object Level Authorization |

**Behavior**

API endpoints allow users to access objects by changing identifiers without proper object-level authorization checks.

**Risk**

Attackers may access or modify records belonging to other users, departments, or tenants.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-639 and API1:2023 Broken Object Level Authorization. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Enforce object-level authorization on every API request, avoid relying on client-side filtering, and add automated negative tests for cross-user and cross-tenant access. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-52: API Mass Assignment

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-915 |
| OWASP | API3:2023 Broken Object Property Level Authorization |

**Behavior**

The API automatically binds client-supplied fields to internal objects without restricting fields that users are allowed to set.

**Risk**

Attackers may modify protected properties such as roles, account status, ownership, limits, or approval flags.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-915 and API3:2023 Broken Object Property Level Authorization. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Use explicit allowlists for writable fields, separate input DTOs from internal models, and reject unexpected properties in API requests. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-53: API Excessive Data Exposure

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | Medium |
| CWE | CWE-200 |
| OWASP | API3:2023 Broken Object Property Level Authorization |

**Behavior**

API responses return more data than required by the client, including hidden fields, internal identifiers, or sensitive user attributes.

**Risk**

Attackers may obtain information useful for privacy violations, fraud, account takeover, or further exploitation.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-200 and API3:2023 Broken Object Property Level Authorization. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Define response schemas per use case, filter sensitive fields server-side, avoid relying on the client to hide data, and review API contracts regularly. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-54: API Lack of Resource and Rate Limiting

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Availability and abuse protection |
| Severity | Medium |
| CWE | CWE-770 |
| OWASP | API4:2023 Unrestricted Resource Consumption |

**Behavior**

The API does not sufficiently limit request rate, payload size, pagination size, expensive queries, or repeated sensitive operations.

**Risk**

Attackers may perform brute force attacks, scraping, enumeration, or denial of service.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-770 and API4:2023 Unrestricted Resource Consumption. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "rateLimit|throttle|limit|idempot|transaction|lock|mutex|regex|RegExp|complexity|depth|pagination|pageSize" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/transactions HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Idempotency-Key: TEST-KEY-001
Content-Type: application/json

{"amount":1,"currency":"MYR","target":"TEST_ACCOUNT"}
```

Expected vulnerable response or observation:

```http
Multiple rapid submissions create multiple state changes, excessive processing, or no rate-limit response.
```

Expected fixed response or observation:

```http
First request: HTTP 201 Created
Repeated same idempotency key: HTTP 200/409 with same result or duplicate rejected.
Excessive rate: HTTP 429 Too Many Requests.
```

Notes: Use low-value test transactions or non-financial test workflows. Agree concurrency/rate test limits before execution.

**Safe Sample Verification / PoC**

- Input: Send controlled repeated or concurrent requests in a test environment with agreed rate limits.
- Command or action:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.test/limited"; done
```

- Expected vulnerable result: No throttling, duplicate state changes, excessive query cost, or slow regex processing.
- Expected fixed result: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Remediation At Code Level**

Apply rate limits, quota controls, pagination caps, request size limits, account-based throttling, and monitoring for abnormal API usage.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: No throttling, duplicate state changes, excessive query cost, or slow regex processing. Expected fixed signal: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-55: Insecure Mobile API Error Handling

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Low |
| CWE | CWE-209 |
| OWASP | API8:2023 Security Misconfiguration |

**Behavior**

Mobile backend APIs return detailed errors, stack traces, internal codes, or validation details that reveal implementation information.

**Risk**

Attackers may use exposed information to fingerprint backend technologies, enumerate valid records, or refine attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-209 and API8:2023 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Return generic client-safe errors, log details server-side, normalize authentication and authorization failures, and avoid exposing internal exception details. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-56: HTML Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Medium |
| CWE | CWE-79 |
| OWASP | A03:2021 Injection |

**Behavior**

User-controlled input is rendered as HTML without sufficient encoding, allowing attackers to inject arbitrary markup.

**Risk**

Attackers may alter page content, perform phishing, mislead users, or create a path toward script execution depending on browser and context.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-79 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message" src app client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Rendering and DOM sinks

```bash
rg -n "innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrust|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message|markdown|sanitize" src app client resources
```

  - Source review vulnerable result: Untrusted data reaches raw HTML/DOM/Markdown/message sinks without context encoding or allowlist sanitization.
  - Source review fixed result: Data is rendered as text, sanitized with an allowlist where rich content is required, and origin/schema checks exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/comments HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"comment":"<b>KB_TEST</b>"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Follow-up page renders KB_TEST as active HTML or places it in an unsafe DOM sink.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK

Follow-up page displays the literal text "<b>KB_TEST</b>" or sanitized allowlisted formatting only.
```

Notes: For Markdown/rich text, clarify whether limited formatting is allowed. The fixed result should match the product requirement, not simply strip all text.

**Safe Sample Verification / PoC**

- Input: Use a benign marker string such as <b>KB_TEST</b> or a non-executing HTML tag in a test field.
- Command or action:

```bash
rg -n "dangerouslySetInnerHTML|innerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|markdown" src app resources
```

- Expected vulnerable result: The marker renders as active markup or reaches a dangerous DOM sink without sanitization.
- Expected fixed result: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Remediation At Code Level**

Use context-aware output encoding, sanitize allowed rich text with a proven library, and avoid rendering untrusted input as raw HTML. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The marker renders as active markup or reaches a dangerous DOM sink without sanitization. Expected fixed signal: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-57: DOM-Based Cross-Site Scripting

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-79 |
| OWASP | A03:2021 Injection |

**Behavior**

Client-side JavaScript processes untrusted data from URLs, storage, messages, or APIs and writes it into dangerous DOM sinks.

**Risk**

Attackers may execute JavaScript in the victim browser, steal tokens, manipulate UI content, or perform actions as the user.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-79 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message" src app client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Rendering and DOM sinks

```bash
rg -n "innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrust|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message|markdown|sanitize" src app client resources
```

  - Source review vulnerable result: Untrusted data reaches raw HTML/DOM/Markdown/message sinks without context encoding or allowlist sanitization.
  - Source review fixed result: Data is rendered as text, sanitized with an allowlist where rich content is required, and origin/schema checks exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/comments HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"comment":"<b>KB_TEST</b>"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Follow-up page renders KB_TEST as active HTML or places it in an unsafe DOM sink.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK

Follow-up page displays the literal text "<b>KB_TEST</b>" or sanitized allowlisted formatting only.
```

Notes: For Markdown/rich text, clarify whether limited formatting is allowed. The fixed result should match the product requirement, not simply strip all text.

**Safe Sample Verification / PoC**

- Input: Use a benign marker string such as <b>KB_TEST</b> or a non-executing HTML tag in a test field.
- Command or action:

```bash
rg -n "dangerouslySetInnerHTML|innerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|markdown" src app resources
```

- Expected vulnerable result: The marker renders as active markup or reaches a dangerous DOM sink without sanitization.
- Expected fixed result: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Remediation At Code Level**

Avoid dangerous DOM sinks, use safe DOM APIs, validate and encode untrusted data, sanitize HTML with a proven library, and apply a restrictive Content-Security-Policy. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The marker renders as active markup or reaches a dangerous DOM sink without sanitization. Expected fixed signal: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-58: Content Security Policy Misconfiguration

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Medium |
| CWE | CWE-693 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The Content-Security-Policy is missing, overly permissive, uses unsafe directives, or does not meaningfully reduce script injection impact.

**Risk**

Successful injection vulnerabilities may have greater impact, and attackers may load malicious scripts, frames, or resources from untrusted locations.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-693 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Define a restrictive CSP with nonce or hash based script execution, avoid unsafe-inline and unsafe-eval, restrict frame/object sources, and test policy violations before enforcement. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-59: JWT Misconfiguration

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-347 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

JSON Web Tokens are accepted with weak validation, insecure algorithms, missing expiration checks, or improper signature verification.

**Risk**

Attackers may forge, replay, or tamper with tokens to impersonate users or escalate privileges.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-347 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Enforce strong signing algorithms, verify signatures and claims server-side, reject none or unexpected algorithms, use short token lifetimes, and rotate keys securely. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-60: Password Reset Poisoning

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-640 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

The password reset flow trusts user-controlled host, origin, or callback values when generating reset links.

**Risk**

Attackers may cause reset tokens to be sent in links pointing to attacker-controlled domains, enabling account takeover.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-640 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Generate reset URLs from a trusted server-side base URL, validate host headers, avoid user-controlled callback domains, and expire reset tokens quickly after use. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-61: User Enumeration

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Low |
| CWE | CWE-203 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Authentication, registration, password reset, or lookup flows reveal whether an account, email address, or username exists.

**Risk**

Attackers may build valid user lists for phishing, credential stuffing, social engineering, or targeted attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-203 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Use consistent responses and timing for valid and invalid accounts, rate limit enumeration-prone endpoints, and monitor suspicious lookup patterns. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-62: Missing Multi-Factor Authentication for Privileged Users

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-308 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Administrative or high-risk accounts can authenticate without multi-factor authentication.

**Risk**

Compromised passwords may provide direct access to sensitive data, privileged workflows, or administrative controls.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-308 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Require phishing-resistant MFA where possible for privileged users, enforce step-up authentication for sensitive actions, and monitor privileged login anomalies. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-63: Improper Logout Session Invalidation

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-613 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Sessions or tokens remain valid after logout, password change, or account deactivation.

**Risk**

Stolen or previously issued tokens may continue to grant access after the user expects the session to be terminated.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-613 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Invalidate server-side sessions on logout and security events, revoke refresh tokens, clear client tokens, and verify session termination across devices where required. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-64: Insecure Direct File Download

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-639 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

The application allows users to download files by modifying file identifiers, paths, or URLs without proper authorization checks.

**Risk**

Attackers may retrieve documents, reports, attachments, or personal files belonging to other users or business units.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-639 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "upload|download|multer|IFormFile|MultipartFile|sendFile|readFile|writeFile|path\.join|Storage::|ActiveStorage" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- File path and content handling

```bash
rg -n "upload|download|multer|busboy|IFormFile|MultipartFile|sendFile|readFile|writeFile|createReadStream|path\.join|path\.resolve|Storage::|ActiveStorage|Content-Disposition|Content-Type" src app server
```

  - Source review vulnerable result: User-controlled filenames/paths/MIME types are trusted or file authorization is missing.
  - Source review fixed result: Server-generated filenames, base-directory checks, MIME signature validation, safe headers, and object authorization exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Enforce authorization on every file download, use indirect file references, avoid exposing storage paths, and log suspicious download attempts. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-65: Template Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Critical |
| CWE | CWE-94 |
| OWASP | A03:2021 Injection |

**Behavior**

User-controlled input is evaluated by a server-side or client-side template engine without safe handling.

**Risk**

Attackers may execute code, access sensitive objects, read files, or compromise the server depending on the template engine.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-94 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Avoid evaluating user input as templates, use safe rendering modes, sandbox template execution, validate input, and keep template engines updated. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-66: Insecure Deserialization

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Critical |
| CWE | CWE-502 |
| OWASP | A08:2021 Software and Data Integrity Failures |

**Behavior**

The application deserializes untrusted data without integrity protection, type restrictions, or safe parsing controls.

**Risk**

Attackers may trigger remote code execution, authentication bypass, data tampering, or denial of service.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-502 and A08:2021 Software and Data Integrity Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Avoid deserializing untrusted data, use safe data formats, enforce type allowlists, sign serialized objects, and isolate risky parsing logic. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-67: HTTP Request Smuggling

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Protocol, integration, and trust boundary |
| Severity | High |
| CWE | CWE-444 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

Front-end and back-end servers parse ambiguous HTTP requests differently due to inconsistent handling of headers such as Content-Length and Transfer-Encoding.

**Risk**

Attackers may bypass security controls, poison responses, hijack requests, or access other users' data through desynchronized connections.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-444 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Normalize HTTP parsing across proxy and origin layers, reject ambiguous requests, keep web components updated, and test reverse proxy chains for desynchronization issues. Validate origins, destinations, signatures, hosts, and replay windows at the trust boundary; avoid reflecting or trusting client-supplied routing metadata.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-68: Cache Poisoning

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Protocol, integration, and trust boundary |
| Severity | High |
| CWE | CWE-444 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application or intermediary cache stores responses influenced by untrusted headers, parameters, or host values.

**Risk**

Attackers may serve malicious or sensitive cached content to other users, causing XSS, phishing, or data exposure.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-444 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Define strict cache keys, avoid caching user-specific responses publicly, validate host and forwarding headers, and set appropriate Cache-Control headers. Validate origins, destinations, signatures, hosts, and replay windows at the trust boundary; avoid reflecting or trusting client-supplied routing metadata.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-69: Host Header Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Medium |
| CWE | CWE-20 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application trusts the Host or forwarded host headers when generating links, redirects, password reset URLs, or absolute references.

**Risk**

Attackers may poison links, perform phishing, bypass origin checks, or exploit cache and password reset flows.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-20 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Validate allowed hostnames at the edge and application layer, generate absolute URLs from trusted configuration, and reject unexpected forwarded host values. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-70: CSV Formula Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | Medium |
| CWE | CWE-1236 |
| OWASP | A03:2021 Injection |

**Behavior**

Exported CSV or spreadsheet files include user-controlled values that can be interpreted as formulas by spreadsheet applications.

**Risk**

Attackers may execute spreadsheet formulas that exfiltrate data, run commands in vulnerable clients, or mislead users opening exported reports.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-1236 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Prefix formula-like values with a safe escape character, sanitize values beginning with formula operators, and document safe export handling for downstream users. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-71: NoSQL Injection

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-943 |
| OWASP | A03:2021 Injection |

**Behavior**

User-controlled input is used to construct NoSQL queries without safe parameter handling or validation.

**Risk**

Attackers may bypass authentication, modify query logic, read unauthorized data, or alter database operations.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-943 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "raw\(|whereRaw|query\(|execute\(|FromSqlRaw|\.raw\(|extra\(|\$where|find\(req\.|filter=.*req" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Query construction

```bash
rg -n "whereRaw|raw\(|query\(|execute\(|FromSqlRaw|createQuery|\.raw\(|extra\(|\$where|\$regex|filter\s*=|find\(req\.|params\.|body\." src app server
```

  - Source review vulnerable result: User-controlled values are concatenated into query strings or operators without binding/type allowlisting.
  - Source review fixed result: Parameterized queries, ORM bind variables, strict DTO types, and allowlisted operators/fields are used.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/search?q=%27 HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"error":"SQL syntax error near ..."} 

or: result count/authentication behavior changes unexpectedly.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"results":[]}

or: HTTP 400 with a generic validation error and no backend query details.
```

Notes: Use harmless metacharacters and compare behavior with a normal value. Do not run destructive payloads.

**Safe Sample Verification / PoC**

- Input: Submit a harmless metacharacter such as a single quote in a search/login parameter in a test account.
- Command or action:

```bash
curl -i "https://app.example.test/search?q=%27"
```

- Expected vulnerable result: HTTP 500, database/LDAP error, changed result count, or different authentication behavior.
- Expected fixed result: HTTP 200/400 with a generic validation message; no backend error details; query logic unchanged.

**Remediation At Code Level**

Use safe query builders, validate expected data types, reject operators in user input where not intended, and apply least-privilege database accounts. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 500, database/LDAP error, changed result count, or different authentication behavior. Expected fixed signal: HTTP 200/400 with a generic validation message; no backend error details; query logic unchanged.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-72: GraphQL Introspection Exposed

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Secure design and operations |
| Severity | Low |
| CWE | CWE-200 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

GraphQL introspection is enabled in an environment where schema discovery should be restricted.

**Risk**

Attackers may enumerate types, queries, mutations, and hidden fields to plan targeted attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-200 and A05:2021 Security Misconfiguration. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Disable introspection in production where appropriate, require authentication for schema access, and enforce authorization on all resolvers regardless of schema visibility.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-73: GraphQL Authorization Bypass

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-862 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

GraphQL resolvers rely on front-end controls or top-level checks and fail to enforce authorization consistently across nested fields or mutations.

**Risk**

Attackers may access restricted objects, hidden fields, or privileged mutations by crafting custom GraphQL queries.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-862 and A01:2021 Broken Access Control. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Enforce authorization in every resolver and object relationship, apply depth and complexity limits, and add negative tests for nested data access. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-74: WebSocket Missing Authentication or Authorization

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-306 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

WebSocket connections or messages are accepted without proper authentication, session validation, or per-message authorization.

**Risk**

Attackers may subscribe to unauthorized channels, send privileged messages, or receive sensitive real-time data.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-306 and A01:2021 Broken Access Control. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Authenticate WebSocket handshakes, validate sessions throughout the connection lifecycle, authorize every message/channel, and close connections on logout or token expiry. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-75: OAuth Redirect URI Misconfiguration

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-601 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

OAuth or OIDC flows allow weak, wildcard, or user-controlled redirect URIs.

**Risk**

Attackers may steal authorization codes or tokens by redirecting users to attacker-controlled domains.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-601 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /account/change-email HTTP/1.1
Host: app.example.test
Cookie: session=TEST_SESSION
Content-Type: application/x-www-form-urlencoded

email=tester-new@example.test
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Email change succeeds without CSRF token, valid Origin/Referer, or bound OAuth state.
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden

Request rejected because CSRF/state value is missing, invalid, expired, or not bound to the session.
```

Notes: For OAuth/OIDC, verify state and PKCE where applicable. Do not use real identity-provider accounts for this check.

**Safe Sample Verification / PoC**

- Input: Repeat the state-changing request without CSRF/state token in a controlled test session.
- Command or action:

```bash
curl -i -X POST "https://app.example.test/account/change-email" -b "session=TEST" -d "email=test@example.test"
```

- Expected vulnerable result: Request succeeds without a valid anti-CSRF/state value or origin validation.
- Expected fixed result: Request fails with 403/400; valid token/state is single-use or session-bound where required.

**Remediation At Code Level**

Use exact redirect URI allowlists, avoid wildcards, bind authorization codes to clients with PKCE, and validate state parameters. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Request succeeds without a valid anti-CSRF/state value or origin validation. Expected fixed signal: Request fails with 403/400; valid token/state is single-use or session-bound where required.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-76: HTTP Parameter Pollution

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | Medium |
| CWE | CWE-235 |
| OWASP | A04:2021 Insecure Design |

**Behavior**

The application handles duplicate HTTP parameters inconsistently between frontend, backend, framework, or downstream services.

**Risk**

Attackers may bypass validation, alter business logic, override trusted values, or trigger unexpected authorization decisions.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-235 and A04:2021 Insecure Design. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Reject duplicate parameters for sensitive endpoints, define strict request schemas, normalize inputs before validation, and test framework-specific duplicate parameter behavior.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-77: Race Condition in Sensitive Workflow

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | High |
| CWE | CWE-362 |
| OWASP | A04:2021 Insecure Design |

**Behavior**

The application allows concurrent requests to perform a sensitive action multiple times or bypass state transitions.

**Risk**

Attackers may duplicate transactions, redeem benefits repeatedly, exceed limits, or bypass approval and inventory controls.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-362 and A04:2021 Insecure Design. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "rateLimit|throttle|limit|idempot|transaction|lock|mutex|regex|RegExp|complexity|depth|pagination|pageSize" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/transactions HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Idempotency-Key: TEST-KEY-001
Content-Type: application/json

{"amount":1,"currency":"MYR","target":"TEST_ACCOUNT"}
```

Expected vulnerable response or observation:

```http
Multiple rapid submissions create multiple state changes, excessive processing, or no rate-limit response.
```

Expected fixed response or observation:

```http
First request: HTTP 201 Created
Repeated same idempotency key: HTTP 200/409 with same result or duplicate rejected.
Excessive rate: HTTP 429 Too Many Requests.
```

Notes: Use low-value test transactions or non-financial test workflows. Agree concurrency/rate test limits before execution.

**Safe Sample Verification / PoC**

- Input: Send controlled repeated or concurrent requests in a test environment with agreed rate limits.
- Command or action:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.test/limited"; done
```

- Expected vulnerable result: No throttling, duplicate state changes, excessive query cost, or slow regex processing.
- Expected fixed result: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Remediation At Code Level**

Use atomic database transactions, row-level locking, idempotency keys, unique constraints, and server-side state transition checks for sensitive workflows.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: No throttling, duplicate state changes, excessive query cost, or slow regex processing. Expected fixed signal: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-78: Missing Re-Authentication for Sensitive Action

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-288 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Sensitive actions such as password change, email change, payment setup, MFA reset, or beneficiary updates can be performed without recent authentication.

**Risk**

An attacker with a stolen or unattended session may make high-impact account changes without additional verification.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-288 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Require recent re-authentication or step-up MFA for sensitive actions and invalidate active sessions after credential or MFA changes. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-79: Weak Password Reset Token

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-640 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

Password reset tokens are predictable, reusable, long-lived, not bound to a user session, or not invalidated after use.

**Risk**

Attackers may guess, replay, reuse, or capture reset tokens to take over user accounts.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-640 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Generate cryptographically random reset tokens, store only hashed tokens, enforce short expiry, bind tokens to the intended account, and invalidate tokens after first use or password change. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-80: OTP Brute Force or Reuse

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-307 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

One-time passwords can be guessed, reused, or submitted repeatedly without sufficient expiry, attempt limits, or transaction binding.

**Risk**

Attackers may bypass verification, authorize fraudulent actions, or complete account takeover flows.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-307 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Use short-lived OTPs, enforce strict attempt limits, invalidate OTPs after use, bind OTPs to a specific action/session, and monitor repeated failures. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-81: MFA Bypass via Alternate Flow

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Critical |
| CWE | CWE-287 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

An alternate login, recovery, API, mobile, legacy, or support flow allows account access without completing MFA.

**Risk**

Attackers may bypass MFA protections and gain unauthorized access using weaker authentication paths.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-287 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Enforce MFA centrally across all authentication and recovery flows, remove legacy bypass paths, and add negative tests for every login channel. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-82: OAuth State Parameter Missing or Not Validated

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-352 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

OAuth or OIDC authorization flows do not use a strong state parameter or fail to validate it on callback.

**Risk**

Attackers may perform login CSRF, account linking attacks, or authorization code injection against users.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-352 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /account/change-email HTTP/1.1
Host: app.example.test
Cookie: session=TEST_SESSION
Content-Type: application/x-www-form-urlencoded

email=tester-new@example.test
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Email change succeeds without CSRF token, valid Origin/Referer, or bound OAuth state.
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden

Request rejected because CSRF/state value is missing, invalid, expired, or not bound to the session.
```

Notes: For OAuth/OIDC, verify state and PKCE where applicable. Do not use real identity-provider accounts for this check.

**Safe Sample Verification / PoC**

- Input: Repeat the state-changing request without CSRF/state token in a controlled test session.
- Command or action:

```bash
curl -i -X POST "https://app.example.test/account/change-email" -b "session=TEST" -d "email=test@example.test"
```

- Expected vulnerable result: Request succeeds without a valid anti-CSRF/state value or origin validation.
- Expected fixed result: Request fails with 403/400; valid token/state is single-use or session-bound where required.

**Remediation At Code Level**

Generate unpredictable state values, bind them to the user's session, validate them exactly on callback, and expire them after use. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Request succeeds without a valid anti-CSRF/state value or origin validation. Expected fixed signal: Request fails with 403/400; valid token/state is single-use or session-bound where required.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-83: SAML Assertion Validation Weakness

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Authentication and session |
| Severity | Critical |
| CWE | CWE-347 |
| OWASP | A07:2021 Identification and Authentication Failures |

**Behavior**

The application accepts SAML assertions without strict signature, audience, issuer, expiry, recipient, or replay validation.

**Risk**

Attackers may forge or replay assertions to impersonate users or gain unauthorized access.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-347 and A07:2021 Identification and Authentication Failures. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Require signed assertions or responses as appropriate, validate issuer/audience/recipient/time conditions, reject unsigned critical elements, prevent replay, and use a maintained SAML library. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-84: Missing Authorization on Administrative Function

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Critical |
| CWE | CWE-862 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

Administrative or privileged application functions are reachable by non-admin users through direct URL or API access.

**Risk**

Attackers may modify users, configurations, approvals, reports, or security-sensitive business data.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-862 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Apply centralized server-side authorization for every administrative route and API, deny by default, and test each privileged function with low-privilege accounts. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-85: Tenant Isolation Bypass

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | Critical |
| CWE | CWE-639 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

A user from one tenant, department, branch, or business unit can access or modify data belonging to another tenant or partition.

**Risk**

Cross-tenant data exposure or modification may cause major confidentiality, regulatory, and business impact.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-639 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Enforce tenant scoping in every query and authorization policy, derive tenant context from trusted server-side identity, and add cross-tenant regression tests. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-86: Client-Side Authorization Enforcement

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Access control |
| Severity | High |
| CWE | CWE-602 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

The application relies on frontend controls, hidden fields, disabled buttons, or route guards to enforce authorization.

**Risk**

Attackers may call backend endpoints directly or modify client state to perform unauthorized actions.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-602 and A01:2021 Broken Access Control. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Treat client checks as usability only; enforce authorization server-side for every request and remove trust in client-supplied role, tenant, or permission values. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-87: Prototype Pollution

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-1321 |
| OWASP | A03:2021 Injection |

**Behavior**

User-controlled object keys can modify JavaScript object prototypes through unsafe merge, clone, or path assignment operations.

**Risk**

Attackers may alter application behavior, bypass checks, cause denial of service, or contribute to code execution depending on usage.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-1321 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Block dangerous keys such as __proto__, prototype, and constructor, use safe merge libraries, validate object schemas, and keep dependencies updated. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-88: Regular Expression Denial of Service

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Secure design and operations |
| Severity | Medium |
| CWE | CWE-1333 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

The application uses vulnerable regular expressions that can cause excessive CPU consumption with crafted input.

**Risk**

Attackers may degrade service availability by submitting inputs that trigger catastrophic backtracking.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-1333 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Replace vulnerable regex patterns, limit input length, use safe regex engines or timeouts, and add tests for worst-case inputs.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-89: Unsafe File Preview Rendering

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-79 |
| OWASP | A03:2021 Injection |

**Behavior**

Uploaded or downloaded files are previewed inline without safe content handling, sandboxing, or strict MIME controls.

**Risk**

Attackers may execute active content, trigger XSS, steal data, or abuse browser parsing through malicious HTML, SVG, PDF, or office-like content.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-79 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message" src app client
rg -n "upload|download|multer|IFormFile|MultipartFile|sendFile|readFile|writeFile|path\.join|Storage::|ActiveStorage" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Rendering and DOM sinks

```bash
rg -n "innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrust|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message|markdown|sanitize" src app client resources
```

  - Source review vulnerable result: Untrusted data reaches raw HTML/DOM/Markdown/message sinks without context encoding or allowlist sanitization.
  - Source review fixed result: Data is rendered as text, sanitized with an allowlist where rich content is required, and origin/schema checks exist.

- File path and content handling

```bash
rg -n "upload|download|multer|busboy|IFormFile|MultipartFile|sendFile|readFile|writeFile|createReadStream|path\.join|path\.resolve|Storage::|ActiveStorage|Content-Disposition|Content-Type" src app server
```

  - Source review vulnerable result: User-controlled filenames/paths/MIME types are trusted or file authorization is missing.
  - Source review fixed result: Server-generated filenames, base-directory checks, MIME signature validation, safe headers, and object authorization exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/comments HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"comment":"<b>KB_TEST</b>"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Follow-up page renders KB_TEST as active HTML or places it in an unsafe DOM sink.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK

Follow-up page displays the literal text "<b>KB_TEST</b>" or sanitized allowlisted formatting only.
```

Notes: For Markdown/rich text, clarify whether limited formatting is allowed. The fixed result should match the product requirement, not simply strip all text.

**Safe Sample Verification / PoC**

- Input: Use a benign marker string such as <b>KB_TEST</b> or a non-executing HTML tag in a test field.
- Command or action:

```bash
rg -n "dangerouslySetInnerHTML|innerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|markdown" src app resources
```

- Expected vulnerable result: The marker renders as active markup or reaches a dangerous DOM sink without sanitization.
- Expected fixed result: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Remediation At Code Level**

Serve untrusted files with safe Content-Type and Content-Disposition, disable script execution, sandbox previews, validate MIME signatures, and isolate file rendering domains where possible. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The marker renders as active markup or reaches a dangerous DOM sink without sanitization. Expected fixed signal: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-90: Insecure Markdown Rendering

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Injection and unsafe parsing |
| Severity | High |
| CWE | CWE-79 |
| OWASP | A03:2021 Injection |

**Behavior**

Markdown content is rendered to HTML without sanitizing embedded HTML, links, images, or script-capable elements.

**Risk**

Attackers may inject scripts, malicious links, tracking pixels, or deceptive content into pages viewed by other users.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-79 and A03:2021 Injection. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace every path where user input reaches an interpreter, parser, query builder, serializer, shell, or template engine.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message" src app client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Rendering and DOM sinks

```bash
rg -n "innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrust|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message|markdown|sanitize" src app client resources
```

  - Source review vulnerable result: Untrusted data reaches raw HTML/DOM/Markdown/message sinks without context encoding or allowlist sanitization.
  - Source review fixed result: Data is rendered as text, sanitized with an allowlist where rich content is required, and origin/schema checks exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/comments HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"comment":"<b>KB_TEST</b>"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Follow-up page renders KB_TEST as active HTML or places it in an unsafe DOM sink.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK

Follow-up page displays the literal text "<b>KB_TEST</b>" or sanitized allowlisted formatting only.
```

Notes: For Markdown/rich text, clarify whether limited formatting is allowed. The fixed result should match the product requirement, not simply strip all text.

**Safe Sample Verification / PoC**

- Input: Use a benign marker string such as <b>KB_TEST</b> or a non-executing HTML tag in a test field.
- Command or action:

```bash
rg -n "dangerouslySetInnerHTML|innerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|markdown" src app resources
```

- Expected vulnerable result: The marker renders as active markup or reaches a dangerous DOM sink without sanitization.
- Expected fixed result: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Remediation At Code Level**

Use a hardened Markdown renderer, disable raw HTML when possible, sanitize output with an allowlist sanitizer, validate links, and apply CSP as defense-in-depth. Replace string concatenation with structured APIs, parameterized queries, allowlists, safe parsers, and least-privilege runtime accounts.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The marker renders as active markup or reaches a dangerous DOM sink without sanitization. Expected fixed signal: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Recommended Review Flow**

```text
Untrusted input -> schema validation -> safe structured API/parser -> encoded output or parameterized execution -> monitored failure handling
```

### kb-91: Insecure postMessage Handling

| Field | Value |
| --- | --- |
| Domain | Web |
| Family | Client-side and content rendering |
| Severity | Medium |
| CWE | CWE-346 |
| OWASP | A05:2021 Security Misconfiguration |

**Behavior**

Client-side code accepts window postMessage events without strict origin, source, and message schema validation.

**Risk**

Malicious pages may send crafted messages that trigger sensitive actions, data leakage, or DOM-based injection.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-346 and A05:2021 Security Misconfiguration. Inspect controllers/routes, middleware, template rendering, client-side sinks, and storage/download handlers. Trace untrusted data from source to DOM/template sink and verify context-aware encoding or sanitization.

**Source Code Review Targets**

Routes/controllers, middleware, template/view layer, frontend components, file handlers, authentication/session modules, authorization policies, export/report code, HTTP client/integration code.

**Useful Search Commands**

```bash
rg -n "innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message" src app client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Rendering and DOM sinks

```bash
rg -n "innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html|bypassSecurityTrust|Html\.Raw|\|safe|html_safe|postMessage|addEventListener\(.*message|markdown|sanitize" src app client resources
```

  - Source review vulnerable result: Untrusted data reaches raw HTML/DOM/Markdown/message sinks without context encoding or allowlist sanitization.
  - Source review fixed result: Data is rendered as text, sanitized with an allowlist where rich content is required, and origin/schema checks exist.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/comments HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"comment":"<b>KB_TEST</b>"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Follow-up page renders KB_TEST as active HTML or places it in an unsafe DOM sink.
```

Expected fixed response or observation:

```http
HTTP/1.1 200 OK

Follow-up page displays the literal text "<b>KB_TEST</b>" or sanitized allowlisted formatting only.
```

Notes: For Markdown/rich text, clarify whether limited formatting is allowed. The fixed result should match the product requirement, not simply strip all text.

**Safe Sample Verification / PoC**

- Input: Use a benign marker string such as <b>KB_TEST</b> or a non-executing HTML tag in a test field.
- Command or action:

```bash
rg -n "dangerouslySetInnerHTML|innerHTML|v-html|bypassSecurityTrustHtml|Html\.Raw|\|safe|html_safe|markdown" src app resources
```

- Expected vulnerable result: The marker renders as active markup or reaches a dangerous DOM sink without sanitization.
- Expected fixed result: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Remediation At Code Level**

Validate event.origin against an allowlist, verify event.source where appropriate, enforce strict message schemas, and avoid passing message data into dangerous sinks. Encode by output context, sanitize rich content with an allowlist, remove dangerous sinks, and use CSP as defense-in-depth.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The marker renders as active markup or reaches a dangerous DOM sink without sanitization. Expected fixed signal: The marker is encoded as text or sanitized according to an allowlist; CSP blocks unexpected active content.

**Recommended Review Flow**

```text
Untrusted source -> validation/sanitization -> context-aware encoding -> safe DOM/template sink -> CSP/reporting
```

### kb-92: Cross-Origin WebSocket Hijacking

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-346 |
| OWASP | A01:2021 Broken Access Control |

**Behavior**

WebSocket endpoints rely on cookies for authentication but do not validate the Origin header or apply anti-CSRF style protections.

**Risk**

A malicious website may open authenticated WebSocket connections from a victim browser and perform unauthorized actions or read messages.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-346 and A01:2021 Broken Access Control. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Exercise the affected function with a low-privilege test account and controlled non-sensitive input.
- Command or action:

```bash
rg -n "TODO|FIXME|debug|password|token|secret|authorize|permission|validate" src app server client
```

- Expected vulnerable result: The application accepts, stores, returns, or trusts data in the risky way described by the finding.
- Expected fixed result: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Remediation At Code Level**

Validate Origin during the WebSocket handshake, require explicit bearer tokens or CSRF tokens, authorize channels, and close connections when sessions expire. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: The application accepts, stores, returns, or trusts data in the risky way described by the finding. Expected fixed signal: Server-side validation, authorization, logging, and tests enforce the expected secure behavior.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-93: GraphQL Query Depth or Complexity Missing

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Availability and abuse protection |
| Severity | Medium |
| CWE | CWE-400 |
| OWASP | API4:2023 Unrestricted Resource Consumption |

**Behavior**

GraphQL APIs accept deeply nested or computationally expensive queries without depth, complexity, pagination, or cost limits.

**Risk**

Attackers may cause excessive CPU, memory, database load, or denial of service through expensive queries.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-400 and API4:2023 Unrestricted Resource Consumption. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "rateLimit|throttle|limit|idempot|transaction|lock|mutex|regex|RegExp|complexity|depth|pagination|pageSize" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/transactions HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Idempotency-Key: TEST-KEY-001
Content-Type: application/json

{"amount":1,"currency":"MYR","target":"TEST_ACCOUNT"}
```

Expected vulnerable response or observation:

```http
Multiple rapid submissions create multiple state changes, excessive processing, or no rate-limit response.
```

Expected fixed response or observation:

```http
First request: HTTP 201 Created
Repeated same idempotency key: HTTP 200/409 with same result or duplicate rejected.
Excessive rate: HTTP 429 Too Many Requests.
```

Notes: Use low-value test transactions or non-financial test workflows. Agree concurrency/rate test limits before execution.

**Safe Sample Verification / PoC**

- Input: Send controlled repeated or concurrent requests in a test environment with agreed rate limits.
- Command or action:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.test/limited"; done
```

- Expected vulnerable result: No throttling, duplicate state changes, excessive query cost, or slow regex processing.
- Expected fixed result: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Remediation At Code Level**

Enforce query depth and complexity limits, require pagination, disable batching abuse, and monitor resolver cost and error rates.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: No throttling, duplicate state changes, excessive query cost, or slow regex processing. Expected fixed signal: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-94: API Broken Function Level Authorization

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-862 |
| OWASP | API5:2023 Broken Function Level Authorization |

**Behavior**

API endpoints expose privileged functions without checking whether the authenticated user is allowed to perform that operation.

**Risk**

Attackers may invoke administrative, approval, export, or configuration functions beyond their assigned role.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-862 and API5:2023 Broken Function Level Authorization. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Map each API function to explicit permissions, enforce role and context checks server-side, and test low-privilege users against privileged endpoints. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-95: API Unrestricted Access to Sensitive Business Flow

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-840 |
| OWASP | API6:2023 Unrestricted Access to Sensitive Business Flows |

**Behavior**

APIs expose business workflows such as approval, transfer, refund, enrollment, or limit updates without sufficient workflow and authorization controls.

**Risk**

Attackers may abuse legitimate API functions to perform fraudulent or unauthorized business actions.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-840 and API6:2023 Unrestricted Access to Sensitive Business Flows. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Enforce business rules and state transitions server-side, require step-up verification for sensitive operations, and add abuse monitoring for high-risk API flows. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-96: Webhook Signature Verification Missing

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Protocol, integration, and trust boundary |
| Severity | High |
| CWE | CWE-345 |
| OWASP | API8:2023 Security Misconfiguration |

**Behavior**

Webhook endpoints accept inbound events without verifying a cryptographic signature, timestamp, nonce, or trusted sender proof.

**Risk**

Attackers may forge payment, identity, notification, or workflow events and alter application state.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-345 and API8:2023 Security Misconfiguration. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/import-url HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Content-Type: application/json

{"url":"https://example.test/allowed-sample.json"}
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK

Server fetches arbitrary user-supplied destinations or accepts unsigned webhook messages.
```

Expected fixed response or observation:

```http
HTTP/1.1 400 Bad Request

{"error":"Destination is not allowed"}

or webhook is rejected because signature/timestamp validation fails.
```

Notes: Use only controlled destinations. Confirm redirects are revalidated and private/link-local destinations are blocked.

**Safe Sample Verification / PoC**

- Input: Submit a URL or webhook event using a controlled internal/test destination and observe server-side fetch/acceptance behavior.
- Command or action:

```bash
curl -i -X POST "https://app.example.test/import-url" -d "url=https://example.test/file.json"
```

- Expected vulnerable result: Server fetches untrusted destinations or accepts unsigned/untrusted integration messages.
- Expected fixed result: Only allowlisted destinations/providers are accepted; signatures and replay windows are enforced.

**Remediation At Code Level**

Verify provider signatures using constant-time comparison, validate timestamps and replay windows, require HTTPS, and log rejected webhook attempts. Validate origins, destinations, signatures, hosts, and replay windows at the trust boundary; avoid reflecting or trusting client-supplied routing metadata.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Server fetches untrusted destinations or accepts unsigned/untrusted integration messages. Expected fixed signal: Only allowlisted destinations/providers are accepted; signatures and replay windows are enforced.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-97: Missing Idempotency on Transaction API

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | Medium |
| CWE | CWE-841 |
| OWASP | API6:2023 Unrestricted Access to Sensitive Business Flows |

**Behavior**

Transaction or state-changing APIs process repeated submissions as separate operations instead of detecting safe retries.

**Risk**

Users or attackers may accidentally or intentionally create duplicate payments, orders, approvals, or records.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-841 and API6:2023 Unrestricted Access to Sensitive Business Flows. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "rateLimit|throttle|limit|idempot|transaction|lock|mutex|regex|RegExp|complexity|depth|pagination|pageSize" src app server
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
POST /api/transactions HTTP/1.1
Host: app.example.test
Authorization: Bearer TEST_TOKEN
Idempotency-Key: TEST-KEY-001
Content-Type: application/json

{"amount":1,"currency":"MYR","target":"TEST_ACCOUNT"}
```

Expected vulnerable response or observation:

```http
Multiple rapid submissions create multiple state changes, excessive processing, or no rate-limit response.
```

Expected fixed response or observation:

```http
First request: HTTP 201 Created
Repeated same idempotency key: HTTP 200/409 with same result or duplicate rejected.
Excessive rate: HTTP 429 Too Many Requests.
```

Notes: Use low-value test transactions or non-financial test workflows. Agree concurrency/rate test limits before execution.

**Safe Sample Verification / PoC**

- Input: Send controlled repeated or concurrent requests in a test environment with agreed rate limits.
- Command or action:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.test/limited"; done
```

- Expected vulnerable result: No throttling, duplicate state changes, excessive query cost, or slow regex processing.
- Expected fixed result: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Remediation At Code Level**

Require idempotency keys for retryable sensitive operations, store request fingerprints and final results, and reject conflicting duplicate submissions. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: No throttling, duplicate state changes, excessive query cost, or slow regex processing. Expected fixed signal: Rate limits, idempotency, locks, complexity limits, or input caps prevent abuse.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-98: API Trusts Client-Supplied Device or Channel Identifier

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | Medium |
| CWE | CWE-807 |
| OWASP | API10:2023 Unsafe Consumption of APIs |

**Behavior**

The backend trusts client-controlled device IDs, channel flags, platform names, or application versions for authorization or risk decisions.

**Risk**

Attackers may spoof trusted devices or channels to bypass controls, limits, or verification steps.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-807 and API10:2023 Unsafe Consumption of APIs. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "validate|sanitize|authorize|permission|token|secret|debug|TODO|FIXME" src app server client mobile
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /affected/feature HTTP/1.1
Host: app.example.test
Authorization: Bearer LOW_PRIVILEGE_TEST_TOKEN
```

Expected vulnerable response or observation:

```http
HTTP 2xx response or application behavior demonstrates the risky condition described by the finding.
```

Expected fixed response or observation:

```http
Request is rejected, sanitized, rate-limited, or handled safely according to the finding recommendation.
```

Notes: Adapt the route and body to the affected feature. Keep test data non-sensitive and controlled.

**Safe Sample Verification / PoC**

- Input: Submit a URL or webhook event using a controlled internal/test destination and observe server-side fetch/acceptance behavior.
- Command or action:

```bash
curl -i -X POST "https://app.example.test/import-url" -d "url=https://example.test/file.json"
```

- Expected vulnerable result: Server fetches untrusted destinations or accepts unsigned/untrusted integration messages.
- Expected fixed result: Only allowlisted destinations/providers are accepted; signatures and replay windows are enforced.

**Remediation At Code Level**

Derive trust from server-side enrollment, signed device attestations where appropriate, secure session binding, and risk signals that cannot be freely modified by the client. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Server fetches untrusted destinations or accepts unsigned/untrusted integration messages. Expected fixed signal: Only allowlisted destinations/providers are accepted; signatures and replay windows are enforced.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-99: API Pagination or Filtering Authorization Bypass

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-639 |
| OWASP | API1:2023 Broken Object Level Authorization |

**Behavior**

API list, search, export, or filter endpoints return records outside the caller's authorized scope when query parameters are modified.

**Risk**

Attackers may enumerate or export unauthorized records at scale.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-639 and API1:2023 Broken Object Level Authorization. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Apply authorization before pagination, sorting, filtering, and export; derive scope from the authenticated user; and test broad query combinations for data leakage. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-100: API Batch Endpoint Authorization Bypass

| Field | Value |
| --- | --- |
| Domain | API |
| Family | Access control |
| Severity | High |
| CWE | CWE-862 |
| OWASP | API1:2023 Broken Object Level Authorization |

**Behavior**

Batch APIs validate only the outer request and fail to authorize each individual operation or object in the batch.

**Risk**

Attackers may include unauthorized object IDs or privileged operations inside otherwise valid batch requests.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-862 and API1:2023 Broken Object Level Authorization. Inspect route handlers, service methods, DTO/schema validation, resolver/message authorization, and integration verification. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

API route/controller, middleware/guards, DTO/schema validators, service layer, resolver/subscription handlers, repository/query layer, integration/webhook verification, rate-limit middleware.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Authorize every item and operation inside batch requests, reject partial unauthorized batches where appropriate, and log failed item-level authorization checks. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-101: Mobile Insecure Keychain or Keystore Accessibility

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Access control |
| Severity | High |
| CWE | CWE-922 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

The mobile application stores sensitive secrets with weak Keychain or Keystore accessibility settings or without hardware-backed protection where available.

**Risk**

Secrets may be extracted from backups, migrated to other devices, or accessed under weaker device states than intended.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-922 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "authorize|permission|policy|role|tenant|ownerId|userId|findById|params\.id|req\.params|@PreAuthorize|\[Authorize\]" src app server
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Object and function authorization

```bash
rg -n "params\.id|req\.params|findById|findOne|where\(|ownerId|tenantId|accountId|role|isAdmin|authorize|policy|guard|@PreAuthorize|\[Authorize\]" src app server
```

  - Source review vulnerable result: Objects are loaded directly by request ID or privileged actions execute without checking actor/action/object/tenant.
  - Source review fixed result: Object lookup is scoped to the authenticated actor/tenant and every sensitive function checks explicit permission.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
GET /api/accounts/USER_B_OBJECT_ID HTTP/1.1
Host: app.example.test
Authorization: Bearer USER_A_TEST_TOKEN
Accept: application/json
```

Expected vulnerable response or observation:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"USER_B_OBJECT_ID","owner":"user-b","balance":"REDACTED"}
```

Expected fixed response or observation:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"Forbidden"}
```

Notes: Use two authorized test users. USER_A must not be allowed to read USER_B data. A consistent 404 is also acceptable when the application intentionally hides object existence.

**Safe Sample Verification / PoC**

- Input: Use two test users with different roles or tenants and attempt to access user B data with user A session.
- Command or action:

```bash
curl -i -H "Authorization: Bearer USER_A_TOKEN" "https://api.example.test/resource/USER_B_OBJECT_ID"
```

- Expected vulnerable result: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource.
- Expected fixed result: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Remediation At Code Level**

Use iOS Keychain classes such as ThisDeviceOnly for sensitive tokens, Android Keystore-backed keys, biometric/keyguard constraints where appropriate, and avoid backup-migratable storage for high-risk secrets. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: HTTP 200/2xx returns or modifies another user, tenant, or role-protected resource. Expected fixed signal: HTTP 403 or consistent 404; no sensitive fields returned; denial is logged for review.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-102: Mobile Sensitive Data in Push Notification

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | Medium |
| CWE | CWE-200 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

Push notifications contain sensitive personal, financial, authentication, or transaction information in the notification title, body, or payload.

**Risk**

Sensitive data may be visible on locked screens, notification logs, wearable devices, or third-party notification services.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-200 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Send only minimal non-sensitive notification content, fetch sensitive details after authenticated app open, and configure lock-screen privacy behavior. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-103: Mobile Keyboard Cache Exposure

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Protocol, integration, and trust boundary |
| Severity | Low |
| CWE | CWE-524 |
| OWASP | M9:2024 Insecure Data Storage |

**Behavior**

Sensitive fields allow keyboard prediction, autocorrect, screenshots, or caching of entered secrets and personal data.

**Risk**

Sensitive values may be retained by keyboard services or exposed through suggestions and cached input history.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-524 and M9:2024 Insecure Data Storage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|cors|Access-Control|Host|X-Forwarded|Cache-Control|WebSocket|ws\(" src app server
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Boundary and integration trust

```bash
rg -n "fetch\(|axios|request\(|http\.get|webhook|signature|HMAC|cors|Access-Control|Origin|Host|X-Forwarded|Cache-Control|WebSocket|ws\(|redirect" src app server
```

  - Source review vulnerable result: Client-supplied URL/origin/host/signature data is trusted directly or external events are accepted unsigned.
  - Source review fixed result: Allowlists, signature checks, origin validation, replay protection, and safe cache/CORS rules are enforced.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Disable suggestions, autocorrect, and learning for sensitive fields; use secure input types; and avoid custom keyboards for password, OTP, and secret fields where possible. Validate origins, destinations, signatures, hosts, and replay windows at the trust boundary; avoid reflecting or trusting client-supplied routing metadata.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Input/event -> validate schema -> enforce trust boundary -> perform least-privilege action -> log and monitor
```

### kb-104: Mobile Android Task Hijacking

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-1021 |
| OWASP | M8:2024 Security Misconfiguration |

**Behavior**

Android activity launch modes, task affinity, or exported activity settings allow another application to place a malicious activity in the same task flow.

**Risk**

Attackers may phish credentials, intercept user actions, or confuse users with malicious screens that appear inside the legitimate app flow.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-1021 and M8:2024 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Review taskAffinity and launchMode settings, avoid unnecessary exported activities, validate deep link origins, and use modern Android task and back-stack protections. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-105: Mobile Tapjacking or Overlay Attack Exposure

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-1021 |
| OWASP | M4:2024 Insufficient Input/Output Validation |

**Behavior**

Sensitive mobile screens or actions can be obscured or manipulated by overlays or untrusted windows.

**Risk**

Attackers may trick users into approving actions, entering credentials, or changing settings unintentionally.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-1021 and M4:2024 Insufficient Input/Output Validation. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Detect and block obscured touches on sensitive Android views, restrict overlay-sensitive workflows, and add confirmation or step-up checks for high-risk actions. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-106: Mobile Custom URL Scheme Hijacking

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | High |
| CWE | CWE-939 |
| OWASP | M4:2024 Insufficient Input/Output Validation |

**Behavior**

The mobile application uses custom URL schemes that can be registered or intercepted by another application.

**Risk**

Attackers may capture OAuth redirects, tokens, deep link parameters, or misdirect users into malicious flows.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-939 and M4:2024 Insufficient Input/Output Validation. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use Android App Links and iOS Universal Links with verified domains where possible, avoid secrets in URLs, validate link parameters, and require server-side confirmation for sensitive actions. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-107: Mobile Insecure Firebase or Backend Configuration

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Access control |
| Severity | High |
| CWE | CWE-284 |
| OWASP | M8:2024 Security Misconfiguration |

**Behavior**

Mobile backend configuration such as Firebase, storage buckets, realtime databases, or remote config allows excessive read/write access from the client.

**Risk**

Attackers may read, modify, or delete application data directly through backend services used by the mobile app.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-284 and M8:2024 Security Misconfiguration. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Use at least two users/roles/tenants; verify every object/action server-side, not only through UI behavior.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Enforce strict backend security rules, require authenticated and authorized access, avoid client-side trust, review public storage rules, and test rules with low-privilege accounts. Centralize authorization, deny by default, scope every object query by authenticated actor/tenant, and add negative tests for horizontal and vertical access.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
User request -> authenticate -> load target object -> authorize actor against object/action/tenant -> perform action -> audit decision
```

### kb-108: Mobile Debug Symbols or Source Maps Exposed

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-540 |
| OWASP | M7:2024 Insufficient Binary Protections |

**Behavior**

Production mobile builds include debug symbols, source maps, verbose metadata, or readable bundled source that exposes implementation details.

**Risk**

Attackers can reverse engineer business logic, identify hidden endpoints, discover secrets, and build more targeted attacks.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-540 and M7:2024 Insufficient Binary Protections. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Strip debug symbols from release builds, restrict source map distribution, obfuscate where appropriate, and ensure build pipelines separate debug and production artifacts. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```

### kb-109: Mobile Insecure Local Authentication Fallback

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Authentication and session |
| Severity | High |
| CWE | CWE-287 |
| OWASP | M1:2024 Improper Credential Usage |

**Behavior**

The mobile application allows weak fallback authentication such as device PIN, local flag changes, or insecure recovery paths for sensitive in-app actions.

**Risk**

Attackers with device access or runtime tampering capability may bypass strong authentication and access protected functions.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-287 and M1:2024 Improper Credential Usage. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions. Review all login, recovery, token refresh, logout, and alternate channel flows for central enforcement.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "login|logout|password|reset|otp|mfa|jwt|refresh|session|oauth|saml|state|redirect_uri|SameSite|HttpOnly|Secure" src app server client
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Authentication and session lifecycle

```bash
rg -n "login|logout|password|reset|otp|mfa|totp|jwt|refresh|session|cookie|SameSite|HttpOnly|Secure|oauth|saml|state|redirect_uri|pkce" src app server client
```

  - Source review vulnerable result: Alternate auth flow skips central checks, weak token validation is present, or logout/reset does not revoke active credentials.
  - Source review fixed result: All auth paths call shared validators, claims are strictly verified, and sessions/tokens rotate or revoke on security events.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Use platform biometric APIs securely, bind local authentication to cryptographic operations where appropriate, require backend authorization for sensitive actions, and avoid trusting local boolean flags. Centralize authentication enforcement, use short-lived tokens, rotate/revoke sessions on security events, and require step-up verification for high-risk actions.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Credential/session input -> central auth validator -> risk/step-up checks -> token/session issuance or rejection -> audit event
```

### kb-110: Mobile Insecure Third-Party SDK Data Collection

| Field | Value |
| --- | --- |
| Domain | Mobile |
| Family | Mobile platform |
| Severity | Medium |
| CWE | CWE-359 |
| OWASP | M2:2024 Inadequate Supply Chain Security |

**Behavior**

The mobile application includes analytics, crash reporting, advertising, or monitoring SDKs that collect or transmit sensitive data without sufficient minimization or controls.

**Risk**

Sensitive data may be disclosed to third parties, retained unexpectedly, or violate privacy and regulatory requirements.

**How To Identify**

Confirm the affected route, API, screen, component, or mobile flow. Map the finding to CWE-359 and M2:2024 Inadequate Supply Chain Security. Inspect release build configuration, platform manifests/plists, local storage, network layer, WebView/bridge code, and backend trust decisions.

**Source Code Review Targets**

AndroidManifest.xml, network_security_config.xml, Info.plist, entitlements, Kotlin/Java/Swift/Objective-C sources, React Native/Flutter bridge code, mobile HTTP client, local storage wrapper, CI release build config.

**Useful Search Commands**

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|Keychain|Keystore|UserDefaults|SharedPreferences|WebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

**Source Code Grep Variants And Expected Result**

- Generic risky markers

```bash
rg -n "TODO|FIXME|debug|password|token|secret|apikey|api_key|private_key|console\.log|print\(|NSLog|Log\." .
```

  - Source review vulnerable result: Secrets, debug traces, sensitive logs, or unfinished security decisions appear in production code paths.
  - Source review fixed result: No production secrets or sensitive debug output; any TODO/FIXME is not security-impacting or is tracked for remediation.

- Validation and authorization flow

```bash
rg -n "validate|schema|sanitize|authorize|permission|policy|guard|role|tenant|owner|scope" src app server client
```

  - Source review vulnerable result: Affected route reaches business logic before schema validation or authorization is enforced.
  - Source review fixed result: Request is validated first, authorization is enforced before object access/action, and denial paths are explicit.

- Mobile platform configuration and secrets

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|networkSecurityConfig|NSAppTransportSecurity|Keychain|Keystore|UserDefaults|SharedPreferences|SQLite|Realm|WebView|WKWebView|addJavascriptInterface|Firebase|UIPasteboard|Clipboard|Biometric|LAContext|Log\.|print\(|console\.log|http://" android ios lib src
```

  - Source review vulnerable result: Release build exposes weak platform config, insecure storage, unsafe WebView/IPC/deep-link handling, or sensitive logs.
  - Source review fixed result: Release build is hardened; secrets use Keychain/Keystore; WebView/IPC/deep links are constrained; backend verifies sensitive actions.

**Request / Response Example Where Applicable**

Request or mobile action:

```http
Mobile app action:
1. Login with a test user.
2. Perform the affected mobile workflow.
3. Observe local storage/logs/network request in an authorized test setup.

Representative backend request:
POST /api/mobile/action HTTP/1.1
Authorization: Bearer MOBILE_TEST_TOKEN
X-Device-Id: TEST_DEVICE_ID
```

Expected vulnerable response or observation:

```http
Sensitive data appears in local logs/storage/clipboard, cleartext traffic is allowed, unsafe deep link/WebView/IPC behavior is triggered, or backend trusts spoofable client state.
```

Expected fixed response or observation:

```http
Sensitive data is absent from insecure local surfaces, TLS/platform controls are enforced, and backend authorization rejects spoofed/tampered client state.
```

Notes: Mobile findings often require both static review and runtime observation. Treat local client checks as defense-in-depth; backend must enforce sensitive decisions.

**Safe Sample Verification / PoC**

- Input: Review the release APK/IPA and exercise the sensitive mobile workflow on a test account/device.
- Command or action:

```bash
rg -n "debuggable|allowBackup|usesCleartextTraffic|WebView|addJavascriptInterface|Keychain|UserDefaults|SharedPreferences|Log\.|print\(|console\.log|http://" android ios lib src
```

- Expected vulnerable result: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present.
- Expected fixed result: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Remediation At Code Level**

Review SDK data collection, disable sensitive event capture, mask identifiers, obtain required consent, restrict SDK environments, and document approved data flows. Harden release configuration, move trust decisions server-side, store secrets in platform secure storage, and validate sensitive mobile workflows against backend authorization.

**Regression Test / Closure Evidence**

Add automated or documented regression tests proving the vulnerable result no longer occurs. Expected vulnerable signal: Sensitive data, weak platform configuration, unsafe bridge, or client-only trust is present. Expected fixed signal: Release configuration is hardened; secrets are in Keychain/Keystore; server verifies sensitive actions.

**Recommended Review Flow**

```text
Mobile action -> platform control/local hardening -> secure storage/network call -> backend authorization -> server-side decision
```


## Closure Checklist

- Vulnerable behavior is reproduced in a controlled environment or source-code evidence is sufficient.
- Root cause is fixed at the correct enforcement point.
- Sensitive logs, screenshots, tokens, and customer data are redacted.
- Regression test or documented retest proves the fixed behavior.
- Risk owner accepts residual risk only when compensating controls are documented.
- KB entry, report wording, and remediation evidence are updated if the issue pattern changes.
