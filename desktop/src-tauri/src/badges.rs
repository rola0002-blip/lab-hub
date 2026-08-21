//! Per-server unread badges + the macOS dock badge.
//!
//! The ONLY unread encoding the web app uses is a leading `(n) ` prefix on
//! the document title, written by `ChatTitleBadge`
//! (src/components/chat-title-badge.tsx:19-21):
//!
//! ```text
//! document.title = n > 0 ? `(${n}) ${base.current}` : base.current
//! ```
//!
//! `base.current` is captured once from the server-rendered title, which is
//! always "LabHub" (src/app/layout.tsx:19 — the root metadata title with no
//! template; no page in src/app defines its own metadata title). `n` comes
//! from `sumUnread` (src/features/chat/unread.ts:8-9), which skips muted
//! conversations. So the only titles the app can produce are `LabHub` and
//! `(n) LabHub` for n >= 1 — there is no `(n+)` or `n new` encoding, and
//! `(0)` can never be emitted (the `n > 0` gate restores the base title).
//!
//! Badge data is PUSH-driven from `on_document_title_changed`; never poll
//! hidden webviews with `eval_with_callback` (Task 4 quirk: callbacks on
//! hidden webviews may never fire).

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// Managed state: server_id -> latest unread count. Entries exist only for
/// servers whose last known title carried an unread prefix, so the map is
/// sparse and `total` is a plain saturating sum.
#[derive(Default)]
pub struct BadgeState {
    pub unread: Mutex<HashMap<String, u32>>,
}

impl BadgeState {
    /// Sum over all servers (saturating); 0 when nothing is unread.
    pub fn total(&self) -> u32 {
        self.unread.lock().map(|m| total_of(&m)).unwrap_or(0)
    }

    /// Number of servers with a tracked unread entry (smoke assertions).
    pub fn entry_count(&self) -> usize {
        self.unread.lock().map(|m| m.len()).unwrap_or(0)
    }
}

/// Extracts the unread count from a LabHub document title.
///
/// Real formats (see module docs):
/// - `LabHub` -> `None` (src/app/layout.tsx:19)
/// - `(3) LabHub` -> `Some(3)` (src/components/chat-title-badge.tsx:21)
///
/// Parsing is strict because the app's format is exact: an optional-none is
/// returned unless the title is `(` + ASCII digits + `) ` + non-empty base.
/// `(0)` -> `None` (the app never writes it — `n > 0` gate — and 0 unread
/// means no unread). Values beyond u32 saturate at `u32::MAX` instead of
/// failing, so an absurd title can at worst show a huge badge.
pub fn unread_from_title(title: &str) -> Option<u32> {
    let rest = title.strip_prefix('(')?;
    // Digit prefix, saturating at u32::MAX. ASCII digits are one byte, so
    // the index always lands on a char boundary for the slice below.
    let bytes = rest.as_bytes();
    let mut n: u32 = 0;
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        n = n
            .saturating_mul(10)
            .saturating_add((bytes[i] - b'0') as u32);
        i += 1;
    }
    if i == 0 {
        return None; // "()" / "(-3)" / "(x)": no digit run
    }
    // The template writes "(${n}) ${base}" — require the ") " separator and
    // a non-empty base title after it.
    let base = rest[i..].strip_prefix(") ")?;
    if base.is_empty() {
        return None;
    }
    if n == 0 {
        return None; // never app-produced; 0 unread == no unread
    }
    Some(n)
}

/// Records a server's unread count: updates state (deduped), emits the
/// per-server badge event, and re-applies the dock badge.
pub fn set_server_unread(app: &AppHandle, server_id: &str, n: u32) {
    let Some(state) = app.try_state::<BadgeState>() else {
        log::warn!("badge state not managed; dropping unread={n} for {server_id}");
        return;
    };
    let total = {
        // Never panic from a wry title callback: a poisoned lock is dropped
        // with a warning instead.
        let Ok(mut map) = state.unread.lock() else {
            log::warn!("badge state poisoned; dropping unread={n} for {server_id}");
            return;
        };
        if map.insert(server_id.to_string(), n) == Some(n) {
            return; // unchanged: no event spam on repeated equal titles
        }
        total_of(&map)
    };
    emit_badge(app, server_id, n);
    apply_dock_badge(app, total);
}

/// Forgets a server's unread count (title reverted to no-unread, or the
/// server was removed). Emits 0 for the server only when a count was
/// actually dropped, so the rail hides a stale badge.
pub fn clear_server_unread(app: &AppHandle, server_id: &str) {
    let Some(state) = app.try_state::<BadgeState>() else {
        return;
    };
    let total = {
        let Ok(mut map) = state.unread.lock() else {
            return;
        };
        if map.remove(server_id).is_none() {
            return; // nothing tracked: nothing to emit or recompute
        }
        total_of(&map)
    };
    emit_badge(app, server_id, 0);
    apply_dock_badge(app, total);
}

/// Emits `server-badge://<server_id>` with a BARE NUMBER payload — that is
/// what the rail UI reads (`Number(event.payload) || 0`,
/// desktop/ui/app.js:119) — not an object.
fn emit_badge(app: &AppHandle, server_id: &str, n: u32) {
    if let Err(e) = app.emit(&format!("server-badge://{server_id}"), n) {
        log::warn!("emit server-badge://{server_id} failed: {e}");
    }
}

/// Applies the all-servers total to the dock/taskbar badge. `None` (or 0)
/// removes it per the tauri docs; errors are expected on platforms without
/// badge support and are log-only.
fn apply_dock_badge(app: &AppHandle, total: u32) {
    log::info!("dock badge total: {total}");
    let Some(window) = app.get_window(crate::webviews::WINDOW_LABEL) else {
        log::warn!("dock badge: main window missing");
        return;
    };
    let count = (total > 0).then_some(total as i64);
    if let Err(e) = window.set_badge_count(count) {
        log::warn!("set_badge_count({count:?}) failed: {e}");
    }
}

fn total_of(map: &HashMap<String, u32>) -> u32 {
    map.values().copied().fold(0, u32::saturating_add)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Real app code paths (formats cited from src/) ---

    /// Base title: root metadata title, no template (layout.tsx:19).
    #[test]
    fn base_title_labhub_is_none() {
        assert_eq!(unread_from_title("LabHub"), None);
    }

    /// The one unread encoding the app has (chat-title-badge.tsx:21).
    #[test]
    fn unread_prefix_parses() {
        assert_eq!(unread_from_title("(3) LabHub"), Some(3));
    }

    /// Minimum real n: the prefix exists only when n >= 1.
    #[test]
    fn single_unread_parses() {
        assert_eq!(unread_from_title("(1) LabHub"), Some(1));
    }

    /// sumUnread can exceed 9 (unread.ts:8 sums whole conversations).
    #[test]
    fn multi_digit_parses() {
        assert_eq!(unread_from_title("(12) LabHub"), Some(12));
        assert_eq!(unread_from_title("(4096) LabHub"), Some(4096));
    }

    /// n > 0 gate (chat-title-badge.tsx:21): `(0)` is never emitted, and
    /// 0 unread means no unread -> None.
    #[test]
    fn zero_prefix_is_none() {
        assert_eq!(unread_from_title("(0) LabHub"), None);
    }

    /// The base restore path (n back to 0) is indistinguishable from the
    /// plain base title — both must be None.
    #[test]
    fn reverted_title_is_none() {
        assert_eq!(unread_from_title("LabHub"), None);
    }

    // --- Edge cases ---

    #[test]
    fn empty_is_none() {
        assert_eq!(unread_from_title(""), None);
    }

    #[test]
    fn whitespace_only_is_none() {
        assert_eq!(unread_from_title("   "), None);
    }

    #[test]
    fn exact_u32_max_parses() {
        assert_eq!(unread_from_title("(4294967295) LabHub"), Some(u32::MAX));
    }

    #[test]
    fn saturates_one_past_u32_max() {
        assert_eq!(unread_from_title("(4294967296) LabHub"), Some(u32::MAX));
    }

    #[test]
    fn saturates_huge_digit_run() {
        assert_eq!(
            unread_from_title("(99999999999999999999999999) LabHub"),
            Some(u32::MAX)
        );
    }

    #[test]
    fn paren_must_be_leading() {
        assert_eq!(unread_from_title("3) LabHub"), None);
        assert_eq!(unread_from_title("LabHub (3)"), None);
    }

    #[test]
    fn non_digit_count_is_none() {
        assert_eq!(unread_from_title("() LabHub"), None);
        assert_eq!(unread_from_title("(x) LabHub"), None);
        assert_eq!(unread_from_title("(-3) LabHub"), None);
        assert_eq!(unread_from_title("(٣) LabHub"), None); // non-ASCII digits
    }

    /// The template always writes "(n) " with the space; a missing
    /// separator is not an app-produced title.
    #[test]
    fn missing_space_separator_is_none() {
        assert_eq!(unread_from_title("(3)LabHub"), None);
    }

    #[test]
    fn missing_base_is_none() {
        assert_eq!(unread_from_title("(3) "), None);
        assert_eq!(unread_from_title("(3)"), None);
    }

    #[test]
    fn leading_whitespace_is_none() {
        assert_eq!(unread_from_title(" (3) LabHub"), None);
    }

    /// Never app-produced (JS numbers don't zero-pad); decoded leniently.
    #[test]
    fn leading_zeros_decode_leniently() {
        assert_eq!(unread_from_title("(007) LabHub"), Some(7));
    }

    /// wry's initial document before the app loads.
    #[test]
    fn about_blank_is_none() {
        assert_eq!(unread_from_title("about:blank"), None);
    }

    // --- Totals (dock badge input) ---

    #[test]
    fn total_of_empty_is_zero() {
        assert_eq!(total_of(&HashMap::new()), 0);
    }

    #[test]
    fn total_of_sums_servers() {
        let map: HashMap<String, u32> = [("a", 3u32), ("b", 4u32)]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();
        assert_eq!(total_of(&map), 7);
    }

    #[test]
    fn total_of_saturates() {
        let map: HashMap<String, u32> = [("a", u32::MAX), ("b", 5u32)]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();
        assert_eq!(total_of(&map), u32::MAX);
    }

    #[test]
    fn badge_state_totals_from_tracked_entries() {
        let state = BadgeState::default();
        assert_eq!(state.total(), 0);
        assert_eq!(state.entry_count(), 0);
        state.unread.lock().unwrap().insert("srv-x".into(), 5);
        state.unread.lock().unwrap().insert("srv-y".into(), 6);
        assert_eq!(state.total(), 11);
        assert_eq!(state.entry_count(), 2);
    }
}
