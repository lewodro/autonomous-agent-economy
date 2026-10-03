export function parseConfig(text:string):unknown {
 const value:unknown=JSON.parse(text);
 if(!value||typeof value!=='object'||!('agents' in value)||!Array.isArray(value.agents))throw new Error('Config must contain an agents array');
 return value; // Only the authoritative service expands and validates profiles.
}
