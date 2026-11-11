//! Locker core: detect cards, scan clips, find what is missing on the drive,
//! copy it into the shoot folder and verify every file by checksum.
//!
//! Golden rules:
//! - The card is only ever read, never written to.
//! - An existing file at the destination is never overwritten.

pub mod card;
pub mod copy;
pub mod library;
pub mod plan;
pub mod util;

pub use card::{find_cards, scan_card, Card, Clip};
pub use copy::{offload, OffloadEvent, OffloadOptions, OffloadReport};
pub use library::{missing_clips, LibraryIndex};
pub use plan::{render_template, ShootInfo, DEFAULT_TEMPLATE};
