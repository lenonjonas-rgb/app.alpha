import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.alphatec.tecnicos",
  appName: "Alpha Tec Técnicos",
  webDir: "dist",
  server: {
    url: "https://app-alpha-theta.vercel.app/?tecnico=1",
    cleartext: false,
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
  },
};
export default config;
