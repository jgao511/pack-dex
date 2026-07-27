import { getSetAssetUrl } from "../utils/assetUrls.js";

const card = (name, path) => ({ name, src: getSetAssetUrl(path) });

// Shared curated groups used by the public welcome page and mobile onboarding.
export const welcomeHeroGroups = [
  {
    id: "151",
    name: "Scarlet & Violet—151",
    logo: "/set-logos/151.png",
    logoAlt: "Pokémon 151 set logo",
    cards: [
      card("Venusaur ex", "151/cards/198_Venusaur_ex_Special_Illustration_Rare.png"),
      card("Charizard ex", "151/cards/199_Charizard_ex_Special_Illustration_Rare.png"),
      card("Blastoise ex", "151/cards/200_Blastoise_ex_Special_Illustration_Rare.png"),
    ],
  },
  {
    id: "crown-zenith",
    name: "Crown Zenith",
    logo: "/set-logos/crown-zenith.png",
    logoAlt: "Crown Zenith set logo",
    cards: [
      card("Arceus VSTAR", "crown-zenith/cards/GG70_Arceus_VSTAR_Rare_Secret_swsh12pt5gg-gg70.png"),
      card("Giratina VSTAR", "crown-zenith/cards/GG69_Giratina_VSTAR_Rare_Secret_swsh12pt5gg-gg69.png"),
      card("Origin Forme Dialga VSTAR", "crown-zenith/cards/GG68_Origin_Forme_Dialga_VSTAR_Rare_Secret_swsh12pt5gg-gg68.png"),
    ],
  },
  {
    id: "prismatic-evolutions",
    name: "Scarlet & Violet—Prismatic Evolutions",
    logo: "/set-logos/prismatic-evolutions.png",
    logoAlt: "Prismatic Evolutions set logo",
    cards: [
      card("Umbreon ex", "prismatic-evolutions/cards/161_Umbreon_ex_Special_Illustration_Rare.png"),
      card("Sylveon ex", "prismatic-evolutions/cards/156_Sylveon_ex_Special_Illustration_Rare.png"),
      card("Espeon ex", "prismatic-evolutions/cards/155_Espeon_ex_Special_Illustration_Rare.png"),
    ],
  },
  {
    id: "pitch-black",
    name: "Mega Evolution—Pitch Black",
    logo: "/set-logos/pitch-black.png",
    logoAlt: "Pitch Black set logo",
    cards: [
      card("Mega Zeraora ex", "pitch-black/cards/114_Mega_Zeraora_ex_Special_Illustration_Rare.png"),
      card("Mega Darkrai ex", "pitch-black/cards/116_Mega_Darkrai_ex_Special_Illustration_Rare.png"),
      card("Mega Chandelure ex", "pitch-black/cards/115_Mega_Chandelure_ex_Special_Illustration_Rare.png"),
    ],
  },
];
