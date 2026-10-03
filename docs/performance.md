# Browser performance and visual pass

Measured in dedicated headless Chrome on this development machine with 20 configured agents, live playback at 4× and normal motion enabled. After a warm-up, 119 RAF intervals averaged 16.81 ms; p95 was 16.70 ms. [Raw measurement](performance-snapshot.json). This measures observed frame delivery, not CPU/GPU render cost or a guarantee for low-end phones. Earlier reduced-motion measurement averaged 16.67 ms.

The browser smoke script runs a full default match, pause/resume, one-turn advance, pure recorded-event playback, shared history, two-seat remix/restart, 20-seat configuration and 360/390/430px viewport checks. Reduced-motion media emulation is checked. Screenshots were visually inspected; the final 20-seat layout uses two rows to avoid overlapping names/sprites.

Concrete bounds: one turn may be in flight; compact transitions contain at most 500 events and contiguous sequence IDs; history limits are enforced in Rust and HTTP; the animation driver retains at most 96 tracks and renders at most 160 particles. Effects cannot influence state. Paused clocks freeze movement, and reduced motion suppresses particles/shake/lunges. Bar interpolation is presentation-only.

DOM updates compare markup before replacement. Canvas text scaling is cached through ResizeObserver instead of reading layout for every label on every frame. Sprite assets load once. State history is separate from the animation queue; runtime inference budgets are never inserted into deterministic history exports.

No heavyweight rendering runtime was added. Measure on real mobile devices before choosing WebGL or claiming launch-grade performance.
