export function getExploreBasePath(pathname = globalThis.location?.pathname || "") {
  return pathname.startsWith("/mobile-app") ? "/mobile-app/explore" : "/explore";
}

export function buildExplorePath(route, currentPathname) {
  const base = getExploreBasePath(currentPathname);
  if (!route || route.kind === "home") return base;
  if (route.kind === "search") return `${base}/search${route.query ? `?q=${encodeURIComponent(route.query)}` : ""}`;
  if (route.kind === "pokemonBrowse") return `${base}/pokemon`;
  if (route.kind === "pokemon") return `${base}/pokemon/${encodeURIComponent(route.id)}`;
  if (route.kind === "setBrowse") return `${base}/sets`;
  if (route.kind === "set") return `${base}/sets/${encodeURIComponent(route.id)}`;
  if (route.kind === "eraBrowse") return `${base}/eras`;
  if (route.kind === "era") return `${base}/eras/${encodeURIComponent(route.id)}`;
  return base;
}

export function parseExploreRoute(locationLike = globalThis.location) {
  const pathname = String(locationLike?.pathname || "").replace(/\/+$/, "");
  const marker = pathname.indexOf("/explore");
  if (marker < 0) return { kind: "home" };
  const parts = pathname.slice(marker + "/explore".length).split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "search") return { kind: "search", query: new URLSearchParams(locationLike?.search || "").get("q") || "" };
  if (parts[0] === "pokemon" && parts[1]) return { kind: "pokemon", id: Number(parts[1]) };
  if (parts[0] === "pokemon") return { kind: "pokemonBrowse" };
  if (parts[0] === "sets" && parts[1]) return { kind: "set", id: parts[1] };
  if (parts[0] === "sets") return { kind: "setBrowse" };
  if (parts[0] === "eras" && parts[1]) return { kind: "era", id: parts[1] };
  if (parts[0] === "eras") return { kind: "eraBrowse" };
  return { kind: "home" };
}
