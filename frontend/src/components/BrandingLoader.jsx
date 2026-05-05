import { useEffect } from "react";
import { api } from "../lib/api";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

function applyBranding(site) {
  if (!site) return;
  // Document title
  const title = site.brand_name
    ? `${site.brand_name}${site.brand_subtitle ? " · " + site.brand_subtitle : ""}`
    : "Voxyra CCA";
  document.title = title;
  // Favicon
  if (site.favicon_url) {
    const u = site.favicon_url.startsWith("http")
      ? site.favicon_url
      : BACKEND_URL + site.favicon_url;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = u;
  }
}

/** Loads global site branding once and applies favicon + title to <head>. */
export default function BrandingLoader() {
  useEffect(() => {
    api.get("/branding/site").then((r) => applyBranding(r.data)).catch(() => {});
    const onUpd = (e) => applyBranding(e.detail);
    window.addEventListener("voxyra:branding-updated", onUpd);
    return () => window.removeEventListener("voxyra:branding-updated", onUpd);
  }, []);
  return null;
}
