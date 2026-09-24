import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@mysten-incubation/memwal"],
};
export default config;
