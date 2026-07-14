import react from "@vitejs/plugin-react";
import os from "node:os";
import { defineConfig } from "vite";

function buildAllowedHosts() {
  const configured = String(process.env.TASKDECK_ALLOWED_HOSTS || "").trim();
  if (["*", "true", "1"].includes(configured.toLowerCase())) {
    return true;
  }

  const hostname = os.hostname();
  const candidates = new Set(["localhost", "127.0.0.1", "::1", hostname]);
  if (hostname && !hostname.endsWith(".local")) {
    candidates.add(`${hostname}.local`);
  }
  if (hostname.endsWith(".local")) {
    candidates.add(hostname.slice(0, -".local".length));
  }
  for (const value of configured.split(",")) {
    const allowedHost = value.trim();
    if (allowedHost) {
      candidates.add(allowedHost);
    }
  }

  const normalized = Array.from(candidates)
    .filter(Boolean)
    .flatMap((value) => [value, value.toLowerCase()]);
  return Array.from(new Set(normalized));
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: buildAllowedHosts(),
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
