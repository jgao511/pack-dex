import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { activeSets } from '../src/data/sets.js';
import { hardcodedPullRates } from '../src/data/hardcodedPullRates.js';
import { getCollectionVisibleCards, getPullableCollectionCards, resolveSavedCollectionCard } from '../src/utils/collectionStorage.js';
import {
  generateNormalPackOnly, generateForcedGodPack, getPackPools,
  getRarityCategory, getMegaRareSlotWeights, getMegaSecondFoilSlotWeights,
  getModernSVRareSlotWeights, getModernSVSecondFoilSlotWeights,
  getSubsetSlotConfig, getFinalPullBucket, pickRegularOrSubsetSlot, GOD_PACK_CONFIG,
} from '../src/utils/packGenerator.js';
const find = id => activeSets.find(s => s.id === id);
const close = (actual, expected, message='') => assert.ok(Math.abs(actual-expected)<1e-9, `${message}: ${actual} vs ${expected}`);
function withRolls(rolls, callback) {
  const random=Math.random;let i=0;Math.random=()=>rolls[i++] ?? .5;
  try{return callback();}finally{Math.random=random;}
}

test('English study fixtures survive the data-to-runtime path without experience overrides', () => {
  // Independently transcribed summary tables; values are percentages per English pack.
  // TCGplayer: SV base/Paldea/Obsidian/Paradox and 2024-25 main sets, 8,000+ each.
  const sv = {
    'scarlet-violet':[13.76,6.57,7.67,3.15,1.85], 'paldea-evolved':[13.72,6.64,7.70,3.17,1.76],
    'obsidian-flames':[13.61,6.63,7.60,3.13,1.92], 'paradox-rift':[15.57,6.64,7.70,2.11,1.22],
    'temporal-forces':[16.83,6.67,7.72,1.17,.72], 'twilight-masquerade':[16.93,6.61,7.73,1.17,.68],
    'stellar-crown':[16.90,6.75,7.79,1.11,.73], 'surging-sparks':[16.94,6.74,7.67,1.15,.53],
    'journey-together':[20.29,6.54,8.50,1.16,.73], 'destined-rivals':[19.83,6.39,8.29,1.06,.67],
  };
  for(const [id,values] of Object.entries(sv)) {
    const set=find(id), rare=getModernSVRareSlotWeights(set), art=getModernSVSecondFoilSlotWeights(set);
    const actual=[rare.doubleRare,rare.ultraRare,art.illustrationRare,art.specialIllustrationRare,art.hyperRare];
    values.forEach((value,i)=>close(actual[i],value,`${id}/${i}`));
  }
  // Combined standard/Mega DRs share one measured tier, not two copies of that probability.
  const mega = {
    'mega-evolution':[20.91,8.23,10.89,.99,.08], 'phantasmal-flames':[20.77,8.06,10.97,1.25,.08],
    'perfect-order':[20.97,8.54,11.20,1.23,.06], 'chaos-rising':[20.30,8.29,10.66,1.21,.10],
    'delta-reign':[20.91,8.23,10.89,.99,.08], // explicit nearest-era fallback, not a Delta measurement
  };
  for(const [id,values] of Object.entries(mega)) {
    const set=find(id), rare=getMegaRareSlotWeights(set), art=getMegaSecondFoilSlotWeights(set);
    const actual=[rare.doubleRare+rare.megaDoubleRare,rare.ultraRare,art.illustrationRare,art.specialIllustrationRare,art.megaHyperRare];
    values.forEach((value,i)=>close(actual[i],value,`${id}/${i}`));
  }
  const source=fs.readFileSync(new URL('../src/utils/packGenerator.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/EXPERIENCE_TUNED|35-45% any-hit/);
});

test('all six Delta Reign regular ex cards can actually leave the final slot', () => {
  const set=find('delta-reign'), weights=getMegaRareSlotWeights(set);
  const cards=getPackPools(set).finalSlotPool.filter(c=>getRarityCategory(c,set)==='doubleRare');
  assert.deepEqual(cards.map(c=>String(c.number)),['14','23','29','33','67','88']);
  for(const [i,card] of cards.entries()) {
    const rolls=Array(15).fill(.5);
    // No Stadium pair: four commons, pair decision, three uncommons,
    // reverse, art decision/card, Rare decision/card.
    rolls[11]=(weights.rare+weights.doubleRare/2)/100;
    rolls[12]=(i+.5)/cards.length;
    const pack=withRolls(rolls,()=>generateNormalPackOnly(set));
    assert.equal(pack.length,10);
    assert.equal(pack[9].id,card.id);
  }
});

test('Delta Reign Stadium halves are paired and excluded from reverse slots', () => {
  const set=find('delta-reign'), pools=getPackPools(set);
  assert.equal(pools.reverseSlotPool.some(c=>Number(c.number)>=94&&Number(c.number)<=99),false);
  for(let i=0;i<3;i++) {
    const rolls=Array(15).fill(.5); rolls[4]=.1;rolls[5]=(i+.5)/3;
    const pack=withRolls(rolls,()=>generateNormalPackOnly(set));
    const numbers=new Set(pack.map(c=>Number(c.number)));
    assert.ok(numbers.has(94+2*i)&&numbers.has(95+2*i));
    assert.equal(pack.length,10);assert.equal(new Set(pack.map(c=>c.id)).size,10);
  }
});

test('God packs contribute to, rather than add on top of, the published effective rates', () => {
  const fixed = {
    '151':{art:{illustrationRare:8,specialIllustrationRare:3,hyperRare:2},rare:{doubleRare:13.5,ultraRare:6.5},god:{illustrationRare:2,specialIllustrationRare:1}},
    'prismatic-evolutions':{art:{specialIllustrationRare:2.22,hyperRare:.56},rare:{doubleRare:16.51,ultraRare:7.46},god:{specialIllustrationRare:5.1}},
    'black-bolt':{art:{illustrationRare:16.39,specialIllustrationRare:1.25},rare:{doubleRare:21.11,ultraRare:5.83,blackWhiteRare:.05,victiniRare:.05},god:{illustrationRare:9,specialIllustrationRare:1}},
    'white-flare':{art:{illustrationRare:16.39,specialIllustrationRare:1.25},rare:{doubleRare:21.11,ultraRare:5.83,blackWhiteRare:.05,victiniRare:.05},god:{illustrationRare:9,specialIllustrationRare:1}},
    'ascended-heroes':{art:{illustrationRare:11.25,specialIllustrationRare:1.44,megaHyperRare:.19},rare:{doubleRare:13.58,megaDoubleRare:6.79,ultraRare:4.81,megaAttackRare:3.47},god:{specialIllustrationRare:7,megaAttackRare:3}},
  };
  for(const [id,expected] of Object.entries(fixed)) {
    const set=find(id), g=GOD_PACK_CONFIG[id].odds;
    const mega=id==='ascended-heroes';
    const art=mega?getMegaSecondFoilSlotWeights(set):getModernSVSecondFoilSlotWeights(set);
    const rare=mega?getMegaRareSlotWeights(set):getModernSVRareSlotWeights(set);
    for(const [key,target] of Object.entries(expected.art))close((1-g)*art[key]+100*g*(expected.god[key]||0),target,`${id}/${key}`);
    for(const [key,target] of Object.entries(expected.rare))close((1-g)*rare[key]+100*g*(expected.god[key]||0),target,`${id}/${key}`);
    for(const format of GOD_PACK_CONFIG[id].formats?.map(f=>f.format)||[GOD_PACK_CONFIG[id].format]) {
      const pack=generateForcedGodPack(set,undefined,format);assert.equal(pack.length,10);assert.equal(pack.isGodPack,true);
    }
  }
  const prismatic=find('prismatic-evolutions');
  close(getSubsetSlotConfig(prismatic).rates.aceSpecRare*(1-GOD_PACK_CONFIG[prismatic.id].odds),4.68);
});

test('product inserts remain resolvable and owned-visible without blocking booster completion', () => {
  const set=find('base-set'), id='base1-8';
  assert.equal(set.cards.length,102);
  assert.ok(resolveSavedCollectionCard(set,id));
  assert.equal(getPullableCollectionCards(set).length,101);
  assert.equal(getPackPools(set).cleanCards.some(c=>c.id===id),false);
  const saved={[set.id]:{[id]:{count:1,firstCollectedAt:1,lastCollectedAt:1}}};
  assert.ok(getCollectionVisibleCards(set,saved).some(c=>c.id===id));
});

test('VMAX and alternate artwork use distinct pull buckets without changing display rarity', () => {
  const set=find('evolving-skies');
  const check=(number,bucket)=>assert.equal(getFinalPullBucket(set.cards.find(c=>String(c.number)===number),set),bucket);
  check('95','vmaxOrVstar');check('188','fullArt');check('189','alternateArt');
  check('214','rainbowRare');check('215','alternateVmax');
});

test('a missing subset tier falls back to ordinary cards rather than a later hit tier', () => {
  const set=find('lost-origin');const pools=getPackPools(set);
  const incomplete={...pools,subsetPool:pools.subsetPool.filter(c=>/^TG(29|30)$/i.test(String(c.number)))};
  // Normal 82.68, regular TG 8.29: 86% selects the deliberately absent regular tier.
  const card=withRolls([.86,.5],()=>pickRegularOrSubsetSlot(incomplete,set));
  assert.ok(['common','uncommon','rare'].includes(getRarityCategory(card,set)));
});


test('Celebrations keeps Gold Mew on its scarce final-card route and weights Classic cards separately', () => {
  const set=find('celebrations'), profile=hardcodedPullRates.celebrations;
  assert.equal(profile.finalCardWeights['celebrations-25-mew'],2);
  assert.equal(Object.values(profile.finalCardWeights).reduce((a,b)=>a+b,0),540);
  assert.equal(Object.keys(profile.subsetCardWeights).length,25);
  assert.equal(profile.subsetCardWeights['celebrations-15-claydol'],15);
  assert.equal(profile.subsetCardWeights['celebrations-76-m-rayquaza-ex'],2);
  const id='celebrations-25-mew';
  const pack=withRolls([.5,.5,.5,.5,.9999,.5],()=>generateNormalPackOnly(set));
  assert.equal(pack[3].id,id);
  assert.equal(pack.length,4);
});
