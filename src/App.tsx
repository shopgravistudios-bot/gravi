import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Eject, FolderOpen, HardDrive, Settings as Gear, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiPromise,
  formatBytes,
  formatDuration,
  isTauri,
  type Analysis,
  type Card,
  type Finished,
  type LockerApi,
  type Progress,
  type ShootInfo,
} from "./api";
import { BigCheck, Button, Counter, Field, FolderTree, Logo, SdCard } from "./components/ui";
import { DEFAULT_TEMPLATE, useSettings } from "./settings";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

type Step ="onboarding" | "waiting" | "analyzing" | "overview" | "shoot" | "copying" | "done" | "ejected";

const page = {
  initial: { opacity: 0, y: 14, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(6px)" },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
};

export default function App() {
  const [api, setApi] = useState<LockerApi | null>(null);
  const [settings, setSettings] = useSettings();
  const [cards, setCards] = useState<Card[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(settings.library ? "waiting" : "onboarding");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [info, setInfo] = useState<ShootInfo>({ client: "", shoot: "", date: "", camera: "" });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const active = cards.find((c) => c.path === activePath) ?? null;

  useEffect(() => {
    apiPromise.then(setApi);
  }, []);

  // Subscribe to backend events
  useEffect(() => {
    if (!api) return;
    const subs: Promise<() => void>[] = [
      api.onCards((list) => {
        setCards(list);
        const busy = stepRef.current === "copying";
        if (busy) return;
        if (list.length === 0) {
          setActivePath(null);
          setStep((s) => (s === "onboarding" ? s : s === "ejected" ? s : "waiting"));
        } else {
          setActivePath((p) => (p && list.some((c) => c.path === p) ? p : list[0].path));
        }
      }),
      api.onProgress(setProgress),
      api.onFinished((f) => {
        setFinished(f);
        setStep("done");
      }),
    ];
    api.getCards().then((list) => {
      setCards(list);
      if (list[0]) setActivePath(list[0].path);
    });
    return () => subs.forEach((p) => p.then((un) => un()));
  }, [api]);

  // Analyse automatically when a new card becomes active
  useEffect(() => {
    if (!api || !activePath || !settings.library) return;
    if (!["waiting", "ejected", "overview", "done"].includes(stepRef.current)) return;
    setStep("analyzing");
    setError(null);
    api
      .analyzeCard(activePath, settings.library)
      .then((a) => {
        setAnalysis(a);
        setInfo((i) => ({
          client: i.client,
          shoot: "",
          date: a.card.date ?? new Date().toISOString().slice(0, 10),
          camera: a.card.camera,
        }));
        setStep("overview");
      })
      .catch((e) => {
        setError(String(e));
        setStep("waiting");
      });
  }, [api, activePath, settings.library]);

  const start = useCallback(async () => {
    if (!api || !active || !settings.library) return;
    setProgress(null);
    setFinished(null);
    setError(null);
    setStep("copying");
    try {
      await api.startOffload(active.path, settings.library, settings.template, info);
      const client = info.client.trim();
      if (client) {
        setSettings((s) => ({
          ...s,
          recentClients: [client, ...s.recentClients.filter((c) => c !== client)].slice(0, 8),
        }));
      }
    } catch (e) {
      setError(String(e));
      setStep("shoot");
    }
  }, [api, active, settings, info, setSettings]);

  const eject = useCallback(async () => {
    if (!api || !active) return;
    try {
      await api.ejectCard(active.path);
      setStep("ejected");
      setTimeout(() => setStep((s) => (s === "ejected" ? "waiting" : s)), 2600);
    } catch (e) {
      setError(`Auswerfen fehlgeschlagen: ${e}`);
    }
  }, [api, active]);

  const chooseLibrary = useCallback(async () => {
    if (!api) return;
    const p = await api.pickFolder();
    if (p) {
      setSettings((s) => ({ ...s, library: p }));
      if (step === "onboarding") setStep("waiting");
    }
  }, [api, step, setSettings]);

  const safeGlow = step === "done" && finished?.safeToFormat;

  return (
    <div className={`app-glow flex h-full flex-col transition-[background] duration-700 ${safeGlow ? "safe" : ""}`}>
      <TitleBar onSettings={() => setShowSettings(true)} showGear={step !== "onboarding"} />

      {cards.length > 1 && step !== "copying" && (
        <div className="flex gap-2 overflow-x-auto px-6 pb-1">
          {cards.map((c) => (
            <button
              key={c.path}
              onClick={() => {
                setStep("waiting");
                setActivePath(c.path);
              }}
              className={`shrink-0 rounded-full border px-3 py-1 text-[12px] ${
                c.path === activePath ? "border-accent/60 bg-accent/15 text-ink" : "border-line text-muted"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <main className="relative flex-1 overflow-hidden px-6 pb-6">
        <AnimatePresence mode="wait">
          {step === "onboarding" && (
            <motion.section key="onb" {...page} className="flex h-full flex-col">
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <Logo size={72} />
                <h1 className="mt-6 font-display text-[30px] font-semibold tracking-[-0.03em]">Willkommen bei Locker</h1>
                <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-muted">
                  Wähle die Platte oder den Ordner, in dem dein Footage lebt. Locker prüft jede Karte dagegen.
                </p>
              </div>
              <Button onClick={chooseLibrary} icon={<HardDrive size={18} />}>
                Footage-Ordner wählen
              </Button>
            </motion.section>
          )}

          {step === "waiting" && (
            <motion.section key="wait" {...page} className="flex h-full flex-col">
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="relative">
                  <div className="breathe absolute -inset-6 rounded-full bg-accent/20 blur-2xl" />
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}>
                    <SdCard className="relative h-28 w-24" />
                  </motion.div>
                </div>
                <h1 className="mt-8 font-display text-[28px] font-semibold tracking-[-0.03em]">Steck eine Karte ein.</h1>
                <p className="mt-2 text-[15px] text-muted">Locker öffnet sich von selbst.</p>
                {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
              </div>
              <LibraryChip library={settings.library} onChange={chooseLibrary} />
            </motion.section>
          )}

          {step === "analyzing" && active && (
            <motion.section key="ana" {...page} className="flex h-full flex-col">
              <CardTile card={active} scanning />
              <div className="flex flex-1 flex-col items-center justify-center">
                <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
                  <div className="sheen relative h-full w-full rounded-full bg-accent/40" />
                </div>
                <p className="mt-4 text-[14px] text-muted">Vergleiche mit deiner Platte…</p>
              </div>
            </motion.section>
          )}

          {step === "overview" && analysis && active && (
            <motion.section key="ovr" {...page} className="flex h-full flex-col">
              <CardTile card={analysis.card} />
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Stat label="Deine Karte" value={analysis.card.clipCount} sub={formatBytes(analysis.card.totalBytes)} />
                <Stat
                  label="Auf der Platte"
                  value={analysis.onDrive}
                  sub={analysis.onDrive === analysis.card.clipCount ? "alles da" : "bereits gesichert"}
                  tone={analysis.onDrive === analysis.card.clipCount ? "safe" : analysis.onDrive === 0 ? "warn" : "default"}
                />
              </div>
              <div className="flex flex-1 flex-col justify-center">
                {analysis.missing > 0 ? (
                  <p className="text-center font-display text-[22px] font-semibold leading-snug tracking-[-0.02em]">
                    <span className="text-warn">{analysis.missing} Clips</span> sind noch nirgends gesichert.
                    <span className="mt-1 block text-[14px] font-normal tracking-normal text-muted">
                      {formatBytes(analysis.missingBytes)} · Locker kopiert nur genau diese.
                    </span>
                  </p>
                ) : (
                  <p className="text-center font-display text-[22px] font-semibold tracking-[-0.02em]">
                    <span className="text-safe">Alles schon gesichert.</span>
                    <span className="mt-1 block text-[14px] font-normal tracking-normal text-muted">
                      Jeder Clip dieser Karte liegt bereits auf deiner Platte.
                    </span>
                  </p>
                )}
              </div>
              {analysis.missing > 0 ? (
                <Button onClick={() => setStep("shoot")} icon={<ArrowRight size={18} />} className="flex-row-reverse">
                  Neuer Shoot
                </Button>
              ) : (
                <Button variant="ghost" onClick={eject} icon={<Eject size={18} />}>
                  Karte auswerfen
                </Button>
              )}
            </motion.section>
          )}

          {step === "shoot" && analysis && settings.library && (
            <motion.section key="sht" {...page} className="flex h-full flex-col">
              <ShootForm
                api={api}
                library={settings.library}
                template={settings.template}
                info={info}
                setInfo={setInfo}
                recent={settings.recentClients}
                count={analysis.missing}
                error={error}
                onBack={() => setStep("overview")}
                onStart={start}
              />
            </motion.section>
          )}

          {step === "copying" && (
            <motion.section key="cpy" {...page} className="flex h-full flex-col">
              <Copying progress={progress} total={analysis?.missing ?? 0} onCancel={() => api?.cancelOffload()} />
            </motion.section>
          )}

          {step === "done" && finished && (
            <motion.section key="don" {...page} className="flex h-full flex-col">
              <Done finished={finished} onEject={eject} onReveal={() => api?.reveal(finished.destDir)} error={error} />
            </motion.section>
          )}

          {step === "ejected" && (
            <motion.section key="ejd" {...page} className="flex h-full flex-col items-center justify-center text-center">
              <Eject size={40} className="text-muted" />
              <h1 className="mt-5 font-display text-[26px] font-semibold tracking-[-0.03em]">Karte ausgeworfen.</h1>
              <p className="mt-2 text-[15px] text-muted">Du kannst sie jetzt in der Kamera formatieren.</p>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showSettings && (
          <SettingsSheet
            library={settings.library}
            template={settings.template}
            onChooseLibrary={chooseLibrary}
            onTemplate={(t) => setSettings((s) => ({ ...s, template: t }))}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TitleBar({ onSettings, showGear }: { onSettings: () => void; showGear: boolean }) {
  return (
    <header
      data-tauri-drag-region
      // On the Mac the traffic lights sit in the title bar (overlay style), so leave room for them
      className={`flex h-[52px] shrink-0 items-center justify-between pr-4 ${isMac ? "pl-[84px]" : "pl-6"}`}
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <Logo size={18} />
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-[-0.01em] text-ink/90">
          Locker
        </span>
        {!isTauri && <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted">Demo</span>}
      </div>
      {showGear && (
        <button onClick={onSettings} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-ink">
          <Gear size={16} />
        </button>
      )}
    </header>
  );
}

function CardTile({ card, scanning = false }: { card: Card; scanning?: boolean }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur">
      <SdCard className="h-14 w-11 shrink-0" glow={scanning} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold tracking-[-0.01em]">{card.name}</div>
        <div className="mt-0.5 truncate text-[13px] text-muted">
          {card.camera}
          {card.date && ` · ${new Date(card.date).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}`}
          {` · ${formatBytes(card.totalBytes)}`}
        </div>
      </div>
      <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">Karte</span>
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: number; sub: string; tone?: "default" | "safe" | "warn" }) {
  const color = { default: "text-ink", safe: "text-safe", warn: "text-warn" }[tone];
  return (
    <div className="rounded-2xl border border-line bg-panel/70 p-4">
      <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{label}</div>
      <Counter value={value} className={`mt-1 block font-display text-[48px] font-semibold leading-none tracking-[-0.04em] ${color}`} />
      <div className="mt-2 text-[12.5px] text-faint">{sub}</div>
    </div>
  );
}

function LibraryChip({ library, onChange }: { library: string | null; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-left hover:bg-panel"
    >
      <HardDrive size={18} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Ziel</div>
        <div className="truncate text-[13.5px] text-ink/90">{library ?? "Kein Ordner gewählt"}</div>
      </div>
      <span className="text-[12px] text-accent">Ändern</span>
    </button>
  );
}

function ShootForm(props: {
  api: LockerApi | null;
  library: string;
  template: string;
  info: ShootInfo;
  setInfo: (f: (i: ShootInfo) => ShootInfo) => void;
  recent: string[];
  count: number;
  error: string | null;
  onBack: () => void;
  onStart: () => void;
}) {
  const { api, library, template, info, setInfo, recent, count, error, onBack, onStart } = props;
  const [dest, setDest] = useState("");
  useEffect(() => {
    if (!api) return;
    const preview: ShootInfo = {
      ...info,
      client: info.client || "Kunde",
      shoot: info.shoot || "Shoot",
    };
    api.previewDest(library, template, preview).then(setDest);
  }, [api, library, template, info]);
  const segments = useMemo(() => {
    const rest = dest.startsWith(library) ? dest.slice(library.length) : dest;
    return rest.split(/[\\/]/).filter(Boolean);
  }, [dest, library]);
  const ready = info.client.trim() && info.shoot.trim();
  const set = (k: keyof ShootInfo) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInfo((i) => ({ ...i, [k]: v }));
  };

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onStart();
      }}
    >
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[24px] font-semibold tracking-[-0.03em]">Neuer Shoot</h1>
        <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06]">
          <X size={16} />
        </button>
      </div>
      <div className="mt-5 space-y-3.5">
        <Field label="Kunde" placeholder="z. B. Nike" value={info.client} onChange={set("client")} list="recent-clients" autoFocus />
        <datalist id="recent-clients">
          {recent.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field label="Shoot-Name" placeholder="z. B. Frühjahrskampagne" value={info.shoot} onChange={set("shoot")} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Datum" hint="von der Karte" type="date" value={info.date} onChange={set("date")} />
          <Field label="Kamera" hint="von der Karte" value={info.camera} onChange={set("camera")} />
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ordner</div>
        <FolderTree library={library} segments={segments} />
      </div>
      <div className="flex-1" />
      {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}
      <Button type="submit" disabled={!ready}>
        {count} Clips sichern
      </Button>
    </form>
  );
}

function Copying({ progress, total, onCancel }: { progress: Progress | null; total: number; onCancel: () => void }) {
  const files = progress?.filesDone ?? 0;
  const totalFiles = progress?.totalFiles ?? total;
  const frac = progress && progress.totalBytes > 0 ? progress.bytesDone / progress.totalBytes : 0;
  // Speed from the last few seconds
  const samples = useRef<{ t: number; b: number }[]>([]);
  const now = performance.now();
  if (progress) {
    samples.current.push({ t: now, b: progress.bytesDone });
    samples.current = samples.current.filter((s) => now - s.t < 3000);
  }
  const first = samples.current[0];
  const speed = first && now - first.t > 300 ? ((progress?.bytesDone ?? 0) - first.b) / ((now - first.t) / 1000) : 0;
  const eta = speed > 0 && progress ? (progress.totalBytes - progress.bytesDone) / speed : NaN;

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted">
          {progress?.phase === "verify" ? "Prüfe Prüfsummen" : "Kopiere"}
        </div>
        <div className="mt-3 flex items-baseline gap-2 font-display">
          <Counter value={files} className="text-[84px] font-semibold leading-none tracking-[-0.05em]" />
          <span className="tnum text-[28px] font-medium tracking-[-0.03em] text-faint">/ {totalFiles}</span>
        </div>
        <div className="mt-8 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div
            className="sheen relative h-full overflow-hidden rounded-full bg-gradient-to-r from-accent to-accent-2"
            animate={{ width: `${Math.max(2, frac * 100)}%` }}
            transition={{ ease: "linear", duration: 0.2 }}
          />
        </div>
        <div className="mt-3 flex w-full justify-between text-[12.5px] text-muted">
          <span className="truncate font-mono">{progress?.current ?? "…"}</span>
          <span className="tnum shrink-0">
            {speed > 0 ? `${formatBytes(speed)}/s · noch ${formatDuration(eta)}` : "startet…"}
          </span>
        </div>
      </div>
      <div className="mb-3 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-[13px] leading-relaxed text-muted">
        Jede Datei wird nach dem Kopieren noch einmal gelesen und mit der Karte verglichen.
      </div>
      <Button variant="danger" onClick={onCancel}>
        Abbrechen
      </Button>
    </>
  );
}

function Done({ finished, onEject, onReveal, error }: { finished: Finished; onEject: () => void; onReveal: () => void; error: string | null }) {
  const onDrive = finished.copied + finished.alreadyThere;
  if (!finished.safeToFormat) {
    return (
      <>
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.03em] text-warn">
            {finished.cancelled ? "Abgebrochen." : "Nicht formatieren."}
          </h1>
          <p className="mt-2 text-[15px] text-muted">
            {onDrive} von {finished.cardTotal} Clips sind sicher auf der Platte.
          </p>
          {finished.failed.length > 0 && (
            <div className="mt-5 max-h-56 overflow-y-auto rounded-2xl border border-danger/30 bg-danger/5 p-3">
              {finished.failed.map((f) => (
                <div key={f.name} className="flex justify-between gap-3 py-1 text-[13px]">
                  <span className="truncate font-mono text-ink">{f.name}</span>
                  <span className="shrink-0 text-danger">{f.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <Button variant="ghost" onClick={onReveal} icon={<FolderOpen size={18} />}>
          Ordner zeigen
        </Button>
      </>
    );
  }
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <BigCheck />
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <h1 className="mt-8 font-display text-[28px] font-semibold leading-tight tracking-[-0.03em]">
            Jeder Clip ist da.
          </h1>
          <p className="tnum mt-2 text-[16px] text-muted">
            {finished.cardTotal} auf der Karte · <span className="text-ink">{onDrive} auf der Platte</span>
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-safe/30 bg-safe/10 px-3.5 py-1.5 text-[13px] font-semibold text-safe">
            <span className="h-1.5 w-1.5 rounded-full bg-safe" />
            Sicher zum Formatieren
          </div>
        </motion.div>
      </div>
      {error && <p className="mb-3 text-center text-[13px] text-danger">{error}</p>}
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <Button variant="ghost" onClick={onReveal} aria-label="Ordner zeigen" icon={<FolderOpen size={18} />} />
        <Button variant="safe" onClick={onEject} icon={<Eject size={18} />}>
          Auswerfen
        </Button>
      </div>
    </>
  );
}

function SettingsSheet(props: {
  library: string | null;
  template: string;
  onChooseLibrary: () => void;
  onTemplate: (t: string) => void;
  onClose: () => void;
}) {
  const tokens = ["{client}", "{shoot}", "{date}", "{year}", "{month}", "{camera}"];
  return (
    <motion.div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={props.onClose}>
      <motion.div
        className="rounded-t-3xl border-t border-line-strong bg-raised p-6"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em]">Einstellungen</h2>
          <button onClick={props.onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06]">
            <X size={16} />
          </button>
        </div>
        <div className="mt-5">
          <LibraryChip library={props.library} onChange={props.onChooseLibrary} />
        </div>
        <div className="mt-4">
          <Field label="Ordner-Struktur" value={props.template} onChange={(e) => props.onTemplate(e.target.value)} spellCheck={false} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tokens.map((t) => (
              <button
                key={t}
                onClick={() => props.onTemplate(props.template + (props.template.endsWith("/") ? "" : "/") + t)}
                className="rounded-md border border-line bg-white/[0.03] px-2 py-1 font-mono text-[11.5px] text-muted hover:text-ink"
              >
                {t}
              </button>
            ))}
            <button onClick={() => props.onTemplate(DEFAULT_TEMPLATE)} className="px-2 py-1 text-[11.5px] text-accent">
              Standard
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
