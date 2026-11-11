use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use xxhash_rust::xxh3::Xxh3;

use crate::card::Clip;

const CHUNK: usize = 4 * 1024 * 1024;
const PART_SUFFIX: &str = ".locker-part";

#[derive(Debug, Clone)]
pub struct OffloadOptions {
    /// Re-read every copy after writing it and compare the checksum
    pub verify: bool,
}

impl Default for OffloadOptions {
    fn default() -> Self {
        Self { verify: true }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedFile {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OffloadReport {
    pub dest_dir: PathBuf,
    /// Number of clips in this offload
    pub total: usize,
    /// Copied and verified
    pub copied: usize,
    /// Already in the target folder with an identical checksum
    pub already_there: usize,
    pub failed: Vec<FailedFile>,
    pub bytes_copied: u64,
    pub cancelled: bool,
    pub seconds: f64,
}

impl OffloadReport {
    /// Only true if every clip verifiably exists on the drive.
    pub fn safe_to_format(&self) -> bool {
        !self.cancelled && self.failed.is_empty() && self.copied + self.already_there == self.total
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OffloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { total_files: usize, total_bytes: u64 },
    #[serde(rename_all = "camelCase")]
    Progress {
        files_done: usize,
        total_files: usize,
        bytes_done: u64,
        total_bytes: u64,
        current: String,
        phase: Phase,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Copy,
    Verify,
}

/// Copies `clips` into `dest_dir` and verifies each file.
/// - Never writes to the card.
/// - Never overwrites a file: on a name clash `_1`, `_2`, ... is appended.
/// - Writes to a `.locker-part` file first and only renames it once complete.
pub fn offload(
    clips: &[Clip],
    dest_dir: &Path,
    opts: &OffloadOptions,
    cancel: &AtomicBool,
    mut on_event: impl FnMut(OffloadEvent),
) -> OffloadReport {
    let started = std::time::Instant::now();
    let total_bytes: u64 = clips.iter().map(|c| c.size).sum();
    let total_files = clips.len();
    let mut report = OffloadReport {
        dest_dir: dest_dir.to_path_buf(),
        total: total_files,
        copied: 0,
        already_there: 0,
        failed: vec![],
        bytes_copied: 0,
        cancelled: false,
        seconds: 0.0,
    };
    on_event(OffloadEvent::Started { total_files, total_bytes });

    if let Err(e) = fs::create_dir_all(dest_dir) {
        for c in clips {
            report.failed.push(FailedFile { name: c.name.clone(), reason: format!("Zielordner: {e}") });
        }
        report.seconds = started.elapsed().as_secs_f64();
        return report;
    }

    let mut bytes_done: u64 = 0;
    for (i, clip) in clips.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            report.cancelled = true;
            break;
        }
        let base_done = bytes_done;
        let mut progress = |done_in_file: u64, phase: Phase| {
            on_event(OffloadEvent::Progress {
                files_done: i,
                total_files,
                bytes_done: base_done + done_in_file,
                total_bytes,
                current: clip.name.clone(),
                phase,
            })
        };
        match copy_one(clip, dest_dir, opts, cancel, &mut progress) {
            Ok(Outcome::Copied) => {
                report.copied += 1;
                report.bytes_copied += clip.size;
            }
            Ok(Outcome::AlreadyThere) => report.already_there += 1,
            Ok(Outcome::Cancelled) => {
                report.cancelled = true;
                break;
            }
            Err(reason) => report.failed.push(FailedFile { name: clip.name.clone(), reason }),
        }
        bytes_done += clip.size;
        on_event(OffloadEvent::Progress {
            files_done: i + 1,
            total_files,
            bytes_done,
            total_bytes,
            current: clip.name.clone(),
            phase: Phase::Copy,
        });
    }
    report.seconds = started.elapsed().as_secs_f64();
    report
}

enum Outcome {
    Copied,
    AlreadyThere,
    Cancelled,
}

fn copy_one(
    clip: &Clip,
    dest_dir: &Path,
    opts: &OffloadOptions,
    cancel: &AtomicBool,
    progress: &mut impl FnMut(u64, Phase),
) -> Result<Outcome, String> {
    // Find the target name; if an identical file is already there, we are done.
    let mut n = 0;
    let target = loop {
        let candidate = dest_dir.join(numbered(&clip.name, n));
        if !candidate.exists() {
            break candidate;
        }
        let meta = fs::metadata(&candidate).map_err(|e| e.to_string())?;
        if meta.len() == clip.size {
            let a = hash_file(&clip.path, cancel, &mut |_| {}).map_err(|e| format!("Karte lesen: {e}"))?;
            let b = hash_file(&candidate, cancel, &mut |_| {}).map_err(|e| format!("Ziel lesen: {e}"))?;
            if a.is_some() && a == b {
                return Ok(Outcome::AlreadyThere);
            }
        }
        n += 1;
        if n > 999 {
            return Err("Zu viele gleichnamige Dateien im Zielordner".into());
        }
    };

    let part = PathBuf::from(format!("{}{PART_SUFFIX}", target.to_string_lossy()));
    // A leftover .locker-part from an aborted run is our own temp file and may go.
    if part.exists() {
        fs::remove_file(&part).map_err(|e| format!("Altes Teilstück: {e}"))?;
    }

    let source_hash = {
        let mut src = File::open(&clip.path).map_err(|e| format!("Karte lesen: {e}"))?;
        let mut dst = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .map_err(|e| format!("Ziel schreiben: {e}"))?;
        let mut hasher = Xxh3::new();
        let mut buf = vec![0u8; CHUNK];
        let mut done = 0u64;
        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(dst);
                let _ = fs::remove_file(&part);
                return Ok(Outcome::Cancelled);
            }
            let read = match src.read(&mut buf) {
                Ok(0) => break,
                Ok(r) => r,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    drop(dst);
                    let _ = fs::remove_file(&part);
                    return Err(format!("Karte lesen: {e}"));
                }
            };
            hasher.update(&buf[..read]);
            if let Err(e) = dst.write_all(&buf[..read]) {
                drop(dst);
                let _ = fs::remove_file(&part);
                return Err(format!("Ziel schreiben: {e}"));
            }
            done += read as u64;
            progress(done, Phase::Copy);
        }
        dst.sync_all().map_err(|e| format!("Ziel schreiben: {e}"))?;
        if done != clip.size {
            let _ = fs::remove_file(&part);
            return Err(format!("Größe geändert ({} statt {} Bytes)", done, clip.size));
        }
        hasher.digest()
    };

    if target.exists() {
        let _ = fs::remove_file(&part);
        return Err("Zieldatei ist während des Kopierens aufgetaucht".into());
    }
    fs::rename(&part, &target).map_err(|e| format!("Umbenennen: {e}"))?;

    // Keep the original modification time so editing tools sort correctly
    if let Ok(mtime) = fs::metadata(&clip.path).and_then(|m| m.modified()) {
        if let Ok(f) = File::options().write(true).open(&target) {
            let _ = f.set_modified(mtime);
        }
    }

    if opts.verify {
        match hash_file(&target, cancel, &mut |d| progress(d, Phase::Verify)) {
            Ok(Some(h)) if h == source_hash => {}
            Ok(None) => return Ok(Outcome::Cancelled),
            Ok(Some(_)) => {
                // The copy is ours and broken: remove it so nothing looks safe
                let _ = fs::remove_file(&target);
                return Err("Prüfsumme stimmt nicht".into());
            }
            Err(e) => return Err(format!("Prüfen: {e}")),
        }
    }
    Ok(Outcome::Copied)
}

/// `C0001.MP4` -> `C0001_1.MP4` (n = 0 returns the name unchanged)
fn numbered(name: &str, n: usize) -> String {
    if n == 0 {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}_{n}.{ext}"),
        _ => format!("{name}_{n}"),
    }
}

/// xxHash3 (64 bit) of a file. `None` = cancelled.
pub fn hash_file(path: &Path, cancel: &AtomicBool, progress: &mut impl FnMut(u64)) -> io::Result<Option<u64>> {
    let mut f = File::open(path)?;
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        let r = match f.read(&mut buf) {
            Ok(0) => break,
            Ok(r) => r,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        hasher.update(&buf[..r]);
        done += r as u64;
        progress(done);
    }
    Ok(Some(hasher.digest()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::scan_card;
    use crate::library::{missing_clips, LibraryIndex};
    use std::fs::{create_dir_all, read, write};

    fn make_card(root: &Path, n: usize) {
        create_dir_all(root.join("DCIM/100CANON")).unwrap();
        for i in 0..n {
            let data: Vec<u8> = (0..(1000 + i * 37)).map(|b| (b * (i + 1)) as u8).collect();
            write(root.join(format!("DCIM/100CANON/MVI_{i:04}.MP4")), data).unwrap();
        }
    }

    #[test]
    fn copies_and_verifies_everything() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        make_card(&card, 131);
        let dest = tmp.path().join("lib/Kunde/2026/2026-11-11_Shoot/Canon");
        let clips = scan_card(&card);
        let mut events = 0;
        let report = offload(&clips, &dest, &OffloadOptions::default(), &AtomicBool::new(false), |_| events += 1);
        assert_eq!(report.copied, 131);
        assert!(report.safe_to_format());
        assert!(events > 131);
        for c in &clips {
            assert_eq!(read(&c.path).unwrap(), read(dest.join(&c.name)).unwrap());
        }
        // No temp files left behind
        assert!(fs::read_dir(&dest).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(PART_SUFFIX)));
    }

    #[test]
    fn second_run_finds_nothing_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        make_card(&card, 5);
        let lib = tmp.path().join("lib");
        let clips = scan_card(&card);
        offload(&clips, &lib.join("A"), &OffloadOptions::default(), &AtomicBool::new(false), |_| {});
        let missing = missing_clips(&clips, &LibraryIndex::build(&lib));
        assert!(missing.is_empty());
    }

    #[test]
    fn never_overwrites_different_file_with_same_name() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        make_card(&card, 1);
        let dest = tmp.path().join("dest");
        create_dir_all(&dest).unwrap();
        write(dest.join("MVI_0000.MP4"), b"B-Cam, different file").unwrap();

        let clips = scan_card(&card);
        let report = offload(&clips, &dest, &OffloadOptions::default(), &AtomicBool::new(false), |_| {});
        assert_eq!(report.copied, 1);
        assert_eq!(read(dest.join("MVI_0000.MP4")).unwrap(), b"B-Cam, different file");
        assert_eq!(read(dest.join("MVI_0000_1.MP4")).unwrap(), read(&clips[0].path).unwrap());
    }

    #[test]
    fn identical_existing_file_counts_as_already_there() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        make_card(&card, 2);
        let dest = tmp.path().join("dest");
        let clips = scan_card(&card);
        offload(&clips[..1], &dest, &OffloadOptions::default(), &AtomicBool::new(false), |_| {});
        let report = offload(&clips, &dest, &OffloadOptions::default(), &AtomicBool::new(false), |_| {});
        assert_eq!(report.already_there, 1);
        assert_eq!(report.copied, 1);
        assert!(report.safe_to_format());
        assert!(!dest.join("MVI_0000_1.MP4").exists());
    }

    #[test]
    fn cancel_is_not_safe_to_format() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        make_card(&card, 3);
        let clips = scan_card(&card);
        let report = offload(&clips, &tmp.path().join("d"), &OffloadOptions::default(), &AtomicBool::new(true), |_| {});
        assert!(report.cancelled);
        assert!(!report.safe_to_format());
    }

    #[test]
    fn card_is_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        make_card(&card, 4);
        let before: Vec<_> = scan_card(&card).iter().map(|c| (c.rel.clone(), c.size, c.modified)).collect();
        offload(&scan_card(&card), &tmp.path().join("d"), &OffloadOptions::default(), &AtomicBool::new(false), |_| {});
        let after: Vec<_> = scan_card(&card).iter().map(|c| (c.rel.clone(), c.size, c.modified)).collect();
        assert_eq!(before, after);
    }

    #[test]
    fn numbering() {
        assert_eq!(numbered("C0001.MP4", 0), "C0001.MP4");
        assert_eq!(numbered("C0001.MP4", 2), "C0001_2.MP4");
        assert_eq!(numbered("README", 1), "README_1");
    }
}
