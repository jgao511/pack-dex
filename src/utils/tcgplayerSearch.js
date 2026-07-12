const TCGPLAYER_SEARCH_URL = "https://www.tcgplayer.com/search/pokemon/product";

export function getTcgplayerSearchNumber(cardNumber) {
  const value = String(cardNumber ?? "").trim();
  if (!value) return "";

  const numberedCard = value.match(/^(\d+)(?:\s*\/\s*\d+)?$/);
  if (numberedCard) return `#${Number.parseInt(numberedCard[1], 10)}`;

  return `#${value.replace(/^#+\s*/, "")}`;
}

export function getTcgplayerSearchUrl({ cardName, setName, cardNumber } = {}) {
  const name = String(cardName ?? "").trim();
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
  if (exactUrl) {
    try {
      const url = new URL(String(exactUrl));
      if (url.protocol === "https:" && /(^|\.)tcgplayer\.com$/i.test(url.hostname)) return url.toString();
    } catch {
      // Fall through to the trusted catalog search.
    }
  }
  return getTcgplayerSearchUrl({ cardName, setName, cardNumber });
}
