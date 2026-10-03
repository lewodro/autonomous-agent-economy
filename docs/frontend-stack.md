# Replaceable frontend stack

Research checked against publisher repositories, documentation and published artifacts on 2026-10-03. No animation/rendering runtime dependency was added. The current 20-seat scene does not justify shipping a whole game engine yet.

`GameRenderer` consumes public state and events. `AnimationDriver` owns transient poses/effects; `mapEvent` maps semantic events to commands. The driver does not know game rules. Replacing Canvas with Pixi or Phaser requires a renderer/driver adapter, leaving Rust, transport, state projection, configuration and spectator controls intact.

## Candidates

| Library / source | Purpose / rendering | License | Size / maintenance | Advantages | Disadvantages / React | Migration | Recommend |
|---|---|---|---|---|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) | WebGL/WebGPU scene graph | MIT | Measured full build 232 KiB gzip; established project | Animated sprites, batching, filters, fast [particles](https://pixijs.com/8.x/guides/components/scene-objects/particle-container) | Camera/tween policy is ours; React wrapper optional | Medium: implement both ports, convert assets | First choice if GPU rendering is needed |
| [Phaser](https://github.com/phaserjs/phaser) | Full game engine | MIT | Full build 346 KiB gzip; current major release | Sprite sheets, particles, [camera effects](https://docs.phaser.io/phaser/concepts/cameras), scenes, sound | Larger lifecycle surface; React via canvas ref/event bridge | High: preserve transport, replace scene/driver only | If we need multiple game scenes |
| [Excalibur](https://github.com/excaliburjs/Excalibur) | TypeScript game engine | BSD-2-Clause | Full engine; size not measured here | Typed sprites, animation, cameras, collision tools | Physics adds little to a table game; React via imperative ref | Medium/high | Strong smaller-engine candidate |
| [melonJS](https://github.com/melonjs/melonJS) | 2D game engine | MIT | Full engine; not measured | Sprites, input, tween/game loop | Another lifecycle; React via imperative canvas | Medium/high | Alternative to Phaser |
| [Tween.js](https://github.com/tweenjs/tween.js) | Numeric tweens | MIT | 7.3 KiB gzip measured UMD; mature | Explicit update clock works with pause/speed | No sprites/particles/camera by itself; framework-neutral | Low: driver internals only | Best small tween candidate |
| [Anime.js](https://github.com/juliangarnier/anime) | DOM/SVG/object animation | MIT | Modular; requested artifact path was unavailable | Timelines and numeric/object animation | Needs our pixel renderer; avoid two clocks; React via refs | Low/medium | Useful when timelines outgrow driver |
| [Motion](https://github.com/motiondivision/motion) | DOM/WAAPI and React UI animation | MIT | Entry-point dependent; not measured | HUD transitions; strong React integration | Does not render pixel sprites or supply game particles | Low for HUD, medium for driver | HUD only if needed |
| [GSAP](https://gsap.com/standard-license/) | DOM/object timeline engine | Custom standard license, not MIT/OSI | Core 27.7 KiB gzip measured | Mature timelines and easings | License restrictions differ from OSS; React via refs | Low/medium | Consider only after license review |
| [Rive runtime](https://github.com/rive-app/rive-wasm) | Authored vector state machines / WASM | MIT runtime; editor/assets separate | Runtime + WASM + authored assets | Rich authored character states; React package available | Vector pipeline mismatches current pixel assets | High | Future authored mascot, not table |
| [Lottie](https://github.com/airbnb/lottie-web) | Authored SVG/canvas animation | MIT | 74.9 KiB gzip measured, assets extra | Designed UI celebrations; React wrappers | Not sprite/game logic; asset production overhead | Medium | Optional UI effects only |
| [XState](https://github.com/statelyai/xstate) | State machines / actors | MIT | Import dependent; not measured | Explicit async runtime phases and cancellation | Would duplicate a small existing player unless complexity grows; React integration available | Medium | When browser orchestration grows |
| [mitt](https://github.com/developit/mitt) | Event bus | MIT | 296 gzip bytes measured UMD | Tiny, framework-neutral | Bus does not enforce event ordering; hidden global subscriptions are a risk | Low | Scoped bus only if multiple render consumers appear |
| [Howler](https://github.com/goldfire/howler.js) | Web Audio / HTML5 audio | MIT | 9.5 KiB gzip measured | Sound sprites, fallback, volume controls | Audio needs user gesture and mute policy; React via wrapper | Low | First choice when adding sound |

## Bundle evidence

[Measured artifacts](library-sizes.json) include exact versions, source URLs, raw bytes and locally gzip-compressed bytes. These are published full/UMD artifacts, **not** comparable tree-shaken app bundles. Pixi/Phaser can be reduced with selective imports; Rive/Lottie also require asset payloads. Anime's requested path returned 404, so no number is invented. Re-run `node scripts/measure-libraries.js` to update the snapshot without installing packages.

The current Canvas driver is tested, bounded to 96 tracks / 160 rendered particles, uses one presentation clock, supports reduced motion and exposes a swappable port. Browser RAF timing is measured in the visual smoke test. Add a dependency when a measured feature or performance need justifies it, rather than because a library advertises animation.

## Migration contract

1. Keep Rust projections and event ordering unchanged.
2. Implement `GameRenderer.update/reset/destroy` for the selected rendering engine.
3. Implement `AnimationDriver` methods on that engine's tween/particle system.
4. Keep pause/speed/reduced-motion driven by the player clock.
5. Run projection, animation mapper, transport and browser tests unchanged.
