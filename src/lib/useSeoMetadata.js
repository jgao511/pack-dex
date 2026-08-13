import { useEffect } from "react";

function upsertMeta(attribute, value, content) {
  if (!content) return;
  let element = document.head.querySelector(`meta[${attribute}="${value}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, value);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function removeMeta(attribute, value) {
  document.head.querySelector(`meta[${attribute}="${value}"]`)?.remove();
}

function upsertCanonical(url) {
  let element = document.head.querySelector('link[rel="canonical"]');
  if (!url) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", url);
}

function replaceJsonLd(entries = []) {
  document.head.querySelectorAll('script[data-packdex-route-schema="true"]').forEach((node) => node.remove());
  entries.forEach((entry) => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.packdexRouteSchema = "true";
    script.textContent = JSON.stringify(entry).replace(/</g, "\\u003c");
    document.head.appendChild(script);
  });
}

export function applySeoMetadata(descriptor) {
  if (!descriptor || typeof document === "undefined") return;

  document.title = descriptor.title;
  upsertMeta("name", "description", descriptor.description);
  upsertMeta("name", "robots", descriptor.robots);
  upsertCanonical(descriptor.canonicalUrl);

  const openGraph = descriptor.openGraph || {};
  upsertMeta("property", "og:type", openGraph.type);
  upsertMeta("property", "og:site_name", openGraph.siteName);
  upsertMeta("property", "og:title", openGraph.title);
  upsertMeta("property", "og:description", openGraph.description);
  if (openGraph.url) upsertMeta("property", "og:url", openGraph.url);
  else removeMeta("property", "og:url");
  if (openGraph.image) upsertMeta("property", "og:image", openGraph.image);
  else removeMeta("property", "og:image");

  const twitter = descriptor.twitter || {};
  upsertMeta("name", "twitter:card", twitter.card);
  upsertMeta("name", "twitter:title", twitter.title);
  upsertMeta("name", "twitter:description", twitter.description);
  if (twitter.image) upsertMeta("name", "twitter:image", twitter.image);
  else removeMeta("name", "twitter:image");

  replaceJsonLd(descriptor.jsonLd);
}

export default function useSeoMetadata(descriptor) {
  useEffect(() => {
    applySeoMetadata(descriptor);
  }, [descriptor]);
}
