import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { activeSets } from '../src/data/sets.js';
import { generateNormalPackOnly } from '../src/utils/packGenerator.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/unchanged-vintage-pack-sequences.json',import.meta.url),'utf8'));
test('ten already-correct vintage sets preserve exact pack sequences from pinned main',()=>{
  const random=Math.random;
  try {
    for(const row of fixture.rows) {
      let state=row.seed;
      Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
      const set=activeSets.find(s=>s.id===row.id);
      const packs=Array.from({length:row.packs},()=>generateNormalPackOnly(set).map(c=>c.id));
      assert.equal(createHash('sha256').update(JSON.stringify(packs)).digest('hex'),row.sha256,`${row.id} changed despite having no demonstrated rate defect`);
    }
  } finally {Math.random=random;}
});
