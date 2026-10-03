// Inspect published browser artifacts without adding runtime dependencies.
import {gzipSync} from 'node:zlib';import {writeFile} from 'node:fs/promises';
const packages=[['pixi.js','dist/pixi.min.js'],['phaser','dist/phaser.min.js'],['animejs','lib/bundles/anime.umd.min.js'],['gsap','dist/gsap.min.js'],['lottie-web','build/player/lottie.min.js'],['howler','dist/howler.min.js'],['@tweenjs/tween.js','dist/tween.umd.js'],['mitt','dist/mitt.umd.js']];
const rows=[];
for(const [name,file]of packages){try{const pkg=await fetch(`https://registry.npmjs.org/${name}/latest`).then(r=>r.json());const url=`https://unpkg.com/${name}@${pkg.version}/${file}`;const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);const b=Buffer.from(await r.arrayBuffer());rows.push({name,version:pkg.version,license:pkg.license,artifact:file,raw_bytes:b.length,gzip_bytes:gzipSync(b).length,source:url});}catch(error){rows.push({name,error:error.message});}}
await writeFile('docs/library-sizes.json',JSON.stringify(rows,null,2)+'\n');console.log(rows);
