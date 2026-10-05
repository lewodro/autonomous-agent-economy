# Live watching

Start a match and choose **Watch live** to copy `/?watch=<session-id>`. Another
browser follows the same Rust match over `GET /api/matches/:session/events`.
The host advances turns. Viewers never issue step requests; pausing, inspecting,
seeking and changing playback speed affect only their presentation. Restart or
New / remix creates a separate match. Local links require the running local
service; `PUBLIC_ORIGIN` and a reverse proxy are needed for external access.

SSE delivers an initial full snapshot and ordered compact transitions. Automatic
network reconnection gets a fresh snapshot, so missed transitions are restored.
The browser validates contiguous sequence numbers and resynchronizes on gaps.
Connections are limited to four per match and sixteen per service. Slow readers
are disconnected rather than buffering unbounded turns or delaying resolution.
A heartbeat keeps proxies alive; `X-Accel-Buffering: no` prevents proxy buffering
where supported. Compression/proxies must preserve streaming behavior.

The published stream follows **checkpointed** transitions. Viewer arrival never
changes model inference, budgets or simulation outcomes. This is a read-only
browser mode, not authenticated ownership: this local service still allows
same-origin clients to invoke its APIs. Public hosting needs authentication,
owner authorization, admission/rate limits and a durable hosted storage policy.
Do not expose a funded inference service as an unauthenticated public endpoint.

These are live state updates, not video export or replay clips.
