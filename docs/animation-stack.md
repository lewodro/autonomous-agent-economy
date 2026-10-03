# Animation stack options

Reviewed upstream documentation/licenses on 2026-10-03. Keep Canvas tonight: the
existing `AnimationDriver` already has bounded effects, a presentation clock, pause,
speed and reduced motion. `EconomyAnimationDriver` is a second cosmetic port; it maps
confirmed deposits/payouts without converting money into simulation resources.

| Candidate | License | Rendering / sprites / particles / camera | React | Bundle implications | Migration / recommendation |
|---|---|---|---|---|---|
| PixiJS | MIT | WebGL/WebGPU scene graph; sprites and particle containers; camera via container transforms | Separate React integration | GPU renderer is materially larger than current native Canvas; selectively import and measure | Medium: implement RenderingDriver + AnimationDriver; best later GPU renderer candidate |
| Phaser | MIT | Full game framework, sprite animation, particles, scene camera and game loop | Imperative canvas mounted in component | Broad framework; highest scope/cost among these choices | High: keep Rust transport outside scenes; choose only if scenes/audio/input tooling justify it |
| Motion | MIT core; commercial extras separate | DOM/SVG transitions and gestures; no sprite/particle/game-camera engine | Strong first-party React API; JS also available | Feature imports/lazy loading; adding React solely for HUD effects adds cost | Low for HUD, unsuitable as board renderer; keep CSS now |
| GSAP | Custom Standard License, **not MIT/OSI** | Object/DOM/SVG timeline tweening; sprites, particles and camera need renderer implementation | Integration available; lifecycle cleanup required | Core/plugins affect size; import only used capabilities | Low–medium as a timeline driver; review current license before adoption |
| anime.js | MIT | JS object, DOM/SVG animation, timelines; no built-in game renderer/camera/particle system | Imperative lifecycle integration | Modular imports; measure selected runtime rather than whole package | Low–medium timeline-only candidate if native scheduler becomes hard to maintain |

These are actively published upstream projects; maintenance quality is not a warranty.
Recheck release compatibility and plugin licenses when selecting a version. Actual
shipped bytes depend on version/imports/bundler: [previous measured full-build artifacts](library-sizes.json)
are comparison evidence, **not** estimates of this app after migration. No dependencies
were added in this pass.

Recommendation: retain native Canvas until a measured limitation appears. Then pilot
**PixiJS** behind the renderer/effect interfaces. If only choreography needs improvement,
try **anime.js** behind the animation port rather than replacing the board or runtime.
This recommendation is a project-specific assessment of migration scope, not an upstream claim.

## Replacement contract

1. Consume existing typed semantic game/economy events and immutable Rust projections.
2. Keep effects bounded; support reset, stale-match cancellation, pause/speed and reduced motion.
3. Preserve the presentation clock: effect completion never advances or settles a match.
4. Keep HTTP/SSE and core state outside library scenes/components; dispose ticker/listeners on reset.
5. Run event-mapper tests, deterministic integration, 20-agent desktop and 360px mobile smoke tests.

## Primary sources

- Pixi [Application / renderer setup](https://pixijs.com/8.x/guides/components/application), [particle container](https://pixijs.com/8.x/guides/components/scene-objects/particle-container), [MIT license](https://github.com/pixijs/pixijs/blob/dev/LICENSE).
- Phaser [framework source and capabilities](https://github.com/phaserjs/phaser), [license](https://phaser.io/download/license).
- Motion [React documentation](https://motion.dev/docs/react), [core license](https://github.com/motiondivision/motion/blob/main/LICENSE.md).
- GSAP [runtime documentation](https://gsap.com/docs/v3/GSAP/), [Standard License](https://gsap.com/community/standard-license/).
- anime.js [documentation](https://animejs.com/documentation/), [MIT license](https://github.com/juliangarnier/anime/blob/master/LICENSE.md).
