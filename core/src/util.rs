use std::time::{SystemTime, UNIX_EPOCH};

/// Converts a timestamp to a calendar date (UTC) as `YYYY-MM-DD`.
/// Without external date libraries (algorithm by Howard Hinnant).
pub fn ymd(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Makes a string safe as a folder name on macOS and Windows.
pub fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim_matches(|c| c == '.' || c == ' ').to_string();
    if cleaned.is_empty() {
        "Unbenannt".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn ymd_works() {
        assert_eq!(ymd(UNIX_EPOCH), "1970-01-01");
        // 2026-11-11 00:00:00 UTC
        assert_eq!(ymd(UNIX_EPOCH + Duration::from_secs(1_794_355_200)), "2026-11-11");
        // Leap day
        assert_eq!(ymd(UNIX_EPOCH + Duration::from_secs(951_782_400)), "2000-02-29");
    }

    #[test]
    fn sanitize_strips_bad_chars() {
        assert_eq!(sanitize("Nike: Spot/2"), "Nike- Spot-2");
        assert_eq!(sanitize("  ...  "), "Unbenannt");
    }
}
