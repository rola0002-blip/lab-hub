//! Native desktop notifications bridged from remote content pages.
//!
//! The `notify-shim.js` init script replaces `window.Notification` on every
//! server content webview (see `desktop/ui/notify-shim.js`); constructing
//! one invokes the [`desktop_notify`] command, which rate-limits,
//! truncates, and posts a native toast via tauri-plugin-notification. The
//! web app keeps full ownership of *when* to notify (its mute rules run
//! before it ever calls Notification); the shell only renders what it is
//! given and defends itself against spam (rate limit) and oversized
//! payloads (truncation).
//!
//! Click behavior: tauri-plugin-notification (2.3.3) exposes no click
//! callback on desktop — clicking a delivered toast merely activates the
//! app (source: plugin `src/desktop.rs`, whose `request_permission` is
//! likewise a desktop stub returning `Granted`; macOS shows its one-time
//! system prompt when the first notification actually posts). So the
//! desired "click -> focus main window + switch to the notifying server"
//! is implemented as: every delivered notification records its server as
//! the pending target in managed [`NotifyState`], and the main window's
//! next `Focused(true)` event consumes it (a toast click activates the
//! app, which focuses the window). The heuristic also fires on a plain
//! manual re-focus — acceptable, and usually desired: the freshest
//! notification points at where the user wants to be next — and the
//! target is consumed exactly once.
//!
//! Close-to-tray wrinkle: a HIDDEN window never fires `Focused(true)`,
//! so a toast clicked while hidden leaves the target pending; the next
//! show (tray Show / tray server item / this fn itself — all of which
//! show + focus, see [`consume_pending_click`]) then consumes it and
//! lands the user on the notifying server.
//!
//! Toast audio (2026-09 notifications): message toasts carry the OS default
//! sound (Slack-like delivery — this flips the old W9-D7 silent contract,
//! because the webview chime fails when the window is hidden or another
//! lab's webview is focused). Housekeeping toasts (download complete) opt
//! out with `silent: true` from the page. The in-page chime is suppressed
//! inside the shell by the web app itself, so there is exactly one sound
//! per alert.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_notification::NotificationExt;

use crate::config::AppConfig;
use crate::servers::server_for_url;

/// Anti-spam budget: at most 10 notifications in any sliding 10 s window,
/// process-wide (all servers share it — the cap exists to protect the
/// user's screen, not to fairly apportion it).
pub const RATE_LIMIT_MAX: usize = 10;
pub const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(10);

/// Defensive payload cap: title and body are each truncated to 200 chars
/// so a hostile/buggy page cannot stuff arbitrary content into the toast.
pub const MAX_TEXT_CHARS: usize = 200;

/// Sliding-window rate limiter: at most `max` hits in any `window` span.
/// Time is an explicit input to [`SlidingWindowLimiter::allow_at`] so the
/// window semantics are unit-testable without sleeping; `allow` is the
/// wall-clock wrapper the command uses. Dropped hits are NOT recorded, so
/// sustained spam never slides the window against the spammer.
pub struct SlidingWindowLimiter {
    max: usize,
    window: Duration,
    hits: Mutex<VecDeque<Instant>>,
}

impl SlidingWindowLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Mutex::new(VecDeque::new()),
        }
    }

    /// Records `now` and returns `true` if allowed, `false` (record
    /// untouched) if the window is full. A hit expires once it is strictly
    /// older than `window` (`elapsed > window`).
    pub fn allow_at(&self, now: Instant) -> bool {
        // No code between lock and unlock can panic, so poison is
        // impossible in practice; recover rather than crash a wry callback.
        let mut hits = self.hits.lock().unwrap_or_else(|p| p.into_inner());
        while let Some(front) = hits.front() {
            if now.duration_since(*front) > self.window {
                hits.pop_front();
            } else {
                break;
            }
        }
        if hits.len() >= self.max {
            false
        } else {
            hits.push_back(now);
            true
        }
    }

    pub fn allow(&self) -> bool {
        self.allow_at(Instant::now())
    }

    /// Hits currently inside the window (assertions + pruning tests only).
    #[cfg(test)]
    fn tracked(&self) -> usize {
        self.hits.lock().unwrap_or_else(|p| p.into_inner()).len()
    }
}

impl Default for SlidingWindowLimiter {
    fn default() -> Self {
        Self::new(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)
    }
}

/// Managed notification state: the shared rate limiter plus the pending
/// click target (id of the server whose notification most recently
/// delivered, awaiting the main window's next focus).
#[derive(Default)]
pub struct NotifyState {
    limiter: SlidingWindowLimiter,
    pending_click_target: Mutex<Option<String>>,
}

impl NotifyState {
    pub fn set_pending_target(&self, server_id: Option<String>) {
        // Lock poisoning is impossible (no fallible code under the lock).
        *self
            .pending_click_target
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = server_id;
    }

    /// Takes (clears) the pending target — one consumption per focus.
    pub fn take_pending_target(&self) -> Option<String> {
        self.pending_click_target
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
    }

    /// Non-consuming read (smoke assertion of the click-routing seam).
    pub fn pending_target(&self) -> Option<String> {
        self.pending_click_target
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
}

/// Truncates to at most `max_chars` CHARACTERS on char boundaries, so
/// multibyte content (emoji, CJK) can never panic a slice and never
/// renders a half glyph.
pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

/// Toast sound policy: message alerts ring (OS default); housekeeping
/// toasts (downloads) stay silent.
pub enum ToastSound {
    Default,
    Silent,
}

impl ToastSound {
    fn sound_name(&self) -> Option<&'static str> {
        match self {
            ToastSound::Default => Some("default"),
            ToastSound::Silent => None,
        }
    }
}

/// The shim's `silent` flag; ABSENT means sound ON (the download toast is
/// the only in-tree caller that passes true today).
fn toast_sound_from_flag(silent: Option<bool>) -> ToastSound {
    if silent.unwrap_or(false) {
        ToastSound::Silent
    } else {
        ToastSound::Default
    }
}

/// The single delivery site for shell toasts. Shared by the
/// `desktop_notify` command and the download-completion toast
/// (webviews.rs). Fire-and-forget with a result: `true` when the show
/// succeeded, `false` when the OS/plugin refused it — the failure is
/// warned HERE (the only failure log; callers must not double-log) and
/// callers gate their own "delivered" logging on the bool.
pub fn show_toast(app: &AppHandle, title: &str, body: &str, sound: ToastSound) -> bool {
    let mut builder = app.notification().builder().title(title).body(body);
    if let Some(name) = sound.sound_name() {
        builder = builder.sound(name);
    }
    match builder.show() {
        Ok(()) => true,
        Err(e) => {
            log::warn!("notification show failed: {e}");
            false
        }
    }
}

/// Remote-page -> native toast bridge, invoked by the notify shim
/// (`desktop/ui/notify-shim.js`). The calling webview is injected by
/// Tauri, and its CURRENT url — never any caller-supplied value — is the
/// only input trusted for click routing; a hostile page cannot name
/// another server as its origin. If the webview url cannot be read,
/// click routing is skipped (server `None`) but the toast still delivers.
#[tauri::command]
pub fn desktop_notify(
    app: AppHandle,
    webview: Webview,
    title: String,
    body: String,
    silent: Option<bool>,
) -> Result<(), String> {
    let state = app.state::<NotifyState>();

    // Spam defense first: drop (with a log) beyond the sliding budget. The
    // call still resolves Ok — the notification was accepted and
    // suppressed, and a hostile page gains nothing from an error shape.
    if !state.limiter.allow() {
        log::warn!("desktop_notify dropped (rate-limited): title={title:?}");
        return Ok(());
    }

    let title = truncate_chars(&title, MAX_TEXT_CHARS);
    let body = truncate_chars(&body, MAX_TEXT_CHARS);

    // Click routing: resolve the calling webview's own origin to a
    // configured server. Foreign origins still notify, they just have no
    // switch target.
    let target = match webview.url() {
        Ok(url) => {
            let config_state = app.state::<Mutex<AppConfig>>();
            let config = config_state
                .lock()
                .map_err(|_| "Config state poisoned".to_string())?
                .clone();
            server_for_url(&config, url.as_str())
        }
        Err(e) => {
            log::warn!("desktop_notify: webview url unreadable ({e}); click routing skipped");
            None
        }
    };
    state.set_pending_target(target.clone());

    // Delivery is best-effort: the OS may suppress the toast (Focus / Do
    // Not Disturb / permission denied after the one-time prompt), and the
    // page can do nothing with that error — so failures are logged inside
    // [`show_toast`] and the command still resolves Ok (delivery failure ≠
    // bad request). The "delivered" log is gated on the show result so it
    // never overclaims a suppressed toast.
    if show_toast(&app, &title, &body, toast_sound_from_flag(silent)) {
        log::info!("desktop_notify delivered: title={title:?} server={target:?}");
    }
    Ok(())
}

/// Consumes the pending notification click target on main-window focus
/// (see module docs for why focus is the click signal on desktop). No-op
/// when nothing is pending, so ordinary dock-click focus is untouched.
///
/// Show-if-hidden: with close-to-tray the main window may be hidden when
/// a toast is clicked — and a hidden window never fires `Focused(true)`,
/// so the pending target survives until the next show. Every path that
/// surfaces this consumption (this fn, tray `Show LabHub`, tray server
/// items) shows + focuses the window first, which both reveals it and
/// triggers the Focused event that lands the user on the notifying
/// server.
pub fn consume_pending_click(app: &AppHandle) {
    let Some(state) = app.try_state::<NotifyState>() else {
        return;
    };
    let Some(server_id) = state.take_pending_target() else {
        return;
    };
    if let Some(window) = app.get_window(crate::webviews::WINDOW_LABEL) {
        // A hidden window cannot be focused: show first, then focus.
        if let Err(e) = window.show() {
            log::warn!("notification click: show main window failed: {e}");
        }
        if let Err(e) = window.set_focus() {
            log::warn!("notification click: focus main window failed: {e}");
        }
    }
    let result = crate::commands::set_active(app.clone(), app.state(), server_id.clone());
    match result {
        Ok(()) => {
            log::info!("notification click: main window shown + switched to server {server_id}")
        }
        Err(e) => log::warn!("notification click switch to {server_id} failed: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Instant {
        Instant::now()
    }

    // --- SlidingWindowLimiter ---

    #[test]
    fn under_limit_all_pass() {
        let lim = SlidingWindowLimiter::new(10, Duration::from_secs(10));
        let b = base();
        for i in 0..9 {
            assert!(
                lim.allow_at(b + Duration::from_secs_f64(i as f64 * 0.5)),
                "hit {i}"
            );
        }
        assert_eq!(lim.tracked(), 9);
    }

    #[test]
    fn exactly_at_limit_passes() {
        let lim = SlidingWindowLimiter::new(10, Duration::from_secs(10));
        let b = base();
        for i in 0..10 {
            assert!(lim.allow_at(b), "hit {i}");
        }
    }

    #[test]
    fn over_limit_drops() {
        let lim = SlidingWindowLimiter::new(10, Duration::from_secs(10));
        let b = base();
        for _ in 0..10 {
            assert!(lim.allow_at(b));
        }
        assert!(!lim.allow_at(b), "11th hit in-window must drop");
        assert_eq!(lim.tracked(), 10, "dropped hits are not recorded");
    }

    #[test]
    fn window_slides_so_old_hits_expire() {
        let lim = SlidingWindowLimiter::new(10, Duration::from_secs(10));
        let b = base();
        for i in 0..10 {
            lim.allow_at(b + Duration::from_secs_f64(i as f64 * 1.0)); // t=0..t=9
        }
        // t=9.5: all ten hits (t=0..t=9) are inside the window.
        assert!(!lim.allow_at(b + Duration::from_millis(9500)));
        // t=10.5: the t=0 hit is strictly older than 10 s -> room for one.
        assert!(lim.allow_at(b + Duration::from_millis(10500)));
    }

    #[test]
    fn hit_exactly_window_old_still_counts() {
        // Boundary is strict `elapsed > window`: a hit aged exactly the
        // window still occupies a slot at the instant it turns 10 s old.
        let lim = SlidingWindowLimiter::new(1, Duration::from_secs(10));
        let b = base();
        assert!(lim.allow_at(b));
        assert!(
            !lim.allow_at(b + Duration::from_secs(10)),
            "exactly 10 s old still counts"
        );
        assert!(
            lim.allow_at(b + Duration::from_secs_f64(10.0001)),
            "strictly past the window frees the slot"
        );
    }

    #[test]
    fn dropped_spam_never_slides_the_window() {
        // Sustained over-limit spam must not extend the busy window: if
        // drops were recorded, every later hit would stay blocked forever.
        let lim = SlidingWindowLimiter::new(10, Duration::from_secs(10));
        let b = base();
        for i in 0..10 {
            lim.allow_at(b + Duration::from_secs_f64(i as f64 * 0.1)); // t=0..t=0.9
        }
        for i in 0..50 {
            assert!(!lim.allow_at(b + Duration::from_secs_f64(1.0 + i as f64 * 0.1)));
        }
        // t=11: every real hit (<= t=0.9) has expired; spam added nothing.
        assert!(lim.allow_at(b + Duration::from_secs(11)));
        assert_eq!(lim.tracked(), 1);
    }

    #[test]
    fn full_recovery_after_quiet_period() {
        let lim = SlidingWindowLimiter::new(3, Duration::from_secs(10));
        let b = base();
        for _ in 0..3 {
            assert!(lim.allow_at(b));
        }
        assert!(!lim.allow_at(b));
        let later = b + Duration::from_secs(11);
        for i in 0..3 {
            assert!(
                lim.allow_at(later + Duration::from_secs_f64(i as f64 * 0.1)),
                "recovered {i}"
            );
        }
        assert!(!lim.allow_at(later + Duration::from_secs_f64(0.4)));
    }

    #[test]
    fn pruning_keeps_memory_bounded() {
        let lim = SlidingWindowLimiter::new(10, Duration::from_secs(10));
        let b = base();
        for _ in 0..10 {
            lim.allow_at(b);
        }
        assert_eq!(lim.tracked(), 10);
        lim.allow_at(b + Duration::from_secs(20));
        assert_eq!(
            lim.tracked(),
            1,
            "expired hits are pruned on the next decision"
        );
    }

    #[test]
    fn max_one_limiter_allows_single_hit() {
        let lim = SlidingWindowLimiter::new(1, Duration::from_secs(10));
        let b = base();
        assert!(lim.allow_at(b));
        assert!(!lim.allow_at(b));
        assert!(!lim.allow_at(b + Duration::from_secs(5)));
    }

    #[test]
    fn defaults_are_ten_per_ten_seconds() {
        let lim = SlidingWindowLimiter::default();
        assert_eq!(lim.max, RATE_LIMIT_MAX);
        assert_eq!(lim.window, RATE_LIMIT_WINDOW);
    }

    #[test]
    fn limiters_are_independent() {
        let a = SlidingWindowLimiter::new(1, Duration::from_secs(10));
        let b = SlidingWindowLimiter::new(1, Duration::from_secs(10));
        let now = base();
        assert!(a.allow_at(now));
        assert!(b.allow_at(now), "separate instances share no state");
        assert!(!a.allow_at(now));
    }

    // --- truncate_chars ---

    #[test]
    fn truncate_short_string_unchanged() {
        assert_eq!(truncate_chars("hello", 200), "hello");
    }

    #[test]
    fn truncate_exactly_max_unchanged() {
        let s = "x".repeat(200);
        assert_eq!(truncate_chars(&s, 200), s);
    }

    #[test]
    fn truncate_over_max_cuts_to_max() {
        let s = "x".repeat(250);
        assert_eq!(truncate_chars(&s, 200).chars().count(), 200);
    }

    #[test]
    fn truncate_multibyte_never_panics_and_keeps_whole_chars() {
        let s = "あ".repeat(250); // 750 bytes, 250 chars
        let out = truncate_chars(&s, 200);
        assert_eq!(out.chars().count(), 200);
        assert_eq!(out.len(), 600); // whole chars only
    }

    #[test]
    fn truncate_mixed_script_on_char_boundary() {
        let s = format!("{}{}", "ab".repeat(99), "🎉🎉🎉"); // 198 ascii + 3 emoji
        let out = truncate_chars(&s, 200);
        assert_eq!(out.chars().count(), 200);
        assert!(out.ends_with('🎉'));
    }

    #[test]
    fn truncate_empty_and_boundaries() {
        assert_eq!(truncate_chars("", 200), "");
        assert_eq!(truncate_chars("x", 0), "");
        assert_eq!(truncate_chars("xyz", 0), "");
    }

    // --- ToastSound ---

    #[test]
    fn default_sound_maps_to_os_default_silent_maps_to_none() {
        assert_eq!(ToastSound::Default.sound_name(), Some("default"));
        assert_eq!(ToastSound::Silent.sound_name(), None);
    }

    #[test]
    fn silent_flag_absent_means_sound_on() {
        assert!(matches!(toast_sound_from_flag(None), ToastSound::Default));
        assert!(matches!(
            toast_sound_from_flag(Some(false)),
            ToastSound::Default
        ));
        assert!(matches!(
            toast_sound_from_flag(Some(true)),
            ToastSound::Silent
        ));
    }

    // --- NotifyState pending target ---

    #[test]
    fn pending_target_round_trip_and_clear() {
        let state = NotifyState::default();
        assert_eq!(state.pending_target(), None);
        state.set_pending_target(Some("srv-a".into()));
        assert_eq!(state.pending_target(), Some("srv-a".into()));
        assert_eq!(state.take_pending_target(), Some("srv-a".into()));
        assert_eq!(state.pending_target(), None, "take clears");
        assert_eq!(state.take_pending_target(), None, "second take is None");
    }

    #[test]
    fn pending_target_last_write_wins() {
        let state = NotifyState::default();
        state.set_pending_target(Some("srv-a".into()));
        state.set_pending_target(Some("srv-b".into()));
        assert_eq!(state.pending_target(), Some("srv-b".into()));
        state.set_pending_target(None); // foreign origin: clears any target
        assert_eq!(state.pending_target(), None);
    }

    #[test]
    fn notify_state_default_uses_default_limiter() {
        let state = NotifyState::default();
        let b = base();
        for _ in 0..RATE_LIMIT_MAX {
            assert!(state.limiter.allow_at(b));
        }
        assert!(!state.limiter.allow_at(b));
    }
}
