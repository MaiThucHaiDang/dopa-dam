import { useEffect, useState } from "react";
import { api, FALLBACK_PLATFORM, type PlatformInfo } from "../api";

/** Platform info from the backend; until it arrives, or if the command is missing, the Windows wording is used. */
export function usePlatform(refreshKey?: unknown): PlatformInfo {
  const [platform, setPlatform] = useState<PlatformInfo>(FALLBACK_PLATFORM);
  useEffect(() => {
    let alive = true;
    api.getPlatform().then(
      (p) => alive && setPlatform(p),
      () => alive && setPlatform(FALLBACK_PLATFORM),
    );
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return platform;
}
