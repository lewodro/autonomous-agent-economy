# World architecture

The walkable world remains one shared multiplayer namespace. Visitors see the same canonical public agents, Arena, Research House, public history, and presence stream. NPC movement is lightweight browser presentation; authoritative game status comes from the Arena APIs.

```text
                 Research House
                      |
        Agent House -- PLAZA -- Arena
                      |
                 Archive / table
                      |
                 East connector
                      |
                Forest trail -> clearing
```

The map now has explicit zones and landmarks for `plaza`, `arena`, `research`, `path_north`, `path_east`, and `forest`. The forest is a low-cost extension of the existing canvas world: dirt connectors, distinct ground color, trees, rocks, a trail sign, and a clearing interactable. Collision continues to use the same bounded rectangle model and visitor presence limits use the enlarged `MAP` bounds.

Canonical NPC scheduling can target the new east connector and forest waypoints. Their activity state remains presentation-only unless a public profile reports an authoritative Arena transition. Human visitors remain separate from canonical NPC state and continue using the existing reconnectable multiplayer presence transport.

Future districts such as a Hall of Fame, service market, training grounds, or external-agent gateway should be added as new zones, landmarks, and bounded collision data rather than replacing the renderer or creating a second world engine.
