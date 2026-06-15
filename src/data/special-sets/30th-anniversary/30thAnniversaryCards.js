const SET_ID = "30th-anniversary";
const CARD_IMAGE_BASE = `/assets/sets/${SET_ID}/cards`;

function card(number, name, rarity, rarityCategory, fileName) {
  return {
    id: `${SET_ID}-${number}-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
    setId: SET_ID,
    set: SET_ID,
    setName: "Pokemon 30th Anniversary",
    number,
    name,
    rarity,
    rarityCategory,
    image: `${CARD_IMAGE_BASE}/${fileName}`,
    fileName,
  };
}

export const thirtiethAnniversaryCards = [
  card("004", "Charizard", "Classic", "classic", "004_charizard_classic.webp"),
  card("014", "Pikachu", "Pikachu", "pikachu", "014_pikachu_pikachu.webp"),
  card("015", "Pikachu", "Pikachu", "pikachu", "015_pikachu_pikachu.webp"),
  card("021", "Greninja ex", "Double Rare", "doubleRare", "021_greninja_ex_double_rare.webp"),
  card("025", "Pikachu", "Pikachu", "pikachu", "025_pikachu_pikachu.webp"),
  card("033", "Pikachu & Zekrom-GX", "Classic", "classic", "033_pikachu_zekrom_gx_classic.webp"),
  card("069", "Espeon", "Common", "common", "069_espeon_common.webp"),
  card("071", "Sylveon ex", "Double Rare", "doubleRare", "071_sylveon_ex_double_rare.webp"),
  card("091", "Umbreon", "Common", "common", "091_umbreon_common.webp"),
  card("131", "Lapras", "Illustration Rare", "illustrationRare", "131_lapras_illustration_rare.webp"),
  card("136", "Drifloon", "Illustration Rare", "illustrationRare", "136_drifloon_illustration_rare.webp"),
  card("138", "Lycanroc", "Illustration Rare", "illustrationRare", "138_lycanroc_illustration_rare.webp"),
  card("145", "Hisuian Zorua", "Illustration Rare", "illustrationRare", "145_hisuian_zorua_illustration_rare.webp"),
  card("157", "Mewtwo ex", "Futuristic Rare", "futuristicRare", "157_mewtwo_ex_futuristic_rare.webp"),
  card("158", "Mew ex", "Futuristic Rare", "futuristicRare", "158_mew_ex_futuristic_rare.webp"),
];

export const thirtiethAnniversaryCardFileNames = thirtiethAnniversaryCards.map((card) => card.fileName);

