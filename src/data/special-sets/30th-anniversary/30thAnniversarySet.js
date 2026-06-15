import { thirtiethAnniversaryCards } from "./30thAnniversaryCards.js";
import { THIRTIETH_ANNIVERSARY_PACK_CONFIG } from "./30thAnniversaryRates.js";

export const THIRTIETH_ANNIVERSARY_SET_ID = "30th-anniversary";
export const THIRTIETH_ANNIVERSARY_ERA = "Pokemon 30th Anniversary";
export const THIRTIETH_ANNIVERSARY_PREVIEW_NOTE =
  "This is a temporary preview using the cards revealed so far. The full 30th Anniversary set will be added once more cards are officially revealed.";

export const thirtiethAnniversarySetMetadata = {
  era: THIRTIETH_ANNIVERSARY_ERA,
  releaseDate: "2026-06-14",
  isNew: true,
  isPreview: true,
  previewNote: THIRTIETH_ANNIVERSARY_PREVIEW_NOTE,
  eraLogoPath: "/set-logos/30th-anniversary-main.png",
  pullRateProfile: "thirtiethAnniversaryPreview",
  packConfig: THIRTIETH_ANNIVERSARY_PACK_CONFIG,
};

export const thirtiethAnniversarySetDefinition = {
  id: THIRTIETH_ANNIVERSARY_SET_ID,
  name: "Pokemon 30th Anniversary",
  cards: thirtiethAnniversaryCards,
  metadata: thirtiethAnniversarySetMetadata,
};
