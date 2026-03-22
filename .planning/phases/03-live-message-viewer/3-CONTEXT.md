# Phase 3: Live Message Viewer -- Context

## Decisions

### Architecture
- **New WebSocket route `/ws/messages`** -- separate from `/ws/dashboard`. Each connected client can subscribe/unsubscribe to MQTT topic patterns via JSON commands sent over the WebSocket. The backend subscribes to those topics via MqttService and forwards matching messages to that client only.
- **Per-client subscription tracking** -- the route maintains a Map of client -> Set<topic>. On disconnect, all subscriptions for that client are cleaned up (MqttService.unsubscribe). MqttService needs a new `unsubscribe(topic)` method added.
- **No server-side buffering** -- the server streams live messages only. The ring buffer lives client-side.

### Frontend -- Messages Page
- **Topic input field + Subscribe/Unsubscribe button** -- user types a topic pattern (e.g. `#`, `loxone/#`, `$SYS/broker/+`), clicks Subscribe. Button toggles to "Unsubscribe" while subscribed. Multiple subscriptions allowed simultaneously.
- **Message list** -- scrollable container showing each message as a row: `timestamp | topic | payload`. Newest messages at top (prepend). Auto-scroll to top unless user has scrolled down to read older messages.
- **Ring buffer** -- client keeps last 500 messages in an array. When full, oldest messages are dropped.
- **Client-side filter** -- text input that filters the displayed messages instantly (no new subscription). Filters by substring match on topic or payload.
- **Clear button** -- clears the in-memory message buffer and the display.
- **Message rate counter** -- small indicator showing messages/second, updated every second. Counts messages received in the last second.
- **Design** -- Venus OS dark theme, same `.ve-card` / `.ve-panel` styling. Message payloads in monospace font (`var(--ve-font-mono)`). Topic text in secondary color, timestamp in dim color.

### WebSocket Protocol
Client sends:
```json
{"action": "subscribe", "topic": "#"}
{"action": "unsubscribe", "topic": "#"}
```

Server sends:
```json
{"type": "message", "topic": "home/temp", "payload": "22.5", "timestamp": 1711100000000}
{"type": "subscribed", "topic": "#"}
{"type": "unsubscribed", "topic": "#"}
{"type": "error", "message": "Invalid topic pattern"}
```

## Deferred Ideas
- Message payload formatting/pretty-printing (JSON, hex, etc.)
- Export/download message history
- Persistent subscriptions across page reloads
- Server-side message buffering

## Claude's Discretion
- Exact layout of the controls bar (input, buttons, rate counter positioning)
- Whether to show subscription count or active topics list
- Animation/transition details for new messages appearing
- Exact ring buffer implementation (array with splice vs circular buffer)
