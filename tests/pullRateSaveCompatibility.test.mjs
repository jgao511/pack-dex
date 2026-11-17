import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSets } from '../src/data/sets.js';
import { generateNormalPackOnly, generateForcedGodPack, GOD_PACK_CONFIG } from '../src/utils/packGenerator.js';
import * as desktop from '../src/lib/cloudCollection.js';
import * as mobile from '../mobile-app/src/lib/cloudCollection.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

for (const [surface, api] of [['desktop', desktop], ['mobile', mobile]]) {
  test(`${surface}: generated packs from every active set survive queue serialization and acknowledged saves`, async () => {
    let tested = 0;
    for (const set of activeSets) {
      const packs = [generateNormalPackOnly(set)];
      const god = GOD_PACK_CONFIG[set.id];
      if (god?.enabled) {
        for (const format of god.formats?.map(f => f.format) || [god.format]) {
          packs.push(generateForcedGodPack(set, undefined, format));
        }
      }
      for (const [index, pack] of packs.entries()) {
        const storage = new MemoryStorage(), user = `save-test-${surface}-${set.id}-${index}`;
        const event = `pull-rate-${surface}-${set.id}-${index}`;
        const expected = pack.map(card => ({card_id:card.id,set_id:set.id,quantity:1})).sort((a,b)=>a.card_id.localeCompare(b.card_id));
        const canonical = new Set(set.cards.map(c=>c.id));
        assert.ok(expected.every(row=>canonical.has(row.card_id)),`${set.id}: foreign save identity`);
        api.enqueuePendingCloudPull(pack,set.id,user,event,{storage});
        assert.equal(api.getPendingCloudPullCount(user,storage),1);
        let calls=0;
        const client={async rpc(_name,payload) {
          calls++;
          assert.equal(payload.batches.length,1);
          const batch=payload.batches[0];
          assert.equal(batch.client_event_id,event);
          assert.deepEqual([...batch.cards].sort((a,b)=>a.card_id.localeCompare(b.card_id)),expected);
          return {data:[{client_event_id:event,accepted:true,recorded:true,already_processed:false}],error:null};
        }};
        const options={client,storage,validateUser:false,autoRetry:false,requestTimeoutMs:0};
        const saved=await api.syncPendingCloudPulls(user,options);
        assert.equal(saved.saved,1);
        assert.equal(api.getPendingCloudPullCount(user,storage),0);
        await api.syncPendingCloudPulls(user,options);
        assert.equal(calls,1,`${set.id}: acknowledged pack submitted twice`);
        tested++;
      }
    }
    assert.ok(tested>=activeSets.length+6,'all supported rare formats exercised');
  });
}
