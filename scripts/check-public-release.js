import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const failures = [];
const requireMatch = (file, pattern, message) => {
  if (!pattern.test(read(file))) failures.push(`${file}: ${message}`);
};
const forbid = (file, pattern, message) => {
  if (pattern.test(read(file))) failures.push(`${file}: ${message}`);
};

requireMatch('README.md', /href="https:\/\/lastseat\.ing"/, 'live banner must link to the canonical domain');
requireMatch('README.md', /img\.shields\.io\/badge\/ENTER_THE_LIVE_WORLD-lastseat\.ing/, 'live banner image must use a valid image URL');
forbid('README.md', /https?:\/\/(?:localhost|127\.0\.0\.1)/, 'public README must not advertise a loopback URL');
forbid('README.md', /href="#"[^>]*>\s*<img[^>]*Live Website Banner/s, 'live banner must not be a placeholder');

requireMatch('render.yaml', /PUBLIC_ORIGIN\n\s+value: https:\/\/lastseat\.ing/, 'Render must use the canonical origin');
requireMatch('render.yaml', /HOST_SESSION_SECRET\n\s+generateValue: true/, 'Render must generate the session signing secret');
requireMatch('render.yaml', /WORLD_SOL_PAYOUTS_ENABLED\n\s+value: "0"/, 'real SOL payouts must remain disabled');
forbid('render.yaml', /Railway|railway|localhost|127\.0\.0\.1/, 'production Blueprint must remain provider-current and public');

for (const file of ['service/deployment-config.js', '.env.example', 'docs/deployment-render-cloudflare.md']) {
  forbid(file, /RAILWAY_PUBLIC_DOMAIN|Railway Variables/, 'retired provider-origin configuration must not return');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('OK canonical domain, banner, Render safety flags, and provider-neutral production origin.');
