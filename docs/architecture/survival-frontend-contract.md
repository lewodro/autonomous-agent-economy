# Survival Arena frontend contract

The Arena now has a Survival presentation alongside the existing shared RPS and
Tic-Tac-Toe rooms. The browser is a read-only renderer: it cannot choose targets,
move combatants, change health, apply damage, eliminate agents, or declare a
winner. Until the backend publishes the contract below, the Survival field
shows an unavailable message and the RPS / Tic-Tac-Toe rooms remain usable.

## Required endpoint

`GET /api/survival/current` returns a current authoritative snapshot. `sequence`
must increase monotonically within a match. `updated_at` is an ISO-8601 server
timestamp. The frontend polls every 1.5 seconds and retains the last valid
snapshot during a connection interruption. `404` means no public Survival match
is available; malformed snapshots are rejected in full.

```json
{
  "schema_version": 1,
  "match_id": "survival-42",
  "status": "live",
  "sequence": 18,
  "updated_at": "2026-10-07T22:00:00.000Z",
  "round": 31,
  "map": {
    "width": 960,
    "height": 560,
    "obstacles": [
      {"id":"north-wall","x":80,"y":72,"width":220,"height":24,"kind":"wall"}
    ]
  },
  "agents": [
    {
      "id":"ember","name":"Ember",
      "sprite":"assets/sprites-agent/01-founder.png",
      "x":120,"y":180,"hp":72,"max_hp":100,
      "status":"alive","target_id":"atlas",
      "strategy":"careful counterattacker",
      "recent_action":"Closed distance toward Atlas",
      "research":"Retreats successfully below 30 HP",
      "wins":4,"losses":2
    }
  ],
  "engagements": [
    {
      "id":"ember-atlas","attacker_id":"ember","target_id":"atlas",
      "status":"fighting","recent_damage":8,
      "recent_actions":["Ember hit Atlas for 8"]
    }
  ],
  "leader_id":"ember",
  "events":[
    {"seq":17,"type":"AttackLanded","agent_id":"ember","target_id":"atlas","round":31,"summary":"Ember hit Atlas for 8"}
  ]
}
```

## Field rules

- `status`: `preparing`, `live`, or `finished`.
- `agents`: at most 20 with unique IDs; positions must be inside map bounds.
- `sprite`: repository-relative path to a registered transparent sprite in
  `assets/sprites-agent/`. The browser does not load provider-supplied URLs.
- `hp` and `max_hp`: finite numbers; `max_hp > 0`; active agents have positive
  HP and eliminated agents have zero HP.
- agent `status`: `alive`, `eliminated`, `queued`, or `spectating`.
- `target_id` and engagement participant IDs refer to agents in this snapshot.
- `engagements`: at most 20, only connect two distinct living participants, and
  use `chasing`, `fighting`, or `retreating`.
- `events`: latest 50 or fewer typed events, with participant IDs, current-or-
  earlier round numbers, and concise public summaries. Event types are
  `AgentSpawned`, `TargetSelected`, `TargetChanged`, `ChaseStarted`,
  `AttackStarted`, `AttackLanded`, `DamageTaken`, `RetreatStarted`,
  `AgentCornered`, `AgentEscaped`, `AgentEliminated`, and `WinnerDeclared`.
- A finished match includes the final agent statuses and `leader_id` for the
  winner (or `null` for a draw). It must not be inferred by the browser.
- `strategy`, `recent_action`, `research`, and event summaries must be safe,
  concise display text without hidden chain-of-thought or secrets.

The existing `/api/arena/rooms`, `/api/arena/agents`, and
`/api/arena/history` endpoints continue to own the RPS/Tic-Tac-Toe displays and
profiles. Survival profile navigation uses the existing `/world?agent=<id>`
profile overlay. No room, history, profile, economy, or combat backend was added
as part of this frontend pass.

## Custom experiments blocker

`src/config.js` currently uses `mode: "survival"` for an existing economic
policy (stake, reserve, and loss limits); it is not a melee game mode. The
current `/api/capabilities` advertises `last-seat`, `rps`, and `tictactoe`, and
`POST /api/matches` accepts only the Last Seat simulation config. To expose
custom Survival experiments safely, the server must add `survival` as a distinct
`game_modes` capability and define a validated `game_mode: "survival"` request
contract with 2–20 agents. The frontend must not reinterpret the existing
economic `mode` field as combat selection.
