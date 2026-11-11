use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::util::ymd;

/// File types Locker treats as clips (video, photo, audio, camera sidecars).
const MEDIA_EXT: &[&str] = &[
    // Video
    "mp4", "mov", "mxf", "mts", "m2ts", "avi", "braw", "r3d", "crm", "insv", "lrv", "360",
    // Photo / RAW
    "jpg", "jpeg", "heic", "hif", "arw", "cr2", "cr3", "raf", "nef", "dng", "rw2", "orf",
    // Audio
    "wav", "mp3", "m4a",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    /// Absolute path on the card
    pub path: PathBuf,
    /// Path relative to the card root, with `/` as separator
    pub rel: String,
    pub name: String,
    pub size: u64,
    /// Modification time in seconds since 1970
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub path: PathBuf,
    pub name: String,
    /// Guessed camera / manufacturer, e.g. "Sony" or "Canon"
    pub camera: String,
    /// Shooting date (the day with the most clips), `YYYY-MM-DD`
    pub date: Option<String>,
    pub clip_count: usize,
    pub total_bytes: u64,
}

/// All volumes that could be a memory card, depending on the OS.
pub fn volume_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(target_os = "macos") {
        roots.extend(list_dirs(Path::new("/Volumes")));
    } else if cfg!(target_os = "windows") {
        for letter in b'D'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\", letter as char));
            if p.exists() {
                roots.push(p);
            }
        }
    } else {
        for base in ["/media", "/run/media"] {
            for user_dir in list_dirs(Path::new(base)) {
                roots.push(user_dir.clone());
                roots.extend(list_dirs(&user_dir));
            }
        }
    }
    roots
}

fn list_dirs(p: &Path) -> Vec<PathBuf> {
    fs::read_dir(p)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// Is this volume a camera card? (DCIM, or Sony/Panasonic PRIVATE structure)
pub fn is_card(root: &Path) -> bool {
    root.join("DCIM").is_dir()
        || root.join("PRIVATE").join("M4ROOT").is_dir()
        || root.join("PRIVATE").join("AVCHD").is_dir()
        || root.join("PRIVATE").join("XDROOT").is_dir()
}

/// Finds all connected cards with their clip summary.
pub fn find_cards() -> Vec<Card> {
    find_cards_in(&volume_roots())
}

pub fn find_cards_in(roots: &[PathBuf]) -> Vec<Card> {
    roots
        .iter()
        .filter(|r| is_card(r))
        .map(|r| summarize(r, &scan_card(r)))
        .collect()
}

/// Builds the card summary from the clips.
pub fn summarize(root: &Path, clips: &[Clip]) -> Card {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().trim_end_matches(['\\', '/']).to_string());
    let mut per_day: BTreeMap<String, usize> = BTreeMap::new();
    for c in clips {
        *per_day
            .entry(ymd(UNIX_EPOCH + std::time::Duration::from_secs(c.modified)))
            .or_default() += 1;
    }
    // Day with the most clips; on a tie, the earliest one
    let date = per_day
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
        .map(|(d, _)| d.clone());
    Card {
        path: root.to_path_buf(),
        camera: guess_camera(root, &name),
        date,
        clip_count: clips.len(),
        total_bytes: clips.iter().map(|c| c.size).sum(),
        name,
    }
}

/// Guesses the manufacturer from the typical folder names of the camera.
pub fn guess_camera(root: &Path, volume_name: &str) -> String {
    if root.join("PRIVATE").join("M4ROOT").is_dir() || root.join("PRIVATE").join("XDROOT").is_dir() {
        return "Sony".into();
    }
    let dcim_dirs: Vec<String> = list_dirs(&root.join("DCIM"))
        .iter()
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_uppercase()))
        .collect();
    let known = [
        ("CANON", "Canon"),
        ("GOPRO", "GoPro"),
        ("FUJI", "Fujifilm"),
        ("NIKON", "Nikon"),
        ("MSDCF", "Sony"),
        ("DJI", "DJI"),
        ("LEICA", "Leica"),
        ("PANA", "Panasonic"),
        ("OLYMP", "OM System"),
        ("INSTA", "Insta360"),
        ("APPLE", "iPhone"),
    ];
    for d in &dcim_dirs {
        for (needle, label) in known {
            if d.contains(needle) {
                return label.into();
            }
        }
    }
    if root.join("PRIVATE").join("AVCHD").is_dir() {
        return "Panasonic".into();
    }
    let v = volume_name.trim();
    if v.is_empty() || v.eq_ignore_ascii_case("untitled") || v.eq_ignore_ascii_case("no name") {
        "Kamera".into()
    } else {
        v.to_string()
    }
}

/// Lists all clips on the card (read only, hidden folders are skipped).
pub fn scan_card(root: &Path) -> Vec<Clip> {
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Clip>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with("$RECYCLE") || name == "System Volume Information" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            walk(root, &path, out);
        } else if meta.is_file() && is_media(&path) {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(Clip { path, rel, name, size: meta.len(), modified });
        }
    }
}

fn is_media(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if MEDIA_EXT.contains(&ext.as_str()) {
        return true;
    }
    // Sony XML sidecars carry timecode and metadata: copy them along
    ext == "xml" && path.to_string_lossy().to_uppercase().contains("M4ROOT")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn detects_sony_and_canon_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let sony = tmp.path().join("SONY");
        fs::create_dir_all(sony.join("PRIVATE/M4ROOT/CLIP")).unwrap();
        File::create(sony.join("PRIVATE/M4ROOT/CLIP/C0001.MP4")).unwrap().write_all(b"abc").unwrap();
        File::create(sony.join("PRIVATE/M4ROOT/CLIP/C0001M01.XML")).unwrap().write_all(b"<x/>").unwrap();
        File::create(sony.join("PRIVATE/M4ROOT/STATUS.BIN")).unwrap();

        let canon = tmp.path().join("EOS_DIGITAL");
        fs::create_dir_all(canon.join("DCIM/100CANON")).unwrap();
        File::create(canon.join("DCIM/100CANON/IMG_0001.CR3")).unwrap().write_all(b"raw").unwrap();
        File::create(canon.join("DCIM/100CANON/._IMG_0001.CR3")).unwrap();

        let usb = tmp.path().join("USB");
        fs::create_dir_all(&usb).unwrap();

        let cards = find_cards_in(&[sony.clone(), canon.clone(), usb]);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].camera, "Sony");
        assert_eq!(cards[0].clip_count, 2, "MP4 plus XML sidecar");
        assert_eq!(cards[1].camera, "Canon");
        assert_eq!(cards[1].clip_count, 1, "hidden ._ files are ignored");
        assert_eq!(cards[1].total_bytes, 3);
    }
}
