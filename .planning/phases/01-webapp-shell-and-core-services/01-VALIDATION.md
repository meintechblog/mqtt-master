---
phase: 1
slug: webapp-shell-and-core-services
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | None yet — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01 | 01 | 1 | UI-04 | smoke | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` returns 200 | ❌ W0 | ⬜ pending |
| 01-02 | 01 | 1 | — | integration | `npx vitest run tests/server.test.js` | ❌ W0 | ⬜ pending |
| 01-03 | 01 | 1 | — | unit | `npx vitest run tests/config-service.test.js` | ❌ W0 | ⬜ pending |
| 01-04 | 01 | 1 | — | unit | `npx vitest run tests/mqtt-service.test.js` | ❌ W0 | ⬜ pending |
| 01-05 | 02 | 1 | UI-01 | manual | Browser check — Venus OS CSS variables applied | N/A | ⬜ pending |
| 01-06 | 02 | 1 | UI-02 | manual | Browser check — sidebar nav items switch page | N/A | ⬜ pending |
| 01-07 | 02 | 1 | UI-03 | manual | Browser resize — layout adapts at 768px | N/A | ⬜ pending |
| 01-08 | 02 | 1 | — | unit | `npx vitest run tests/router.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.js` — test framework configuration
- [ ] `package.json` — must include vitest as devDependency
- [ ] `tests/server.test.js` — Fastify server starts and serves static files
- [ ] `tests/config-service.test.js` — Config loading with missing file, defaults, deep merge
- [ ] `tests/mqtt-service.test.js` — Connection handling, reconnection, event emission
- [ ] `tests/router.test.js` — Hash router maps routes to correct page components

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Venus OS theme renders correctly | UI-01 | CSS variables are runtime, visual verification needed | Open browser, verify dark background (#141414), sidebar (#272622), text colors match spec |
| Sidebar navigation switches pages | UI-02 | DOM interaction required | Click each nav item, verify page content changes |
| Responsive layout at breakpoints | UI-03 | Browser resize required | Resize to <768px, verify hamburger appears, sidebar collapses |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
