/**
 * Shared cave interaction priority. Desktop `E` and the compact mobile action
 * button both use this order, so one key can open a chest, take a passage, or
 * strike the nearest monster without the client inventing a second ruleset.
 */
export type CaveAction = 'chest' | 'exit' | 'descent' | 'attack' | 'none';
export interface CaveActionContext {
  chest: boolean;
  exit: boolean;
  descent: boolean;
  monster: boolean;
}
export function caveActionFor(context: CaveActionContext): CaveAction {
  if (context.chest) return 'chest';
  if (context.exit) return 'exit';
  if (context.descent) return 'descent';
  if (context.monster) return 'attack';
  return 'none';
}
