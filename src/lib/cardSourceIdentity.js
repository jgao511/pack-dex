import officialSetMetadata from "../data/officialSetMetadata.json" with { type: "json" };

export const CARD_SUBSET_SOURCE_IDS = Object.freeze({
  "hidden-fates": { "Shiny Vault": "sma" },
  "shining-fates": { "Shiny Vault": "swsh45sv" },
  celebrations: { "Classic Collection": "cel25c" },
  "brilliant-stars": { "Trainer Gallery": "swsh9tg" },
  "astral-radiance": { "Trainer Gallery": "swsh10tg" },
  "lost-origin": { "Trainer Gallery": "swsh11tg" },
  "silver-tempest": { "Trainer Gallery": "swsh12tg" },
  "crown-zenith": { "Galarian Gallery": "swsh12pt5gg" },
});

const PROVIDER_CARD_ID_OVERRIDES = Object.freeze({
  "black-bolt-60-antique-cover-fossil": "zsv10pt5-80",
  "celebrations-2-blastoise": "cel25c-2_A",
  "celebrations-4-charizard": "cel25c-4_A",
  "celebrations-8-dark-gyarados": "cel25c-8_A",
  "celebrations-9-team-magma-s-groudon": "cel25c-9_A",
  "celebrations-15-claydol": "cel25c-15_A4",
  "celebrations-15-here-comes-team-rocket": "cel25c-15_A2",
  "celebrations-15-rocket-s-zapdos": "cel25c-15_A3",
  "celebrations-15-venusaur": "cel25c-15_A1",
  "celebrations-17-umbreon": "cel25c-17_A",
  "celebrations-20-cleffa": "cel25c-20_A",
  "celebrations-24-s-pikachu": "cel25c-24_A",
  "celebrations-54-mewtwo-ex": "cel25c-54_A",
  "celebrations-60-tapu-lele-gx": "cel25c-60_A",
  "celebrations-66-shining-magikarp": "cel25c-66_A",
  "celebrations-73-imposter-professor-oak": "cel25c-73_A",
  "celebrations-76-m-rayquaza-ex": "cel25c-76_A",
  "celebrations-86-rocket-s-admin": "cel25c-86_A",
  "celebrations-88-mew-ex": "cel25c-88_A",
  "celebrations-93-gardevoir-ex": "cel25c-93_A",
  "celebrations-97-xerneas-ex": "cel25c-97_A",
  "celebrations-107-donphan": "cel25c-107_A",
  "celebrations-109-luxray-gl-lv-x": "cel25c-109_A",
  "celebrations-113-reshiram": "cel25c-113_A",
  "celebrations-114-zekrom": "cel25c-114_A",
  "celebrations-145-garchomp-c-lv-x": "cel25c-145_A",
});

const PRINTED_TOTAL_OVERRIDES = Object.freeze({
  "celebrations-2-blastoise": "102",
  "celebrations-4-charizard": "102",
  "celebrations-8-dark-gyarados": "82",
  "celebrations-9-team-magma-s-groudon": "95",
  "celebrations-15-claydol": "106",
  "celebrations-15-here-comes-team-rocket": "82",
  "celebrations-15-rocket-s-zapdos": "132",
  "celebrations-15-venusaur": "102",
  "celebrations-17-umbreon": "17",
  "celebrations-20-cleffa": "111",
  "celebrations-24-s-pikachu": "",
  "celebrations-54-mewtwo-ex": "99",
  "celebrations-60-tapu-lele-gx": "145",
  "celebrations-66-shining-magikarp": "64",
  "celebrations-73-imposter-professor-oak": "102",
  "celebrations-76-m-rayquaza-ex": "108",
  "celebrations-86-rocket-s-admin": "109",
  "celebrations-88-mew-ex": "92",
  "celebrations-93-gardevoir-ex": "101",
  "celebrations-97-xerneas-ex": "146",
  "celebrations-107-donphan": "123",
  "celebrations-109-luxray-gl-lv-x": "111",
  "celebrations-113-reshiram": "114",
  "celebrations-114-zekrom": "114",
  "celebrations-145-garchomp-c-lv-x": "147",
});

const SET_PREFIX_PRINTED_TOTAL_OVERRIDES = Object.freeze({
  aquapolis: { H: "32" },
  skyridge: { H: "32" },
  "diamond-pearl-stormfront": { SH: "" },
  platinum: { SH: "" },
  "platinum-rising-rivals": { RT: "" },
  "platinum-supreme-victors": { SH: "" },
  "platinum-arceus": { AR: "", SH: "" },
  "call-of-legends": { SL: "" },
  "black-white-legendary-treasures": { RC: "25" },
  g1: { RC: "32" },
  "hidden-fates": { SV: "94" },
  "shining-fates": { SV: "122" },
  "brilliant-stars": { TG: "30" },
  "astral-radiance": { TG: "30" },
  "lost-origin": { TG: "30" },
  "silver-tempest": { TG: "30" },
  "crown-zenith": { GG: "70" },
});

function normalizeCardNumber(value) {
  return String(value || "").trim().replace(/^0+(\d)/, "$1").toLowerCase();
}

export function getCardSourceSetId(card, setId) {
  return (
    card?.sourceSetId ||
    CARD_SUBSET_SOURCE_IDS[setId]?.[card?.subset] ||
    officialSetMetadata[setId]?.sourceSetId ||
    null
  );
}

export function getCardSourceSetIds(setId) {
  return [...new Set([
    officialSetMetadata[setId]?.sourceSetId,
    ...Object.values(CARD_SUBSET_SOURCE_IDS[setId] || {}),
  ].filter(Boolean))];
}

export function getCardSourceId(card, setId) {
  const explicit =
    card?.sourceCardId ||
    card?.providerCardId ||
    card?.apiCardId ||
    card?.pokemonTcgId ||
    card?.apiId ||
    PROVIDER_CARD_ID_OVERRIDES[card?.id];
  if (explicit) return String(explicit);

  const sourceSetId = getCardSourceSetId(card, setId);
  const number = normalizeCardNumber(card?.number);
  return sourceSetId && number ? `${sourceSetId}-${number}` : null;
}

export function getCardPrintedTotalOverride(card) {
  if (!Object.prototype.hasOwnProperty.call(PRINTED_TOTAL_OVERRIDES, card?.id)) return null;
  return PRINTED_TOTAL_OVERRIDES[card.id];
}

export function getSetPrefixPrintedTotalOverride(setId, prefix) {
  const overrides = SET_PREFIX_PRINTED_TOTAL_OVERRIDES[setId];
  if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, prefix)) return null;
  return overrides[prefix];
}
