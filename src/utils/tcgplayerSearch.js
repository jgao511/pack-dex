const TCGPLAYER_SEARCH_URL = "https://www.tcgplayer.com/search/pokemon/product";

export function getTcgplayerSearchNumber(cardNumber) {
  const value = String(cardNumber ?? "").trim();
  if (!value) return "";
  return `#${value.replace(/^#+\s*/, "")}`;
}

export function getCanonicalTcgplayerSearchName(cardName) {
  const value = String(cardName ?? "")
    .replace(/[★⭐]/gu, " Star ")
    .replace(/[\uFE0E\uFE0F]/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
  const decorationProbe = value.replace(/[♀♂]/gu, "");
  if (!value || /\p{Extended_Pictographic}/u.test(decorationProbe)) return "";
  return value;
}

export function getTcgplayerSearchUrl({ cardName, setName, cardNumber } = {}) {
  const name = getCanonicalTcgplayerSearchName(cardName);
  const set = String(setName ?? "").trim();
  const number = getTcgplayerSearchNumber(cardNumber);

  // All three fields are required to avoid ambiguous searches across printings.
  if (!name || !set || !number) return null;

  const searchUrl = new URL(TCGPLAYER_SEARCH_URL);
  searchUrl.searchParams.set("productLineName", "pokemon");
  searchUrl.searchParams.set("q", `${name} ${set} ${number}`);
  return searchUrl.toString();
}

export function getTcgplayerCardUrl({ exactUrl, cardName, setName, cardNumber } = {}) {
  return getTcgplayerDestination({ exactUrl, cardName, setName, cardNumber })?.url || null;
}

export function getTcgplayerDestination({ exactUrl, cardName, setName, cardNumber } = {}) {
  if (exactUrl) {
    try {
      const url = new URL(String(exactUrl));
      const isDirectTcgplayer = /(^|\.)tcgplayer\.com$/i.test(url.hostname);
      const isPokemonTcgCanonicalRedirect = url.hostname.toLowerCase() === "prices.pokemontcg.io" && url.pathname.startsWith("/tcgplayer/");
      if (url.protocol === "https:" && (isDirectTcgplayer || isPokemonTcgCanonicalRedirect)) {
        return { url: url.toString(), isExact: true, label: "View on TCGplayer" };
      }
    } catch {
      // Fall through to the trusted catalog search.
    }
  }
  const searchUrl = getTcgplayerSearchUrl({ cardName, setName, cardNumber });
  return searchUrl ? { url: searchUrl, isExact: false, label: "Search on TCGplayer" } : null;
}
