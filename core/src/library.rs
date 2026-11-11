use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::card::Clip;

/// Index of all files already in the library (your footage drive).
/// Key: file name (lowercase) + size. That way Locker recognises clips that
/// already live in some shoot folder, no matter where.
#[derive(Debug, Default)]
pub struct LibraryIndex {
    files: HashMap<(String, u64), PathBuf>,
}

impl LibraryIndex {
    pub fn build(root: &Path) -> Self {
        let mut idx = LibraryIndex::default();
        if root.is_dir() {
            idx.walk(root);
        }
        idx
    }

    fn walk(&mut self, dir: &Path) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                self.walk(&entry.path());
            } else if meta.is_file() && !name.ends_with(".locker-part") {
                self.files.insert((name.to_lowercase(), meta.len()), entry.path());
            }
        }
    }

    pub fn contains(&self, clip: &Clip) -> bool {
        self.files.contains_key(&(clip.name.to_lowercase(), clip.size))
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

/// Which clips on the card are not yet anywhere in the library?
pub fn missing_clips(clips: &[Clip], index: &LibraryIndex) -> Vec<Clip> {
    clips.iter().filter(|c| !index.contains(c)).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::scan_card;
    use std::fs::{create_dir_all, write};

    #[test]
    fn finds_only_missing_clips() {
        let tmp = tempfile::tempdir().unwrap();
        let card = tmp.path().join("card");
        create_dir_all(card.join("DCIM/100CANON")).unwrap();
        write(card.join("DCIM/100CANON/A.MP4"), b"1111").unwrap();
        write(card.join("DCIM/100CANON/B.MP4"), b"2222").unwrap();
        write(card.join("DCIM/100CANON/C.MP4"), b"3333").unwrap();

        let lib = tmp.path().join("lib");
        create_dir_all(lib.join("Kunde/2026/old_shoot")).unwrap();
        write(lib.join("Kunde/2026/old_shoot/a.mp4"), b"1111").unwrap(); // same file
        write(lib.join("Kunde/2026/old_shoot/B.MP4"), b"22").unwrap(); // different size

        let clips = scan_card(&card);
        let missing = missing_clips(&clips, &LibraryIndex::build(&lib));
        let names: Vec<_> = missing.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["B.MP4", "C.MP4"]);
    }
}
