import { useEffect, useState } from "react";

export const DEFAULT_TEMPLATE = "{client}/{year}/{date}_{shoot}/{camera}";

export type Settings = {
  library: string | null;
  template: string;
  recentClients: string[];
};

const KEY = "locker.settings.v1";

function load(): Settings {
  const fallback: Settings = { library: null, template: DEFAULT_TEMPLATE, recentClients: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // Demo mode: skip the onboarding with ?card
      if (new URLSearchParams(location.search).has("card")) {
        return { ...fallback, library: "/Volumes/Footage", recentClients: ["Nike", "Red Bull", "Porsche"] };
      }
      return fallback;
    }
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings only live in memory */
    }
  }, [settings]);
  return [settings, setSettings] as const;
}
