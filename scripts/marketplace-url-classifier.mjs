import {
  normalizeCanonicalName,
  normalizeCollectorNumber,
} from "../supabase/functions/_shared/cardPricing.js";

function compact(value) {
  return String(value ?? "").trim();
}

export function isApprovedTcgplayerHost(hostname) {
  const host = compact(hostname).toLowerCase();
  return host === "tcgplayer.com" || host === "www.tcgplayer.com" || host.endsWith(".tcgplayer.com");
}

export function getTcgplayerProductId(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/\/product\/(\d+)/i)?.[1] || parsed.searchParams.get("productId") || null;
  } catch {
    return null;
  }
}

function normalizeProductName(value) {
  const providerAliases = [
    [/\bNidoran F\b/giu, "Nidoran Female"],
    [/\bNidoran M\b/giu, "Nidoran Male"],
    [/\bDrowsee\b/giu, "Drowzee"],
    [/\bDark Exeggcutor\b/giu, "Dark Exeggutor"],
    [/\bImposter Professor Oak\b/giu, "Impostor Professor Oak"],
    [/\bTechnical Mach\. G\b/giu, "Technical Machine G"],
    [/\bHeat R Energy\b/giu, "Heat Fire Energy"],
    [/\bHiding D Energy\b/giu, "Hiding Darkness Energy"],
    [/\bPowerful C Energy\b/giu, "Powerful Colorless Energy"],
    [/\bHorror P Energy\b/giu, "Horror Psychic Energy"],
    [/\bSpeed L Energy\b/giu, "Speed Lightning Energy"],
    [/\bUnit Energy GRW\b/giu, "Unit Energy GrassFireWater"],
    [/\bUnit Energy LPM\b/giu, "Unit Energy LightningPsychicMetal"],
    [/\bUnit Energy FDY\b/giu, "Unit Energy FightingDarknessFairy"],
    [/\bBlend Energy WLFM\b/giu, "Blend Energy WaterLightningFightingMetal"],
    [/\bBlend Energy GFPD\b/giu, "Blend Energy GrassFirePsychicDarkness"],
    [/\bFairy Charm O\b/giu, "Fairy Charm Dragon"],
    [/\bBubbly W Energy\b/giu, "Bubbly Water Energy"],
    [/\bNitro R Energy\b/giu, "Nitro Fire Energy"],
  ];
  let productName = compact(value).replace(/\s+-\s+[#a-z]*\d+[a-z]*(?:\s*\/\s*[#a-z]*\d+[a-z]*)?\s*$/iu, "");
  for (const [pattern, replacement] of providerAliases) productName = productName.replace(pattern, replacement);
  return normalizeCanonicalName(productName);
}

function numberMatches(expected, actual) {
  const expectedNormalized = normalizeCollectorNumber(expected);
  const actualNormalized = normalizeCollectorNumber(actual);
  if (!expectedNormalized || !actualNormalized) return false;
  if (expectedNormalized === actualNormalized) return true;
  return expectedNormalized.split("/")[0] === actualNormalized.split("/")[0];
}

function textContainsIdentity(container, expected) {
  const normalizeIdentityText = (value) => normalizeCanonicalName(value).replace(/\bimposter\b/gu, "impostor");
  const normalizedContainer = normalizeIdentityText(container);
  const normalizedExpected = normalizeIdentityText(expected);
  return Boolean(normalizedContainer && normalizedExpected && (
    normalizedContainer === normalizedExpected ||
    normalizedContainer.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedContainer)
  ));
}

function normalizeSetIdentity(value) {
  let normalized = normalizeCanonicalName(value)
    .replace(/\b(?:pokemon|the|and)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  normalized = normalized.replace(/^[a-z]{1,6}\d+(?:\.\d+)?\s+/u, "");
  normalized = normalized
    .replace(/^sm(?:\d+(?:\.\d+)?)?\b/gu, "sun moon")
    .replace(/^swsh(?:\d+(?:\.\d+)?)?\b/gu, "sword shield")
    .replace(/^sv(?:\d+(?:\.\d+)?)?\b/gu, "scarlet violet")
    .replace(/^bw(?:\d+)?\b/gu, "black white")
    .replace(/^hgss\b/gu, "heartgold soulsilver")
    .replace(/^me(?:\d+(?:\.\d+)?)?\b/gu, "mega evolution")
    .replace(/^xy(?:\d+)?\b/gu, "xy")
    .replace(/\s+/gu, " ")
    .trim();
  normalized = normalized.replace(/^((?:sun moon|sword shield|scarlet violet|black white|xy))\s+\1\b/gu, "$1");
  normalized = normalized
    .replace(/^(?:ex|hs)\s+/gu, "")
    .replace(/^(sun moon|sword shield|scarlet violet|black white|xy) base set$/u, "$1")
    .replace(/\bset\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized === "expedition base") normalized = "expedition";
  return normalized;
}

function setIdentityMatches(actual, expected) {
  const normalizedActual = normalizeSetIdentity(actual);
  const normalizedExpected = normalizeSetIdentity(expected);
  if (!normalizedActual || !normalizedExpected) return false;
  if (normalizedActual === normalizedExpected) return true;
  if (normalizedActual === `${normalizedExpected} radiant collection`) return true;
  const eraPrefixes = ["sun moon", "sword shield", "scarlet violet", "black white", "xy", "mega evolution"];
  return eraPrefixes.some((prefix) =>
    normalizedActual === `${prefix} ${normalizedExpected}` || normalizedExpected === `${prefix} ${normalizedActual}`
  );
}

export function classifyTcgplayerProductDetails(details, expected) {
  const detailName = details?.productName || details?.name || "";
  const detailNumber = details?.customAttributes?.number || details?.number || "";
  const detailSetName = details?.setName || "";
  const nameMatch = textContainsIdentity(normalizeProductName(detailName), expected.name);
  const numberMatch = numberMatches(expected.number, detailNumber);
  const setMatch = setIdentityMatches(detailSetName, expected.apiSetName || expected.setName) || Boolean(
    (/alternate art promos/iu.test(detailSetName) && /[a-z]$/iu.test(String(expected.number || ""))) ||
    (/deck exclusives/iu.test(detailSetName) && /^base(?: set)?$/iu.test(expected.apiSetName || expected.setName || "") && nameMatch && numberMatch && normalizeCollectorNumber(expected.number) === "8")
  );

  if (nameMatch && numberMatch && setMatch) {
    return { classification: "A", reason: "exact_verified_product", nameMatch, numberMatch, setMatch };
  }
  // A conflicting collector number or set proves a different printing. A
  // title-only discrepancy can also be a provider spelling defect, so keep it
  // unverifiable rather than incorrectly declaring the exact product wrong.
  if ((!numberMatch && detailNumber) || (!setMatch && detailSetName)) {
    return { classification: "C", reason: "product_identity_mismatch", nameMatch, numberMatch, setMatch };
  }
  return { classification: "E", reason: "product_identity_unverifiable", nameMatch, numberMatch, setMatch };
}

export function classifyTcgplayerTerminalDestination({ hopCount, lastStatus, finalStatus, finalUrl }) {
  if (hopCount >= 10 && [301, 302, 303, 307, 308].includes(lastStatus)) {
    return { classification: "D", reason: "redirect_loop_or_limit" };
  }
  if (!finalStatus || finalStatus < 200 || finalStatus >= 400) {
    return { classification: "D", reason: "unreachable_final_status" };
  }
  let parsed;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return { classification: "D", reason: "invalid_final_url" };
  }
  if (!isApprovedTcgplayerHost(parsed.hostname)) {
    return { classification: "C", reason: "unapproved_final_host" };
  }
  const productId = getTcgplayerProductId(finalUrl);
  if (!productId) {
    const classification = /search|productlisting|category/.test(parsed.pathname.toLowerCase()) ? "B" : "E";
    return { classification, reason: classification === "B" ? "generic_or_search_destination" : "missing_product_id" };
  }
  return { classification: null, reason: "product_details_required", productId };
}
