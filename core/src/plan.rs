use serde::Deserialize;
use std::path::{Path, PathBuf};

use crate::util::sanitize;

/// Default folder structure. Placeholders: {client} {shoot} {date} {year} {month} {camera}
pub const DEFAULT_TEMPLATE: &str = "{client}/{year}/{date}_{shoot}/{camera}";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShootInfo {
    pub client: String,
    pub shoot: String,
    /// `YYYY-MM-DD`
    pub date: String,
    pub camera: String,
}

/// Builds the target folder from the template.
/// Each segment is cleaned up separately so that a `/` in the client name
/// does not create an extra folder.
pub fn render_template(library: &Path, template: &str, info: &ShootInfo) -> PathBuf {
    let year = info.date.get(0..4).unwrap_or("0000");
    let month = info.date.get(5..7).unwrap_or("00");
    let mut out = library.to_path_buf();
    for segment in template.split(['/', '\\']).filter(|s| !s.trim().is_empty()) {
        let filled = segment
            .replace("{client}", &sanitize(&info.client))
            .replace("{shoot}", &sanitize(&info.shoot))
            .replace("{date}", &info.date)
            .replace("{year}", year)
            .replace("{month}", month)
            .replace("{camera}", &sanitize(&info.camera));
        out.push(sanitize(&filled));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_default_template() {
        let info = ShootInfo {
            client: "Nike".into(),
            shoot: "Spring/Spot".into(),
            date: "2026-11-11".into(),
            camera: "Sony".into(),
        };
        let p = render_template(Path::new("/lib"), DEFAULT_TEMPLATE, &info);
        assert_eq!(p, PathBuf::from("/lib/Nike/2026/2026-11-11_Spring-Spot/Sony"));
    }
}
