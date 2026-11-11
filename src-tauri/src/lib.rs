use locker_core::{
    card::{scan_card, summarize, volume_roots, is_card},
    copy::{offload, OffloadOptions},
    library::{missing_clips, LibraryIndex},
    plan::{render_template, ShootInfo},
    Card, Clip,
};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WindowEvent,
};

#[derive(Default)]
struct AppState {
    /// Missing clips per card from the last analysis
    missing: Mutex<HashMap<PathBuf, Vec<Clip>>>,
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Analysis {
    card: Card,
    missing: usize,
    missing_bytes: u64,
    on_drive: usize,
    library_files: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Finished {
    #[serde(flatten)]
    report: locker_core::OffloadReport,
    safe_to_format: bool,
    card_total: usize,
}

#[tauri::command]
async fn get_cards() -> Vec<Card> {
    tauri::async_runtime::spawn_blocking(locker_core::find_cards)
        .await
        .unwrap_or_default()
}

/// Card vs. library: how many clips are not yet on the drive?
#[tauri::command]
async fn analyze_card(state: State<'_, AppState>, card_path: String, library: String) -> Result<Analysis, String> {
    let card_path = PathBuf::from(card_path);
    let lib = PathBuf::from(library);
    let (analysis, missing) = tauri::async_runtime::spawn_blocking(move || {
        let clips = scan_card(&card_path);
        let card = summarize(&card_path, &clips);
        let index = LibraryIndex::build(&lib);
        let missing = missing_clips(&clips, &index);
        let analysis = Analysis {
            missing: missing.len(),
            missing_bytes: missing.iter().map(|c| c.size).sum(),
            on_drive: clips.len() - missing.len(),
            library_files: index.len(),
            card,
        };
        (analysis, missing)
    })
    .await
    .map_err(|e| e.to_string())?;
    state.missing.lock().unwrap().insert(analysis.card.path.clone(), missing);
    Ok(analysis)
}

/// The folder path the template produces (for the preview in the form).
#[tauri::command]
fn preview_dest(library: String, template: String, info: ShootInfo) -> String {
    render_template(Path::new(&library), &template, &info)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn start_offload(
    app: AppHandle,
    state: State<'_, AppState>,
    card_path: String,
    library: String,
    template: String,
    info: ShootInfo,
) -> Result<String, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Es läuft schon ein Offload".into());
    }
    let card_path = PathBuf::from(card_path);
    let clips = state.missing.lock().unwrap().get(&card_path).cloned();
    let Some(clips) = clips else {
        state.running.store(false, Ordering::SeqCst);
        return Err("Karte bitte erst analysieren".into());
    };
    let dest = render_template(Path::new(&library), &template, &info);
    let dest_str = dest.to_string_lossy().to_string();
    let cancel = state.cancel.clone();
    let running = state.running.clone();
    cancel.store(false, Ordering::SeqCst);

    std::thread::spawn(move || {
        let card_total = scan_card(&card_path).len();
        let mut last = Instant::now() - Duration::from_secs(1);
        let report = offload(&clips, &dest, &OffloadOptions::default(), &cancel, |ev| {
            // At most ~30 updates per second, so the UI stays smooth
            if last.elapsed() >= Duration::from_millis(33) {
                last = Instant::now();
                let _ = app.emit("offload-progress", &ev);
            }
        });
        let safe = report.safe_to_format();
        let already_on_drive = card_total.saturating_sub(clips.len());
        let mut finished = Finished { report, safe_to_format: safe, card_total };
        // Clips that were already on the drive before count as safe too
        finished.report.already_there += already_on_drive;
        finished.report.total += already_on_drive;
        let _ = app.emit("offload-finished", finished);
        running.store(false, Ordering::SeqCst);
    });
    Ok(dest_str)
}

#[tauri::command]
fn cancel_offload(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn eject_card(card_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || eject(&card_path))
        .await
        .map_err(|e| e.to_string())?
}

fn eject(path: &str) -> Result<(), String> {
    use std::process::Command;
    let output = if cfg!(target_os = "macos") {
        Command::new("diskutil").args(["eject", path]).output()
    } else if cfg!(target_os = "windows") {
        let drive = path.trim_end_matches('\\');
        let script = format!(
            "(New-Object -comObject Shell.Application).Namespace(17).ParseName('{drive}').InvokeVerb('Eject')"
        );
        Command::new("powershell").args(["-NoProfile", "-Command", &script]).output()
    } else {
        Command::new("gio").args(["mount", "-e", path]).output()
    };
    match output {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Checks every 2 s whether a card was inserted or removed.
fn watch_cards(app: AppHandle) {
    std::thread::spawn(move || {
        let mut known: BTreeSet<PathBuf> = BTreeSet::new();
        loop {
            let now: BTreeSet<PathBuf> = volume_roots().into_iter().filter(|r| is_card(r)).collect();
            if now != known {
                let inserted = now.difference(&known).next().is_some();
                known = now;
                let cards = locker_core::find_cards();
                let _ = app.emit("cards-changed", &cards);
                if inserted {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_cards,
            analyze_card,
            preview_dest,
            start_offload,
            cancel_offload,
            eject_card
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Locker öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Locker")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            watch_cards(app.handle().clone());
            Ok(())
        })
        // Closing only hides the window: Locker keeps watching for cards
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Locker konnte nicht starten");
}
