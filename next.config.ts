import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "@mysten-incubation/memwal"],
};
export default config;
