import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSets, NEWEST_SET_ID } from '../src/data/sets.js';
import { generatePack, getPackPools } from '../src/utils/packGenerator.js';
import { markCardsCollected, saveCollection, loadCollection, getCardCount, getSetCollectionProgress } from '../src/utils/collectionStorage.js';
import { loadCloudCollectionPages } from '../src/lib/cloudCollectionPagination.js';
import { appendCloudRowsToCollection as desktop } from '../src/lib/cloudCollection.js';
import { appendCloudRowsToCollection as mobile } from '../mobile-app/src/lib/cloudCollection.js';
import { searchCollectionCatalog } from '../mobile-app/src/explore/exploreData.js';
import { resolveCatalogWishlistItem } from '../mobile-app/src/lib/wishlist.js';
const set=activeSets.find(s=>s.id==='delta-reign');
test('Delta Reign registers all 141 numbered cards with small images and stable IDs',()=>{
 assert.equal(NEWEST_SET_ID,set.id);assert.equal(set.cards.length,141);assert.equal(set.printedTotal,103);assert.equal(set.era,'Mega Evolution');
 assert.equal(new Set(set.cards.map(c=>c.id)).size,141);
 assert.deepEqual(set.cards.map(c=>Number(c.number)),Array.from({length:141},(_,i)=>i+1));
 assert.ok(set.cards.every(c=>c.image.endsWith('/small')));
 assert.equal(getPackPools(set).cleanCards.length,141);
});
test('1000 Delta Reign packs survive exact-quantity local reload',()=>{
 let collection={}; const counts=new Map();
 for(let i=0;i<1000;i++){const pack=generatePack(set);assert.equal(pack.length,10);for(const card of pack){assert.ok(set.cards.some(c=>c.id===card.id));counts.set(card.id,(counts.get(card.id)||0)+1);}collection=markCardsCollected(collection,pack,set.id);}
 let value;const storage={getItem:()=>value,setItem:(_,s)=>{value=s;}};saveCollection(collection,storage);const restored=loadCollection(storage);
 for(const c of set.cards)assert.equal(getCardCount(restored,c,set.id),counts.get(c.id)||0);
 assert.equal(Object.values(restored[set.id]).reduce((n,c)=>n+c.count,0),10000);
});
test('desktop and mobile rehydrate every Delta Reign card after 1505 earlier rows',async()=>{
 const rows=Array.from({length:1505},(_,i)=>({id:String(i),set_id:'earlier',card_id:String(i),quantity:1})).concat(set.cards.map(c=>({id:c.id,set_id:set.id,card_id:c.id,quantity:3})));
 for(const append of [desktop,mobile]){const collection={};const ranges=[];const client={from(){return{select(){return this;},eq(){return this;},order(){return this;},async range(a,b){ranges.push([a,b]);return{data:rows.slice(a,b+1),error:null};}};}};
 assert.equal(await loadCloudCollectionPages(client,'release-check',page=>append(collection,page)),1646);assert.deepEqual(ranges,[[0,999],[1000,1999]]);for(const c of set.cards)assert.equal(getCardCount(collection,c,set.id),3);assert.equal(getSetCollectionProgress(collection,set).percent,100);}
});
test('search and wishlist resolve all Delta Reign cards',()=>{
 assert.equal(searchCollectionCatalog('Delta Reign',200).filter(e=>e.set.id===set.id).length,141);for(const c of set.cards)assert.equal(resolveCatalogWishlistItem(set.id,c.id).card.id,c.id);
});
