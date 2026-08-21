//! Auto-updater (Task 8): poll the GitHub-hosted `latest.json` manifest.
//! Rust-side only — no capability grants the updater JS API, so neither
//! the local rail nor remote server pages can drive it from JS.
//!
//! Two entry paths funnel into [`check_and_apply`], serialized by an
//! in-flight guard ([`IN_FLIGHT`] — a reentrant call logs and returns):
//! - non-interactive: 30 s after launch, from a background thread spawned
//!   by [`init`]. ANNOUNCE-ONLY: it checks and, when a newer version is
//!   out, emits `updater://available` and logs — it never downloads or
//!   installs. Rationale: the plugin's `Update::install` on Windows runs
//!   the NSIS installer, which `/R`-restarts the app and exits the
//!   process (`std::process::exit(0)` in the plugin) — an unattended
//!   force-quit; and a staged macOS download without `install()` does
//!   nothing on next launch. So the background check only surfaces the
//!   update; acting on it stays user-initiated.
//! - interactive: the tray "Check for Updates" item emits
//!   `tray://check-updates` (tray.rs), which [`init`] listens for. This
//!   path downloads + installs + restarts.
//!
//! Install/relaunch semantics, verified against the vendored sources
//! (tauri-plugin-updater 2.10.1, tauri 2.11.5):
//! - `UpdaterExt::updater()` (plugin src/lib.rs:67) builds the updater
//!   from `plugins.updater` in tauri.conf.json; `Updater::check`
//!   (plugin src/updater.rs:386) fetches + parses `latest.json` and
//!   compares against the running version.
//! - `Update::download` (plugin src/updater.rs:652) streams the platform
//!   artifact and verifies its minisign signature against `pubkey` — a
//!   bad signature errors here, before anything is installed.
//! - `Update::install` on macOS (plugin src/updater.rs:1211-1311):
//!   extracts the downloaded `.app.tar.gz`, moves the old `.app` bundle
//!   aside and the new one into place, then RETURNS — the running process
//!   keeps executing from the replaced bundle, so an explicit relaunch is
//!   required.
//! - `Update::install` on Windows (plugin src/updater.rs:778-856): spawns
//!   the NSIS/MSI installer — passive mode maps to `/P /R` args (plugin
//!   src/config.rs:47-54), the `/R` restarts the app when done — and then
//!   calls `std::process::exit(0)` itself, so code after `install()` is
//!   unreachable on Windows.
//!
//! Hence the INTERACTIVE flow below is download -> install ->
//! `AppHandle::request_restart()` (tauri src/app.rs:615): on macOS/Linux
//! the restart relaunches the freshly swapped binary; on Windows it is
//! never reached because the installer path already exited the process.
//!
//! Events (v1: logs only — nothing listens yet; the chrome rail could
//! surface them later):
//! - `updater://available` `{version, notes}` when an update is found
//!   (notes truncated to [`NOTES_LIMIT`] chars) — the background check
//!   stops here; only an interactive run proceeds past it.
//! - `updater://status` `{state, detail?}` at each step of an
//!   INTERACTIVE run: checking / none / downloading / installed / error.
//!   Non-interactive runs log only, so background checks stay invisible.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener};
use tauri_plugin_updater::UpdaterExt;

use crate::tray;

/// Emitted when a newer version is announced by the manifest.
pub const AVAILABLE_EVENT: &str = "updater://available";
/// Emitted at each step of an interactive (tray-triggered) check.
pub const STATUS_EVENT: &str = "updater://status";
/// How long after launch the non-interactive check fires. Long enough to
/// not compete with startup (webviews, tray, window-state restore), short
/// enough that an update lands without the user thinking about it.
pub const STARTUP_DELAY: Duration = Duration::from_secs(30);
/// Release-notes truncation for the `updater://available` payload — full
/// notes stay in the GitHub Release; this only feeds a future toast/rail
/// line, so a bounded preview is enough.
pub const NOTES_LIMIT: usize = 200;

#[derive(Serialize, Clone)]
struct AvailablePayload {
    version: String,
    notes: String,
}

#[derive(Serialize, Clone)]
struct StatusPayload {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

/// Truncate release notes to [`NOTES_LIMIT`] chars for the event payload.
pub fn truncate_notes(notes: Option<&str>) -> String {
    let notes = notes.unwrap_or("");
    if notes.chars().count() <= NOTES_LIMIT {
        notes.to_string()
    } else {
        let cut: String = notes.chars().take(NOTES_LIMIT).collect();
        format!("{cut}...")
    }
}

/// Emit one `updater://status` step (interactive runs only) and log it —
/// the log doubles as the smoke/operator trace.
fn emit_status(app: &AppHandle, state: &'static str, detail: Option<String>) {
    log::info!(
        "updater: {state}{}",
        detail
            .as_deref()
            .map(|d| format!(": {d}"))
            .unwrap_or_default()
    );
    if let Err(e) = app.emit(STATUS_EVENT, StatusPayload { state, detail }) {
        log::warn!("updater: emit {STATUS_EVENT} failed: {e}");
    }
}

/// Check for an update. Never shows a dialog: every failure path logs a
/// warning (and, when `interactive`, emits an error status) and returns.
///
/// `interactive` = triggered from the tray menu: emits the step-by-step
/// `updater://status` events and, when an update exists, downloads +
/// installs it and relaunches (on Windows the installer exits the
/// process itself). Otherwise (30 s background check) the run is
/// announce-only: check, emit `updater://available`, log — no download,
/// no install, no restart. Both shapes share the [`IN_FLIGHT`] guard.
pub fn check_and_apply(app: AppHandle, interactive: bool) {
    // Serialize cycles: a second trigger while one is running (e.g. tray
    // click during the background check, or a double click) logs and
    // returns instead of racing downloads/installs. The guard is RAII so
    // the flag releases even when the cycle errors — on the Windows
    // interactive path the process exits inside install() before the
    // drop, which is fine (the flag dies with the process).
    let Some(_cycle_guard) = CycleGuard::acquire() else {
        log::info!("updater: cycle already in flight — skipping");
        return;
    };
    if interactive {
        emit_status(&app, "checking", None);
    } else {
        log::info!("updater: background check starting (announce-only)");
    }
    tauri::async_runtime::spawn(async move {
        let _cycle_guard = _cycle_guard;
        let result = run_cycle(&app, interactive).await;
        drop(_cycle_guard);
        if let Err(e) = result {
            log::warn!("updater: {e}");
            if interactive {
                emit_status(&app, "error", Some(e));
            }
        }
    });
}

/// True while a check cycle is mid-flight; backs the reentrancy guard in
/// [`check_and_apply`].
static IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// RAII ownership of [`IN_FLIGHT`]: `acquire` succeeds for exactly one
/// holder at a time; dropping it (including on unwind) re-arms the flag.
struct CycleGuard;

impl CycleGuard {
    fn acquire() -> Option<Self> {
        if IN_FLIGHT.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(CycleGuard)
        }
    }
}

impl Drop for CycleGuard {
    fn drop(&mut self) {
        IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

/// One full check cycle. `Ok(())` covers "no update", "update announced"
/// (background runs stop there) and "update installed" (interactive runs;
/// on Windows the process exits inside install, on macOS the restart is
/// requested before returning).
async fn run_cycle(app: &AppHandle, interactive: bool) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("updater unavailable: {e}"))?;
    match updater.check().await {
        Err(e) => Err(format!("check failed: {e}")),
        Ok(None) => {
            log::info!("updater: no update available");
            if interactive {
                emit_status(app, "none", None);
            }
            Ok(())
        }
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = truncate_notes(update.body.as_deref());
            log::info!("updater: update available: v{version}");
            if let Err(e) = app.emit(
                AVAILABLE_EVENT,
                AvailablePayload {
                    version: version.clone(),
                    notes,
                },
            ) {
                log::warn!("updater: emit {AVAILABLE_EVENT} failed: {e}");
            }
            if !interactive {
                // Background runs end here: installing unattended would
                // force-quit the app on Windows (the NSIS installer
                // restarts + exits the process) and a staged download
                // without install() has no effect on macOS. Announce and
                // let the user pull the trigger from the tray.
                log::info!(
                    "updater: v{version} announced by background check — \
                     use the tray's Check for Updates to download, install, \
                     and restart"
                );
                return Ok(());
            }
            emit_status(app, "downloading", Some(format!("v{version}")));
            // download() verifies the minisign signature against the
            // pubkey before returning the bytes (updater.rs:652).
            let bytes = update
                .download(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| format!("download v{version} failed: {e}"))?;
            // macOS: swaps the .app bundle and returns (updater.rs:1211);
            // Windows: runs the installer then exits the process
            // (updater.rs:855) — the lines below are macOS/Linux only.
            update
                .install(bytes)
                .map_err(|e| format!("install v{version} failed: {e}"))?;
            log::info!("updater: v{version} installed; restarting");
            emit_status(app, "installed", Some(format!("v{version}")));
            app.request_restart();
            Ok(())
        }
    }
}

/// Wire the two trigger paths. Called once from `bootstrap`, i.e. after
/// the updater + process plugins are registered in `run`/`smoke`.
pub fn init(app: &AppHandle) {
    // Tray-triggered interactive checks: the menu item emits
    // `tray://check-updates`; spawn so the menu handler returns instantly.
    let interactive_app = app.clone();
    app.listen(tray::CHECK_UPDATES_EVENT, move |_event| {
        check_and_apply(interactive_app.clone(), true);
    });
    // Background check: plain thread + sleep keeps the async runtime out
    // of the picture until the real work starts inside check_and_apply.
    let background_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        check_and_apply(background_app, false);
    });
    log::info!(
        "updater: plugin registered; background check in {} s, tray item armed",
        STARTUP_DELAY.as_secs()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- truncate_notes ---

    #[test]
    fn short_notes_pass_through_unchanged() {
        assert_eq!(truncate_notes(Some("bug fixes")), "bug fixes");
        assert_eq!(truncate_notes(None), "");
    }

    #[test]
    fn long_notes_truncate_with_ellipsis_marker() {
        let long = "x".repeat(NOTES_LIMIT + 50);
        let truncated = truncate_notes(Some(&long));
        assert_eq!(truncated.chars().count(), NOTES_LIMIT + 3);
        assert!(truncated.ends_with("..."));
        assert!(truncated.starts_with(&"x".repeat(NOTES_LIMIT)));
    }

    #[test]
    fn exactly_limit_notes_are_not_truncated() {
        let exact: String = "y".repeat(NOTES_LIMIT);
        assert_eq!(truncate_notes(Some(&exact)), exact);
    }

    #[test]
    fn truncation_is_char_based_not_byte_based() {
        // 201 multibyte chars must count as 201, not 603 bytes.
        let long = "é".repeat(NOTES_LIMIT + 1);
        let truncated = truncate_notes(Some(&long));
        assert!(truncated.chars().count() <= NOTES_LIMIT + 3);
        assert!(truncated.ends_with("..."));
    }

    // --- event names ---

    #[test]
    fn event_names_use_the_updater_scheme() {
        assert!(AVAILABLE_EVENT.starts_with("updater://"));
        assert!(STATUS_EVENT.starts_with("updater://"));
        assert_ne!(AVAILABLE_EVENT, STATUS_EVENT);
    }

    // --- in-flight guard ---

    #[test]
    fn cycle_guard_admits_one_holder_then_re_arms() {
        assert!(
            !IN_FLIGHT.load(Ordering::SeqCst),
            "guard starts disarmed (no other holder in this process)"
        );
        let guard = CycleGuard::acquire().expect("first acquire succeeds");
        assert!(
            CycleGuard::acquire().is_none(),
            "reentrant acquire while held is rejected"
        );
        drop(guard);
        assert!(!IN_FLIGHT.load(Ordering::SeqCst), "drop re-arms the guard");
        let again = CycleGuard::acquire().expect("acquire after drop succeeds");
        drop(again);
    }
}
