// Exercise the public generator, including its automatic rare-format decision.
import fs from 'node:fs';
import { activeSets } from '../src/data/sets.js';
import { generatePack, getRarityCategory } from '../src/utils/packGenerator.js';
const targets = {
  '151': {doubleRare:13.5,ultraRare:6.5,illustrationRare:8,specialIllustrationRare:3,hyperRare:2},
  'prismatic-evolutions': {doubleRare:16.51,ultraRare:7.46,specialIllustrationRare:2.22,hyperRare:.56,aceSpecRare:4.68},
  'black-bolt': {doubleRare:21.11,ultraRare:5.83,illustrationRare:16.39,specialIllustrationRare:1.25,blackWhiteRare:.05,victiniRare:.05},
  'white-flare': {doubleRare:21.11,ultraRare:5.83,illustrationRare:16.39,specialIllustrationRare:1.25,blackWhiteRare:.05,victiniRare:.05},
  'ascended-heroes': {doubleRare:13.58,megaDoubleRare:6.79,ultraRare:4.81,megaAttackRare:3.47,illustrationRare:11.25,specialIllustrationRare:1.44,megaHyperRare:.19},
};
const n=Number(process.argv.find(a=>a.startsWith('--packs='))?.slice(8)||10000);
if(!Number.isInteger(n)||n<1)throw Error('packs must be a positive integer');
let state=0x19810407;
const originalRandom=Math.random;
Math.random=()=>{state+=0x6d2b79f5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
const rows=[];
try {
 for(const [id,rates] of Object.entries(targets)) {
  const set=activeSets.find(s=>s.id===id),counts=Object.fromEntries(Object.keys(rates).map(k=>[k,0]));
  let godPacks=0;const errors=[];
  for(let i=0;i<n;i++) {
   const pack=generatePack(set);godPacks+=Number(Boolean(pack.isGodPack));
   if(pack.length!==10||new Set(pack.map(c=>c.id)).size!==10)throw Error(`${id}: malformed pack ${i}`);
   for(const card of pack) {const k=getRarityCategory(card,set);if(Object.hasOwn(counts,k))counts[k]++;}
  }
  const outcomes=Object.entries(rates).map(([bucket,percent])=>{
   const expected=n*percent/100;
   // God packs can contribute up to 9 cards in one tier. Conservative bound
   // handles this compound distribution; this is not a physical-study CI.
   const maxPerPack=['illustrationRare','specialIllustrationRare','megaAttackRare'].includes(bucket)?9:1;
   const tolerance=6*Math.sqrt(expected*maxPerPack)+12;
   if(Math.abs(counts[bucket]-expected)>tolerance)errors.push(`${bucket}: ${counts[bucket]} vs ${expected}`);
   return {bucket,expectedPercent:percent,observedCardsPer100Packs:counts[bucket]/n*100,count:counts[bucket],toleranceCards:tolerance};
  });
  if(!godPacks)errors.push('No automatic God pack exercised; increase sample size');
  rows.push({id,packs:n,godPacks,errors,outcomes});console.log(id,godPacks,errors);
 }
} finally {Math.random=originalRandom;}
const report={seed:'0x19810407',method:'public generatePack, automatic God decision; counts per pack, not at-least-one-hit probability',sets:rows,errors:rows.reduce((a,r)=>a+r.errors.length,0)};
fs.writeFileSync('audits/pull-rates/automatic-god-pack-outcomes.json',JSON.stringify(report,null,2)+'\n');
if(report.errors)process.exitCode=1;
