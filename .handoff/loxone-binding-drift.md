# Handoff — Loxone Binding Drift Investigation

**Repo:** `meintechblog/mqtt-master` · **Local:** `/Users/hulki/codex/mqtt-master`
**Wohnwagen:** `ssh root@192.168.13.2 → pct exec 200` · **Both instances on SHA `0024763`**

## Open question
5 input bindings on `venus-os` (target = `knausi` Loxone plugin). Binding
stats report `sent=X` per Tasmota publish, but Loxone reports different
values for Wasserboiler/Außen/Kühlschrank/Dach/Essen. Direct write via
`/api/plugins/knausi/controls/<uuid>/cmd` with `99.9` persisted cleanly →
write path itself works.

## Already in `0024763`
- Trace log on every `jdev/sps/io/<uuid>/<value>` send (info level:
  `[loxone] → jdev/sps/io/…`)
- Warn log on dropped sends (`sendCommand DROPPED, readyState=…`)
- Bindings stats endpoint augmented with atomic `loxoneValue` from the
  same instant

## Tasks (in order)

1. **60 s trace recording:**
   ```bash
   ssh root@192.168.13.2 "pct exec 200 -- timeout 60 journalctl -u mqtt-master -f --no-pager -o cat" \
     | grep -E "jdev/sps/io|sendCommand DROPPED|Binding"
   ```
   Expectation per Tasmota cycle: 5 jdev/sps/io lines, one per binding.
   <5 or any DROP → real bug.

2. **Quantify drift over a few minutes:**
   ```bash
   ssh root@192.168.13.2 "pct exec 200 -- curl -s http://127.0.0.1/api/plugins/venus-os/bindings/stats" \
     | python3 -c "import sys,json; [print(s['jsonField'][:25].ljust(25),'sent=',s['value'],' loxone=',s.get('loxoneValue'),' diff=',round((s.get('loxoneValue') or 0)-(s['value'] or 0),2)) for s in json.load(sys.stdin)]"
   ```
   Systematic offset (always +0.2) → Loxone correction formula.
   Random scatter → race condition.

3. **Code review of send paths:**
   - `plugins/lib/binding-utils.js` ~80-140 (dedup + async sendToTarget)
   - `plugins/mqtt-bridge/plugin.js` ~165-200 (bridge → loxone forward)
   - `plugins/loxone/plugin.js` `sendControlCommand`, `peekControlValue`
   - `plugins/loxone/loxone-ws.js` `sendCommand` (with new tracing)

4. **Hypotheses, ranked:**
   - (a) Keepalive path forwards a stale cached value
   - (b) Race in mqtt-bridge sendToTarget: `await pm.listAll()` lets
     parallel handler runs interleave, packets reach Loxone out of order
   - (c) Loxone InfoOnlyAnalog has a Korrektur formula applied internally
     (we send 20.4 → Loxone displays 20.6)
   - (d) Tasmota burst-publishes multiple values; only first forwarded;
     `loxoneValue` reflects latest WS state event from a different sample

5. **Fix → atomic commits → push → auto-update both instances → docs update.**

## Skip rule
All 5 jdev/sps/io lines present AND diffs are random (not systematic) →
hypothesis (d), poll-vs-WS-cadence artefact. Then only clarify the UI,
no code bug.
Lines <5 OR DROP warnings → real bug, hunt it down.

## Bonus context
- Loxone LoxAPP3.json verified to NOT expose any "Bezeichnung" /
  description field for InfoOnlyAnalog (`details = {jLockable, format}`).
  User accepts this is a Loxone limitation.
- mqtt-master.local (192.168.3.213) is a dev rsync VM, dev mode,
  auto-update intentionally off. Do NOT touch.
- Auto-update on Wohnwagen runs at 03:00 Berlin Time, 23h cooldown.
