import { Capacitor } from "@capacitor/core";

export function getExternalHttpUrl(anchor, locationRef = globalThis.location) {
  const href = anchor?.getAttribute?.("href");
  if (!href || !locationRef?.href) return null;
  try {
    const url = new URL(href, locationRef.href);
    if (!/^https?:$/.test(url.protocol) || url.origin === locationRef.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function installNativeExternalLinkRouting({
  capacitor = Capacitor,
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  openBrowser = async (url) => {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  },
} = {}) {
  if (!documentRef?.addEventListener || !capacitor?.isNativePlatform?.()) return () => {};
  const onClick = (event) => {
    const anchor = event.target?.closest?.("a[href]");
    const url = getExternalHttpUrl(anchor, locationRef);
    if (!url || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void openBrowser(url);
  };
  documentRef.addEventListener("click", onClick);
  return () => documentRef.removeEventListener("click", onClick);
}

export const installIosExternalLinkRouting = installNativeExternalLinkRouting;
