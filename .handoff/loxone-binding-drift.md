# Handoff — Loxone Binding Drift Investigation — RESOLVED

**Repo:** `meintechblog/mqtt-master` · **Local:** `/Users/hulki/codex/mqtt-master`
**Wohnwagen:** `ssh root@192.168.13.2 → pct exec 200` · **Both instances on SHA `16f4081`**

## Outcome

Drift between `sent` and `loxoneValue` was **0.000** across all 5 bindings
after the fixes shipped. Five consecutive 25 s probes after restart:

```
Wasserboiler.Temperature  sent=20.1 lox=20.1 diff=+0.000
Außen.Temperature         sent=15.3 lox=15.3 diff=+0.000
Kühlschrank.Temperature   sent=3.3  lox=3.3  diff=+0.000
Dach.Temperature          sent=14.7 lox=14.7 diff=+0.000
Essen.Temperature         sent=20.3 lox=20.3 diff=+0.000
```

`journalctl --since '3 min ago' | grep -cE "Control renamed|Structure updated"`
returns 0. Empty `jdev/sps/io/<uuid>/` writes also at 0.

## Root cause (chain of three bugs)

1. **`LoxoneStructure.buildMap()`** sets `_meta[uuid]` first as a control
   entry (bare topic `loxone/aussen/aussen`), then iterates `ctrl.states`
   and calls `_meta.set(stateUuid, ...)` again. For InfoOnlyAnalog Loxone
   reuses `ctrl.uuid` as `states.value.uuid`, so the second `set`
   *overwrites* the control entry with a state entry whose topic is
   `loxone/aussen/aussen/value`. The cached `_controls` array still holds
   the pre-overwrite reference with the bare topic, so `getAll()[i].topic`
   and `getMeta(uuid).topic` disagree.

2. **`StructureMonitor.snapshot()`** stored topics from `getAll()` (bare
   topic) while `detectChanges()` compared against `getMeta()` (`/value`
   topic). Result: every 60 s structure refresh detected a phantom rename
   `loxone/aussen/aussen → loxone/aussen/aussen/value` for all five
   InfoOnlyAnalog controls.

3. **`StructureMonitor._clearRetainedTopics()`** then published an empty
   payload to `${oldTopic}/cmd` with `retain: true` — i.e. to the Loxone
   plugin's own `/cmd` subscription. The plugin's `_onMqttMessage()`
   blindly forwarded it as `jdev/sps/io/<uuid>/` (trailing slash, empty
   value) to the Miniserver, which interpreted that as `0` and zeroed the
   InfoOnlyAnalog. The next Tasmota cycle restored the real value, so
   the UI showed lagging / drifting values that occasionally matched.

## Fixes (3 atomic commits on `main`, both instances now on SHA `16f4081`)

- `3757ca6` `fix(loxone): drop empty cmd payloads instead of writing 0 to control`
  Guards `_onMqttMessage` against empty/whitespace payloads (safety net).
- `0af6f2a` `fix(loxone): structure-monitor no longer clears retained /cmd slots`
  Drops `/cmd` from the `_clearRetainedTopics` suffix list. Cmd topics
  are write-only; clearing them with retain=true was nonsensical and
  re-fired every subscriber on each publish.
- `16f4081` `fix(loxone): structure-monitor snapshot uses _meta to stop phantom renames`
  Reads snapshot topics from `getMeta(uuid)` so both sides of the
  rename comparison use the same source.

## Known harmless leftovers

- The same 5 bindings are configured **twice** — once on the `knausi`
  loxone plugin and once on the `venus-os` mqtt-bridge plugin. Each
  Tasmota tick fires both, producing two `jdev/sps/io/<uuid>/<value>`
  writes per binding. They carry identical values at the same instant,
  so it's chatty but harmless. Dedup later via the UI if it bothers you.
- The new debug-level traces (`[loxone] → jdev/sps/io/...`,
  `Binding ... → uuid`, `MQTT→Loxone:`, `API→Loxone:`) remain in place at
  info level. Useful for monitoring; remove later if log volume becomes
  an issue.
