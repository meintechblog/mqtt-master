# Handoff — Loxone Binding Drift Investigation — RESOLVED (Code) + LOXONE CONFIG ACTION REQUIRED

**Repo:** `meintechblog/mqtt-master` · **Local:** `/Users/hulki/codex/mqtt-master`
**Wohnwagen:** `ssh root@192.168.13.2 → pct exec 200` · **Both instances on SHA `aa821c2`**

## TL;DR

Code is now correct. Five bugs in mqtt-master fixed. The remaining
"drift" the user sees on the Loxone UI is **a Loxone-side deadband
filter (~0.21-0.25°)** configured on the user's five InfoOnlyAnalog
controls in Loxone Config. Loxone silently *ignores* writes whose delta
from the current stored value is below that threshold. The Wohnwagen
side is doing exactly what we ask of it.

## What was actually fixed in code (5 commits on `main`)

`3757ca6` `fix(loxone): drop empty cmd payloads instead of writing 0 to control`
Empty MQTT payloads on `loxone/.../cmd` were being forwarded as
`jdev/sps/io/<uuid>/` (trailing slash, empty value) and Loxone parsed
that as `0`. Guard added.

`0af6f2a` `fix(loxone): structure-monitor no longer clears retained /cmd slots`
`_clearRetainedTopics()` was publishing empty retained payloads to cmd
topics, which immediately re-fired the loxone plugin's own /cmd
subscriber.

`16f4081` `fix(loxone): structure-monitor snapshot uses _meta to stop phantom renames`
Phantom rename loop. snapshot() walked getAll(), detectChanges() walked
getMeta() — for InfoOnlyAnalog these diverge because Loxone reuses the
control UUID as its `value` state UUID. Every 60s structure refresh
saw five "renames" and clobbered retained state.

`154a83f` `fix(loxone): optimistic state-cache update on send to eliminate read-after-write drift`
peekControlValue() was returning a stale Loxone broadcast for 1-2s
after every write. Fixed by mirroring just-sent values into the cache
from sendControlCommand, _onMqttMessage, and the loxone plugin's own
binding sendToTarget. Loxone's confirming event still overwrites if
the actual stored value differs.

`aa821c2` `fix(loxone): exclude printf format specs from control description`
"%.1f°" was leaking into the control description for every
InfoOnlyAnalog because details.format was treated as a fallback
"Bezeichnung" candidate. The format spec is now filtered with a regex
in both passes; description stays empty when no real description exists.

## What is NOT a code bug — Loxone deadband

Direct write tests with bindings off, sweeping 0.0 → 1.0 in 0.1 steps
on every UUID:

```
=== Wasserboiler / Aussen / Dach / Kuehlschrank / Essen — same shape ===
0.0 → 0.0   ✓
0.1 → 0.0   (delta 0.1, ignored)
0.2 → 0.0   (delta 0.2, ignored)
0.3 → 0.3   ✓ (delta 0.3, accepted)
0.4 → 0.3   (delta 0.1, ignored)
0.5 → 0.3   (delta 0.2, ignored)
0.6 → 0.6   ✓ (delta 0.3, accepted)
…
```

Finer sweep on Wasserboiler narrowed the threshold to ~0.21-0.25:
`10.20→10`, `10.25→10.25`, `10.45→10.25`, `10.50→10.50`. Same in the
descending direction (`19.7→19.7`, `19.5→19.7`, `19.3→19.7`).

Direct API writes that *cross* the threshold land exactly:
`11.11 → 11.11 ✓`, `22.22 → 22.22 ✓`, `33.33 → 33.33 ✓`. So neither the
WS protocol nor our code rounds — Loxone's *control-side* filter
discards sub-threshold deltas before they reach the stored state.

### What the user needs to do in Loxone Config

For each of the five controls (Wasserboiler, Aussen, Dach,
Kühlschrank, Essen) under category "Klima":

1. Open the InfoOnlyAnalog properties.
2. Look for one of: **Schwellwert / Hysterese / Filter / Min change /
   Schritt / Datenfilter**. The exact label depends on Loxone version.
3. Set it to `0` (or remove it). Save and upload to Miniserver.

After that, sub-degree changes from Tasmota will land as-sent, and
the binding-stats UI will show 0.0 drift continuously.

Until that's done, the drift the user sees is honest reporting:
`sent` is what we wrote, `loxoneValue` is what Loxone actually has —
which lags by up to one threshold-step when Tasmota's reading drifts
slowly.

## Current verified live behaviour (with deadband still active)

```
Wasserboiler.Temperature  sent=19.4  lox=19.4  diff=+0.000
Außen.Temperature         sent=14.8  lox=14.9  diff=+0.100
Kühlschrank.Temperature   sent=2.2   lox=2.2   diff=+0.000
Dach.Temperature          sent=13.9  lox=14.0  diff=+0.100
Essen.Temperature         sent=19.1  lox=19.1  diff=+0.000
```

`sent` always tracks Tasmota exactly (we are sending what Tasmota
publishes). `loxoneValue` is whatever Loxone last *accepted* through
its filter. After the user removes the filter, both columns will agree
within 1 Tasmota cycle.

## Known harmless leftovers

- Same five bindings configured on both `knausi` (loxone) and
  `venus-os` (mqtt-bridge). Each Tasmota tick fires both → two
  identical `jdev/sps/io/<uuid>/<value>` writes. Wasted bandwidth, not
  a correctness issue. Dedupe later via the UI if desired.
- Trace logs (`[loxone] →`, `Binding ... → uuid`, `MQTT→Loxone`,
  `API→Loxone`) remain at info level. Useful for monitoring.

## Footguns I tripped over (so the next session doesn't)

- `PUT /api/plugins/<id>/bindings` body must be **the array directly**,
  not `{"bindings": []}`. The latter corrupts the on-disk config to
  `{bindings: []}` and breaks BindingsManager.getStats() with
  "this._bindings is not iterable". Recovery: PUT the correct shape
  again (or restart wipes the runtime, but config.json stays bad).
- Wohnwagen updater preflight bails on any untracked file in
  `/opt/mqtt-master/` not matching its allowlist (config.json,
  plugins/<name>/, .update-state/). My `config.json.bak.*` blocked one
  run; clean up backup files before triggering the updater.
- Tasmota numbers like `20.0` parse to JS number `20`, so the WS write
  becomes `jdev/sps/io/<uuid>/20` not `…/20.0`. Loxone treats both as
  `20`, so this is harmless — but easy to mistake for a drift cause
  when staring at logs.
