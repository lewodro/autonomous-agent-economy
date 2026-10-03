# Replay and decision bounds

The rules allow up to 20 agents and 200 turns. A valid maximum-length mock match
can exceed 30,000 events and 8 MB, so replay verification accepts up to 50,000
events and replay upload routes accept up to 32 MB. Other API request bodies are
limited to 1 MB. Requests above their route's limit return HTTP 413.

The engine checks its canonical history size before committing a transition,
leaving 64 KB for starting/final states, statistics and transport wrappers.
If history exceeds that byte budget or 50,000 events, the transition fails atomically.
Reasons above 600 UTF-8 bytes and targets above 40 bytes are rejected before
recording decisions. Unknown targets and other bounded invalid choices retain
the deterministic guard fallback.

CI runs the full 20-agent, 200-turn replay stress check using a release build.
Debug builds remain available for normal tests and development.

Published game rules are immutable. Version 3 archives retain the two-credit
challenge entry, two-credit guard income, and challenge caps of five/four.
Version 4 games use a one-credit entry, two-credit guard income, and caps of
four/three. Current version 5 games use a two-credit entry, two-credit guard
income, and caps of four/three. Versions 1 and 2 retain their original rules. The default version
constant never determines the rules used to verify an older archive.
