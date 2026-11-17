import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { activeSets } from '../src/data/sets.js';
import { VINTAGE_PULL_RATES } from '../src/data/vintagePullRates.js';
import { getVintagePackRule } from '../src/data/vintagePackRules.js';
import { getPullableCollectionCards } from '../src/utils/collectionStorage.js';
import {
  generatePack, generateNormalPackOnly, getPackPools, getPackSize,
  getPullRateProfile, getFinalSlotCategoryDiagnostics, getFinalPullBucket,
  getMegaRareSlotWeights, getMegaSecondFoilSlotWeights,
  getModernSVRareSlotWeights, getModernSVSecondFoilSlotWeights,
  getSubsetSlotConfig, getSubsetRateKey, getSubsetSlotWeight, getVintagePullBucket,
  getRarityCategory, buildXYFinalRareBuckets, isMegaSet, isModernSVSet, isXYSet,
} from '../src/utils/packGenerator.js';

function seeded(seed) {
  let n = 2166136261;
  for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n += 0x6d2b79f5; let v = n; v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; };
}
const total = (r) => Object.values(r).reduce((a,b) => a + Number(b), 0);
function channelsFor(set) {
  const p = getPullRateProfile(set), pools = getPackPools(set), rule = getVintagePackRule(set);
  const channels = [];
  const add = (name, index, weights, resolve, poolFor) => {
    const clean = Object.fromEntries(Object.entries(weights).filter(([,v]) => typeof v === 'number' && v > 0));
    if (Math.abs(total(clean) - 1) > 1e-7) throw Error(`${set.id}/${name} does not sum to one: ${total(clean)}`);
    channels.push({name,index,weights:clean,resolve,poolFor});
  };
  const byCategory = (key) => pools.cleanCards.filter(c => getRarityCategory(c,set) === key);
  const rawRC = (c) => String(c.number).startsWith('RC');
  if (set.id === '30th-celebration') {
    const slots = [{common:100},{common:100},p.secondFoilSlot,p.rareSlot,{pikachu:100}];
    slots.forEach((weights,i) => add(`slot${i+1}`,i,Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v/100])),c=>getRarityCategory(c,set),byCategory));
  } else if (set.id === 'celebrations') {
    const finalTotal=total(p.finalCardWeights), classicTotal=total(p.subsetCardWeights);
    add('finalCard',3,Object.fromEntries(Object.entries(p.finalCardWeights).map(([id,v])=>[id,v/finalTotal])),c=>c.id,key=>pools.finalSlotPool.filter(c=>c.id===key));
    add('classicCard',2,{normal:1-classicTotal/541,...Object.fromEntries(Object.entries(p.subsetCardWeights).map(([id,v])=>[id,v/541]))},c=>Object.hasOwn(p.subsetCardWeights,c.id)?c.id:'normal',key=>key==='normal'?pools.reverseSlotPool:pools.subsetPool.filter(c=>c.id===key));
  } else if (rule) {
    const spec = VINTAGE_PULL_RATES[set.id];
    const reverseIndex = rule.commonSlots + (rule.basicEnergySlots||0) + rule.uncommonSlots;
    const bucketPool = key => pools.cleanCards.filter(c=> !rawRC(c) && getVintagePullBucket(c,set) === key);
    if (rule.type === 'dragonVault') {
      add('secret',-1,{secretRare:5/121,normal:1-5/121},pack=>pack.some(c=>getRarityCategory(c,set)==='secretRare')?'secretRare':'normal',key=>key==='normal'?byCategory('holoRare'):byCategory('secretRare'));
    } else if (rule.type === 'ecard' || spec?.commonReplacement) {
      add('rare',getPackSize(set)-1,{rare:1},c=>getVintagePullBucket(c,set),bucketPool);
      const weights = spec?.commonReplacement || {normal:2/3,holo:1/3};
      add('commonReplacement',rule.commonSlots-1,weights,c=>c.packPullBucket || (['holoRare','secretRare'].includes(getRarityCategory(c,set))?'holo':'normal'),key=>key==='normal'?pools.commonPool:key==='holo'?pools.finalSlotPool.filter(c=>['holoRare','secretRare'].includes(getRarityCategory(c,set))):bucketPool(key));
    } else {
      const weights=spec?.rare || {rare:2/3,holoOrChase:1/3};
      add('rare',getPackSize(set)-1,weights,c=>spec?getVintagePullBucket(c,set):getRarityCategory(c,set)==='rare'?'rare':'holoOrChase',key=>key==='holoOrChase'?pools.finalSlotPool.filter(c=>getRarityCategory(c,set)!=='rare'):bucketPool(key));
    }
    if (rule.reverseSlots) {
      const weights = spec?.reverse || {normal:1};
      add('reverse',reverseIndex,weights,c=>c.packPullBucket || 'normal',key=>key==='normal'?pools.reverseSlotPool:bucketPool(key));
    }
    if (rule.type === 'legendaryTreasures') {
      add('radiantCommon',8,{common:1},c=>String(c.rarity).toLowerCase(),key=>pools.subsetPool.filter(c=>String(c.rarity).toLowerCase()===key));
      // Layout is C4/U2/reverse/RC common/RC uncommon-or-premium/Rare.
      channels.at(-1).index=7;
      add('radiantPremium',8,{premium:.30,uncommon:.70},c=>c.rarityCategory==='uncommon'?'uncommon':'premium',key=>pools.subsetPool.filter(c=>key==='premium'?!['common','uncommon'].includes(c.rarityCategory):c.rarityCategory==='uncommon'));
    }
  } else if (isXYSet(set)) {
    if (set.id !== 'xy0') {
      const buckets=buildXYFinalRareBuckets(pools,set);
      const weights=p.coreSlots?.finalRareSlot || p.finalRareSlot;
      // A missing sheet contributes no cards; verify the existing XY renormalization explicitly.
      const available = Object.fromEntries(Object.entries(weights).filter(([k,v])=>typeof v==='number' && v>0 && buckets[k]?.length));
      const sum=total(available);
      add('rare',p.coreCards ? p.coreCards-1 : p.packSize-1,Object.fromEntries(Object.entries(available).map(([k,v])=>[k,v/sum])),c=>Object.entries(buckets).find(([,cards])=>cards.some(x=>x.id===c.id))?.[0] || 'unknown',key=>buckets[key]);
      if (p.preRareSlot?.breakCard) {
        add('break',8,{breakRare:p.preRareSlot.breakCard,normal:1-p.preRareSlot.breakCard},c=>getRarityCategory(c,set)==='breakRare'?'breakRare':'normal',key=>key==='normal'?pools.reverseSlotPool:byCategory('breakRare'));
      }
      if (set.id==='g1') {
        add('radiantCommon',8,{common:1},c=>String(c.rarity).toLowerCase(),key=>pools.cleanCards.filter(c=>rawRC(c)&&String(c.rarity).toLowerCase()===key));
        add('radiantPremium',9,{premium:.28,uncommon:.72},c=>String(c.rarity).toLowerCase()==='uncommon'?'uncommon':'premium',key=>pools.cleanCards.filter(c=>rawRC(c)&&(key==='uncommon'?String(c.rarity).toLowerCase()==='uncommon':!['common','uncommon'].includes(String(c.rarity).toLowerCase()))));
      }
    }
  } else if (isMegaSet(set)||isModernSVSet(set)) {
    const art=isMegaSet(set)?getMegaSecondFoilSlotWeights(set):getModernSVSecondFoilSlotWeights(set);
    const rare=isMegaSet(set)?getMegaRareSlotWeights(set):getModernSVRareSlotWeights(set);
    const percentages = weights=>Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v/100]));
    add('art',8,percentages(art),c=>Object.hasOwn(art,getRarityCategory(c,set))?getRarityCategory(c,set):'normal',key=>key==='normal'?pools.reverseSlotPool:byCategory(key));
    add('rare',9,percentages(rare),c=>getRarityCategory(c,set)==='holoRare'?'rare':getRarityCategory(c,set),byCategory);
  } else {
    const diagnostics=getFinalSlotCategoryDiagnostics(pools.finalSlotPool,set);
    const weights=p.finalBuckets || diagnostics.activeWeights;
    const sum=total(weights);
    add('rare',getPackSize(set)-1,Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v/sum])),c=>p.finalBuckets?(getFinalPullBucket(c,set)==='holoRare' && !p.finalBuckets.holoRare?'rare':getFinalPullBucket(c,set)):getRarityCategory(c,set),key=>pools.finalSlotPool.filter(c=>p.finalBuckets?(key==='rare'?['rare','holoRare'].includes(getFinalPullBucket(c,set)):getFinalPullBucket(c,set)===key):getRarityCategory(c,set)===key));
  }
  if (!rule && !isXYSet(set) && !['30th-celebration','celebrations'].includes(set.id)) {
    const config=getSubsetSlotConfig(set);
    if(config) {
      const sum=total(config.rates);
      add('subset',isModernSVSet(set)?7:getPackSize(set)===4?2:8,Object.fromEntries(Object.entries(config.rates).map(([k,v])=>[k,v/sum])),c=>getSubsetSlotWeight(c,set)>0?getSubsetRateKey(c,set,config):'normal',key=>key==='normal'?pools.reverseSlotPool:pools.subsetPool.filter(c=>getSubsetRateKey(c,set,config)===key));
    }
  }
  return {channels,pools};
}

function auditSet(set,n) {
  const {channels,pools}=channelsFor(set), errors=[], warnings=[], routed=new Set();
  for(const channel of channels) {
    channel.counts={};
    for(const [key,weight] of Object.entries(channel.weights)) {
      const cards=channel.poolFor(key)||[];
      if(!cards.length) errors.push(`${channel.name}/${key}: positive rate with no card pool`);
      for(const card of cards)routed.add(card.id);
    }
  }
  // Guaranteed ordinary slots are additional positive routes.
  for(const card of [...pools.commonPool,...pools.uncommonPool])routed.add(card.id);
  const rule=getVintagePackRule(set);
  if(rule) {
    for(const card of pools.reverseSlotPool)routed.add(card.id);
    const forced=new Set(rule.basicEnergyFileNames||[]);
    for(const card of pools.cleanCards)if(forced.has(card.fileName))routed.add(card.id);
  } else if(set.id!=='detective-pikachu')for(const card of pools.reverseSlotPool)routed.add(card.id);
  if(set.id==='xy12')for(const card of buildXYFinalRareBuckets(pools,set).secretRare)routed.add(card.id);
  const eligible=getPullableCollectionCards(set);
  for(const card of eligible)if(!routed.has(card.id))errors.push(`UNREACHABLE ${card.id}`);
  Math.random=seeded(`effective-v1:${set.id}`);
  const seen=new Set(), ids=new Set(set.cards.map(c=>c.id));
  const started=Date.now();
  for(let i=0;i<n;i++) {
    const pack=generateNormalPackOnly(set);
    if(pack.length!==getPackSize(set))errors.push(`Wrong pack size ${pack.length}`);
    if(new Set(pack.map(c=>c.id)).size!==pack.length)errors.push('Duplicate card identity within pack');
    for(const card of pack) {
      if(!ids.has(card.id))errors.push(`Foreign card ${card.id}`);
      seen.add(card.id);
    }
    for(const channel of channels) {
      const key=channel.resolve(channel.index<0?pack:pack[channel.index]);
      channel.counts[key]=(channel.counts[key]||0)+1;
    }
  }
  const results=[];
  for(const channel of channels) {
    const keys=new Set([...Object.keys(channel.weights),...Object.keys(channel.counts)]);
    for(const key of keys) {
      const p=channel.weights[key]||0, count=channel.counts[key]||0, expected=n*p;
      // Bernstein-style conservative tail, union-safe for thousands of bins.
      // This is a software regression bound, not uncertainty in the physical study.
      const tolerance=6*Math.sqrt(n*p*(1-p))+12;
      if(p===0 && count || Math.abs(count-expected)>tolerance)errors.push(`${channel.name}/${key}: ${count}/${n} vs expected ${expected.toFixed(2)} (tolerance ${tolerance.toFixed(2)})`);
      results.push({slot:channel.name,bucket:key,expectedPercent:p*100,observedPercent:count/n*100,count});
    }
  }
  return {id:set.id,packCount:n,eligibleCards:eligible.length,positiveRouteCards:eligible.filter(c=>routed.has(c.id)).length,observedUnique:seen.size,milliseconds:Date.now()-started,evidence:getPullRateProfile(set).evidence||VINTAGE_PULL_RATES[set.id]?.evidence||'retained-format-estimate',sourceUrl:getPullRateProfile(set).sourceUrl||VINTAGE_PULL_RATES[set.id]?.sourceUrl||null,errors:[...new Set(errors)],warnings,slots:results};
}

if(!isMainThread) {
  for(const id of workerData.ids) {
    const set=activeSets.find(s=>s.id===id);
    try { parentPort.postMessage(auditSet(set,workerData.n)); }
    catch(error) {parentPort.postMessage({id,errors:[error.stack]});}
  }
} else {
  const value=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')||fallback;
  const n=Number(value('packs','1000')), jobs=Number(value('jobs','6'));
  const ids=value('sets','').split(',').filter(Boolean);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(jobs) || jobs < 1) throw Error('packs and jobs must be positive integers');
  const unknown = ids.filter(id => !activeSets.some(set => set.id === id));
  if (unknown.length) throw Error(`Unknown active sets: ${unknown.join(', ')}`);
  const selected=ids.length?activeSets.filter(s=>ids.includes(s.id)):activeSets;
  const output=value('output','audits/pull-rates/generated-outcomes.json');
  const groups=Array.from({length:Math.min(jobs,selected.length)},()=>[]);
  selected.forEach((s,i)=>groups[i%groups.length].push(s.id));
  const rows=[];
  await Promise.all(groups.map(ids=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{ids,n}});
    worker.on('message',row=>{rows.push(row);console.log(`${row.id}: ${row.errors.length?'FAIL '+row.errors.join('; '):'OK'} (${row.packCount||0} packs)`);});
    worker.on('error',reject);worker.on('exit',code=>code?reject(Error(`worker exit ${code}`)):resolve());
  })));
  rows.sort((a,b)=>a.id.localeCompare(b.id));
  const result={schemaVersion:1,seed:'effective-v1:<set-id>',samplePacksPerSet:n,sets:rows,summary:{sets:rows.length,packs:rows.reduce((a,r)=>a+(r.packCount||0),0),errors:rows.reduce((a,r)=>a+r.errors.length,0),eligibleCards:rows.reduce((a,r)=>a+(r.eligibleCards||0),0),positiveRouteCards:rows.reduce((a,r)=>a+(r.positiveRouteCards||0),0)}};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result.summary));
  if(result.summary.errors)process.exitCode=1;
}
