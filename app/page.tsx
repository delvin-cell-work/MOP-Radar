import { preconnect, preload } from "react-dom";

import ResultsScreen from "@/components/ResultsScreen";
import { alertStoreConfig } from "@/lib/alert-store";
import { dataUrl } from "@/lib/data-client";

export default function HomePage() {
  // The national view needs only the town summary and the default tab's map points.
  for (const href of [dataUrl.meta(), dataUrl.map("just_mopped")]) {
    preload(href, { as: "fetch", crossOrigin: "anonymous" });
  }
  // Map tiles are the largest paint; open the connection to OneMap early.
  preconnect("https://www.onemap.gov.sg");
  // Read at build time: adding the alert store later needs a redeploy.
  return <ResultsScreen alertsEnabled={alertStoreConfig() !== null} />;
}
