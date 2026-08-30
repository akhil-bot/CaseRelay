import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },

  // Cloud Run runs the portal as a container, and an ordinary build expects a
  // populated `node_modules` to still be sitting beside it at run time. A
  // standalone build traces the modules a request actually reaches and copies
  // them next to the server, so the runtime image can ship without carrying a
  // dependency install — see portal/Dockerfile.
  output: "standalone",
};

export default nextConfig;
