/**
 * Server-owned discovery taxonomy for completion rewards.
 *
 * The journal's browser history remains local, but the reward-bearing groups
 * live here so the browser cannot award itself credits. Every group is a
 * self-contained record: adding a future world expansion means adding one more
 * entry here, with no change to the reward machinery.
 *
 * A group is complete only when every required landmark is recorded for the
 * account. The client reports ids; the server checks them against this list.
 */
export const DISCOVERY_REWARD_CREDITS = 5;

export const DISCOVERY_GROUPS = Object.freeze([
  Object.freeze({
    id: 'wilderness_trails',
    label: 'WILDERNESS TRAILS',
    reward: DISCOVERY_REWARD_CREDITS,
    sites: Object.freeze([
      'cave-north', 'cave-east', 'mossy-ruin', 'sunken-shrine', 'old-watchtower',
    ]),
  }),
  Object.freeze({
    id: 'frostgate_ascent',
    label: 'FROSTGATE ASCENT',
    reward: DISCOVERY_REWARD_CREDITS,
    sites: Object.freeze([
      'frostgate-village', 'frozen-shrine', 'ice-bridge', 'high-pass', 'frost-watchtower', 'summit-beacon',
    ]),
  }),
]);

/** Ids the ledger will accept from a browser, including unrewarded landmarks. */
export const DISCOVERY_SITE_IDS = Object.freeze([
  'cave-north', 'cave-east', 'cave-south', 'cave-west',
  'sunken-shrine', 'mossy-ruin', 'old-watchtower', 'whispering-grove',
  'shattered-ridge', 'rift-monolith', 'old-quarry', 'echo-cave', 'lantern-grove',
  'frostgate-pass', 'starfall-circle', 'ember-shrine', 'hollow-arch',
  'frostgate-village', 'frozen-shrine', 'frozen-lake', 'ice-bridge',
  'high-pass', 'frost-watchtower', 'summit-beacon',
]);

export function publicDiscoveryGroups() {
  return DISCOVERY_GROUPS.map(group => ({
    id: group.id, label: group.label, reward: group.reward,
    sites: [...group.sites],
  }));
}

/** Groups whose every landmark is present, in catalog order. */
export function completedDiscoveryGroups(found) {
  const known = found instanceof Set ? found : new Set(Array.isArray(found) ? found : []);
  return DISCOVERY_GROUPS.filter(group => group.sites.every(id => known.has(id)));
}
