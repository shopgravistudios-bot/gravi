// Bridge to the Rust backend. Outside of Tauri (plain browser, `npm run dev`)
// a demo mode runs with a simulated card: good for designing the UI and for
// screen recordings of the promo reel.

export type Card = {
  path: string;
  name: string;
  camera: string;
  date: string | null;
  clipCount: number;
  totalBytes: number;
};

export type Analysis = {
  card: Card;
  missing: number;
  missingBytes: number;
  onDrive: number;
  libraryFiles: number;
};

export type ShootInfo = { client: string; shoot: string; date: string; camera: string };

export type Progress = {
  kind: "started" | "progress";
  filesDone: number;
  totalFiles: number;
  bytesDone: number;
  totalBytes: number;
  current?: string;
  phase?: "copy" | "verify";
};

export type Finished = {
  destDir: string;
  total: number;
  copied: number;
  alreadyThere: number;
  failed: { name: string; reason: string }[];
  bytesCopied: number;
  cancelled: boolean;
  seconds: number;
  safeToFormat: boolean;
  cardTotal: number;
};

type Unlisten = () => void;

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface LockerApi {
  getCards(): Promise<Card[]>;
  analyzeCard(cardPath: string, library: string): Promise<Analysis>;
  previewDest(library: string, template: string, info: ShootInfo): Promise<string>;
  startOffload(cardPath: string, library: string, template: string, info: ShootInfo): Promise<string>;
  cancelOffload(): Promise<void>;
  ejectCard(cardPath: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  reveal(path: string): Promise<void>;
  onCards(cb: (cards: Card[]) => void): Promise<Unlisten>;
  onProgress(cb: (p: Progress) => void): Promise<Unlisten>;
  onFinished(cb: (f: Finished) => void): Promise<Unlisten>;
}

// ---------- Tauri ----------

async function tauriApi(): Promise<LockerApi> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const opener = await import("@tauri-apps/plugin-opener");
  return {
    getCards: () => invoke("get_cards"),
    analyzeCard: (cardPath, library) => invoke("analyze_card", { cardPath, library }),
    previewDest: (library, template, info) => invoke("preview_dest", { library, template, info }),
    startOffload: (cardPath, library, template, info) =>
      invoke("start_offload", { cardPath, library, template, info }),
    cancelOffload: () => invoke("cancel_offload"),
    ejectCard: (cardPath) => invoke("eject_card", { cardPath }),
    pickFolder: async () => {
      const r = await dialog.open({ directory: true, title: "Footage-Ordner wählen" });
      return typeof r === "string" ? r : null;
    },
    reveal: (path) => opener.revealItemInDir(path),
    onCards: (cb) => listen<Card[]>("cards-changed", (e) => cb(e.payload)),
    onProgress: (cb) => listen<Progress>("offload-progress", (e) => cb(e.payload)),
    onFinished: (cb) => listen<Finished>("offload-finished", (e) => cb(e.payload)),
  };
}

// ---------- Demo mode ----------

function demoApi(): LockerApi {
  const today = new Date().toISOString().slice(0, 10);
  const demoCard: Card = {
    path: "/Volumes/A7SIII",
    name: "A7SIII",
    camera: "Sony",
    date: today,
    clipCount: 131,
    totalBytes: 131 * 1.8e9,
  };
  let cards: Card[] = [];
  const cardSubs: ((c: Card[]) => void)[] = [];
  const progSubs: ((p: Progress) => void)[] = [];
  const doneSubs: ((f: Finished) => void)[] = [];
  let timer: number | undefined;
  let cancelled = false;

  // Simulates inserting the card after 1.5 s (or immediately with ?card)
  const insert = () => {
    cards = [demoCard];
    cardSubs.forEach((cb) => cb(cards));
  };
  const params = new URLSearchParams(location.search);
  setTimeout(insert, params.has("card") ? 50 : 1500);

  const sep = (lib: string) => (lib.includes("\\") ? "\\" : "/");
  const render = (library: string, template: string, info: ShootInfo) => {
    const clean = (s: string) => s.trim().replace(/[\\/:*?"<>|]/g, "-") || "Unbenannt";
    const parts = template
      .split(/[\\/]/)
      .filter(Boolean)
      .map((seg) =>
        clean(
          seg
            .replaceAll("{client}", clean(info.client))
            .replaceAll("{shoot}", clean(info.shoot))
            .replaceAll("{date}", info.date)
            .replaceAll("{year}", info.date.slice(0, 4))
            .replaceAll("{month}", info.date.slice(5, 7))
            .replaceAll("{camera}", clean(info.camera)),
        ),
      );
    return [library, ...parts].join(sep(library));
  };

  return {
    getCards: async () => cards,
    analyzeCard: async () => {
      await new Promise((r) => setTimeout(r, 900));
      return { card: demoCard, missing: 131, missingBytes: demoCard.totalBytes, onDrive: 0, libraryFiles: 4210 };
    },
    previewDest: async (library, template, info) => render(library, template, info),
    startOffload: async (_card, library, template, info) => {
      cancelled = false;
      const total = 131;
      const bytesPer = 1.8e9;
      const speed = params.has("fast") ? 60 : 9; // clips per second in the demo
      let done = 0;
      const t0 = performance.now();
      clearInterval(timer);
      timer = window.setInterval(() => {
        if (cancelled) {
          clearInterval(timer);
          doneSubs.forEach((cb) =>
            cb({
              destDir: render(library, template, info), total, copied: done, alreadyThere: 0, failed: [],
              bytesCopied: done * bytesPer, cancelled: true, seconds: 0, safeToFormat: false, cardTotal: total,
            }),
          );
          return;
        }
        const t = (performance.now() - t0) / 1000;
        done = Math.min(total, Math.floor(t * speed));
        const frac = t * speed - Math.floor(t * speed);
        progSubs.forEach((cb) =>
          cb({
            kind: "progress",
            filesDone: done,
            totalFiles: total,
            bytesDone: Math.min(total, done + frac) * bytesPer,
            totalBytes: total * bytesPer,
            current: `C${String(Math.min(total, done + 1)).padStart(4, "0")}.MP4`,
            phase: frac > 0.6 ? "verify" : "copy",
          }),
        );
        if (done >= total) {
          clearInterval(timer);
          setTimeout(
            () =>
              doneSubs.forEach((cb) =>
                cb({
                  destDir: render(library, template, info), total, copied: total, alreadyThere: 0, failed: [],
                  bytesCopied: total * bytesPer, cancelled: false, seconds: t, safeToFormat: true, cardTotal: total,
                }),
              ),
            400,
          );
        }
      }, 50);
      return render(library, template, info);
    },
    cancelOffload: async () => {
      cancelled = true;
    },
    ejectCard: async () => {
      await new Promise((r) => setTimeout(r, 600));
      cards = [];
      cardSubs.forEach((cb) => cb(cards));
      setTimeout(insert, 4000);
    },
    pickFolder: async () => "/Volumes/Footage",
    reveal: async () => {},
    onCards: async (cb) => {
      cardSubs.push(cb);
      return () => cardSubs.splice(cardSubs.indexOf(cb), 1);
    },
    onProgress: async (cb) => {
      progSubs.push(cb);
      return () => progSubs.splice(progSubs.indexOf(cb), 1);
    },
    onFinished: async (cb) => {
      doneSubs.push(cb);
      return () => doneSubs.splice(doneSubs.indexOf(cb), 1);
    },
  };
}

export const apiPromise: Promise<LockerApi> = isTauri ? tauriApi() : Promise.resolve(demoApi());

// ---------- Helpers ----------

export function formatBytes(b: number): string {
  if (b < 1e3) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1e3;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

export function formatDuration(s: number): string {
  if (!isFinite(s) || s < 0) return "–";
  if (s < 60) return `${Math.ceil(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
