// LabHub desktop smoke harness — headless-drivable regression binary.
//
// Drives the real app wiring (bootstrap + commands + webview manager) on a
// timeline, asserts lifecycle behavior, and captures screenshot evidence:
//
//   1. bootstrap with a sandboxed HOME (real config untouched)
//   2. chrome rail webview exists and loads the rail UI
//   3. commands::add_server creates the content webview (label srv-<id>)
//   4. document-title + page-load events fire (via log capture)
//   5. badge pipeline: note_title (the push seam shared with the real
//      title handler) with "(5) x — LabHub" emits server-badge://<id>
//      payload 5 and computes dock total 5; title revert emits 0;
//      remove_server clears the entry and recomputes the total
//   6. notify shim on the content webview: typeof Notification is a
//      function, Notification.permission reads 'granted', and
//      constructing one bridges to the real desktop_notify command (the
//      pending click target becomes the labhub server id)
//   7. remote-origin IPC: invoke('desktop_notify') resolves from the
//      server origin AND from a foreign origin (proves the labhub-remote
//      capability's https://* pattern); a GUI toast cannot be asserted
//      headlessly — the invoke result and command logs are the evidence
//   8. Webview::close works (foreign webview) and remove_server closes the
//      managed webview via sync
//   9. CGWindowList screenshot of rail + content and of the empty rail
//  10. tray: menu refreshed with placeholder at bootstrap, rebuilt with
//      the server after add (5 items) and back to placeholder after
//      remove (log-captured refreshes); close_to_tray persisted via the
//      command; pure close decision (main+flag) and menu-shape helper
//  11. hidden-window notify path: with the window hidden (close-to-tray
//      state), consuming a pending click target SHOWS the window again
//      (a hidden window never fires Focused — show-if-hidden fix)
//  12. window-state: seeded geometry restored for the runtime-created
//      main window (relayout follows the restored size); explicit save
//      writes a main entry next to config.json
//  13. rail auto-hide (wave 9): at exactly one server the chrome rail is
//      hidden (reveal flag false, relayout width 0 — Webview has no
//      is_visible()); after remove (zero servers) it is visible at full
//      rail width again
//
// Run: cargo run --example smoke (self-exits ~21 s; exit code 0 = all PASS).
// An EXAMPLE, not a [[bin]]: tauri bundles every cargo bin into the app
// (and `--target universal-apple-darwin` only lipo's the main binary,
// breaking universal bundling with extra bins) — examples stay out of
// the shipped .app/NSIS installer.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use log::Log as _;
use tauri::{Listener, Manager, Webview, WebviewBuilder, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

use labhub_desktop::badges::BadgeState;
use labhub_desktop::commands;
use labhub_desktop::config::{normalize_url, AppConfig};
use labhub_desktop::notify::{self, NotifyState};
use labhub_desktop::servers::server_id;
use labhub_desktop::tray;
use labhub_desktop::webviews;

const LABHUB_URL: &str = "https://labhub.taylabs.org";
const EXAMPLE_URL: &str = "https://example.org";

const SWIFT_FINDWIN: &str = r#"
import CoreGraphics
import Foundation
let names = Set(CommandLine.arguments.dropFirst())
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
var bestArea = 0
var bestId = 0
for w in list {
    guard let owner = w[kCGWindowOwnerName as String] as? String, names.contains(owner) else { continue }
    guard (w[kCGWindowLayer as String] as? Int) == 0 else { continue }
    guard let num = w[kCGWindowNumber as String] as? Int else { continue }
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let area = ((b["Width"] as? Int) ?? 0) * ((b["Height"] as? Int) ?? 0)
    if area > bestArea { bestArea = area; bestId = num }
}
if bestId != 0 { print(bestId); exit(0) }
exit(1)
"#;

static T0: OnceLock<Instant> = OnceLock::new();
static FAILURES: AtomicUsize = AtomicUsize::new(0);
/// Observed document titles (label, title), fed by the logger interceptor.
static TITLES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
/// Timestamps of successful `desktop_notify` IPC arrivals — transport-
/// independent proof that a remote invoke passed the capability ACL.
static NOTIFY_CALLS: Mutex<Vec<f64>> = Mutex::new(Vec::new());
/// Payloads (JSON-encoded u32 strings) seen on `server-badge://<id>`
/// events, fed by the app.listen badge listener.
static BADGE_PAYLOADS: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Label strings of every tray menu refresh ("server | ... | Quit
/// LabHub"), fed by the logger interceptor — proves add/remove rebuild
/// the tray menu.
static TRAY_MENUS: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct SmokeLogger;

impl log::Log for SmokeLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }
    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let t0 = T0.get_or_init(Instant::now);
        println!(
            "[t+{:7.3}s] [{}] {}",
            t0.elapsed().as_secs_f64(),
            record.level(),
            record.args()
        );
        // Capture title events for assertions.
        let args = format!("{}", record.args());
        if let Some(rest) = args.strip_prefix("document title [") {
            if let Some((label, title)) = rest.split_once("]: ") {
                TITLES
                    .lock()
                    .unwrap()
                    .push((label.to_string(), title.to_string()));
            }
        }
        if let Some(rest) = args.strip_prefix("desktop_notify ") {
            // "delivered:", "dropped (rate-limited):", "show failed:" — all
            // prove the command actually ran (IPC transport-independent).
            let _ = rest;
            NOTIFY_CALLS
                .lock()
                .unwrap()
                .push(T0.get().map_or(0.0, |t| t.elapsed().as_secs_f64()));
        }
        if let Some(rest) = args.strip_prefix("tray menu refreshed: ") {
            TRAY_MENUS.lock().unwrap().push(rest.to_string());
        }
    }
    fn flush(&self) {}
}

fn log(msg: &str) {
    static LOGGER: SmokeLogger = SmokeLogger;
    LOGGER.log(
        &log::Record::builder()
            .args(format_args!("{msg}"))
            .level(log::Level::Info)
            .build(),
    );
}

fn check(passed: bool, what: &str) {
    if passed {
        log(&format!("PASS {what}"));
    } else {
        FAILURES.fetch_add(1, Ordering::SeqCst);
        log(&format!("FAIL {what}"));
    }
}

fn sleep_until(t0: &Instant, target_secs: f64) {
    let elapsed = t0.elapsed().as_secs_f64();
    if elapsed < target_secs {
        thread::sleep(Duration::from_secs_f64(target_secs - elapsed));
    }
}

fn find_window_id() -> Option<i64> {
    let out = Command::new("swift")
        .arg("/tmp/labhub-smoke-findwin.swift")
        .args(["smoke", "LabHub", "labhub-desktop"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<i64>()
        .ok()
}

fn capture(path: &str) {
    match find_window_id() {
        Some(id) => {
            let st = Command::new("screencapture")
                .args(["-x", "-l", &id.to_string(), path])
                .status();
            log(&format!("SCREENSHOT {path} via window id {id}: {st:?}"));
        }
        None => log(&format!("SCREENSHOT {path} FAILED: no window id found")),
    }
}

/// Evals `js`, waits for the callback, returns its payload string.
/// (Callback errors surface as a payload string too — wry reports eval
/// failures through the same channel.)
fn eval_wait(webview: &Webview, js: &str, timeout_secs: f64) -> Result<String, String> {
    let slot: &'static OnceLock<String> = Box::leak(Box::default());
    webview
        .eval_with_callback(js, move |result| {
            let _ = slot.set(result);
        })
        .map_err(|e| format!("eval dispatch failed: {e}"))?;
    let start = Instant::now();
    loop {
        if let Some(result) = slot.get() {
            return Ok(result.clone());
        }
        if start.elapsed().as_secs_f64() > timeout_secs {
            return Err("eval callback timeout".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
}

const NOTIFY_PROBE: &str = "(function(){window.__SMOKE__={s:'pending'};window.__TAURI__.core.invoke('desktop_notify',{title:'smoke',body:'smoke body'}).then(function(){window.__SMOKE__={s:'ok'}},function(e){window.__SMOKE__={s:'err',e:String(e)}});return 'dispatched'})()";

/// Asserts the notify shim replaced window.Notification on `webview`:
/// typeof check, permission read, and a real construct through the shim
/// class (which bridges to the desktop_notify command). Returns the number
/// of shim checks that passed (of 3).
fn probe_notify_shim(webview: &Webview) -> usize {
    let mut passed = 0;
    match eval_wait(webview, "typeof Notification", 3.0) {
        Ok(p) if p.contains("function") => passed += 1,
        other => log(&format!("shim typeof Notification: {other:?}")),
    }
    match eval_wait(webview, "String(Notification.permission)", 3.0) {
        Ok(p) if p.contains("granted") => passed += 1,
        other => log(&format!("shim Notification.permission: {other:?}")),
    }
    // Construct through the shim (fire-and-forget invoke inside), then
    // exercise the settable-onclick / no-op close contract.
    match eval_wait(
        webview,
        "(function(){try{var n=new Notification('smoke shim title',{body:'smoke shim body'});n.onclick=function(){};n.close();return 'constructed'}catch(e){return 'err:'+String(e)}})()",
        3.0,
    ) {
        Ok(p) if p.contains("constructed") => passed += 1,
        other => log(&format!("shim construct: {other:?}")),
    }
    passed
}

fn notify_call_count() -> usize {
    NOTIFY_CALLS.lock().unwrap().len()
}

/// Probes remote->Rust IPC from `webview`'s origin. Primary signal: the
/// page-side invoke result; fallback: the stub command actually running
/// (works even where eval callbacks are unreliable, e.g. hidden webviews).
fn probe_remote_ipc(webview: &Webview, origin: &str) -> bool {
    let before = notify_call_count();
    if let Err(e) = webview.eval(NOTIFY_PROBE) {
        log(&format!(
            "remote-ipc probe dispatch on {origin} FAILED: {e}"
        ));
        return false;
    }
    for _ in 0..6 {
        thread::sleep(Duration::from_millis(500));
        if let Ok(payload) = eval_wait(webview, "JSON.stringify(window.__SMOKE__)", 2.0) {
            // Payload arrives JSON-encoded a second time by transport.
            let flat = payload.replace('\\', "");
            if flat.contains("\"s\":\"ok\"") {
                return true;
            }
            if flat.contains("\"s\":\"err\"") {
                log(&format!(
                    "remote-ipc invoke on {origin} REJECTED: {payload}"
                ));
                return false;
            }
        }
    }
    let reached_rust = notify_call_count() > before;
    log(&format!(
        "remote-ipc on {origin}: poll inconclusive, invoke reached Rust = {reached_rust}"
    ));
    reached_rust
}

fn timeline(app: tauri::AppHandle) {
    let t0 = Instant::now();
    std::fs::write("/tmp/labhub-smoke-findwin.swift", SWIFT_FINDWIN).ok();
    log("SMOKE timeline start");

    let normalized = normalize_url(LABHUB_URL).expect("normalize labhub url");
    let id = server_id(&normalized);
    let label = format!("srv-{id}");

    // t0.5 — chrome rail exists and loaded.
    sleep_until(&t0, 0.5);
    let labels: Vec<String> = app
        .webviews()
        .values()
        .map(|w| w.label().to_string())
        .collect();
    log(&format!("webview labels at t0.5: {labels:?}"));
    check(
        app.get_webview("chrome").is_some() && app.get_window("main").is_some(),
        "chrome rail webview + main window exist",
    );
    check(
        app.get_webview(&label).is_none(),
        "no content webview before add",
    );

    // Window-state restore: the seeded geometry (1600x1000 physical) was
    // restored when the runtime-created window became ready; the Resized
    // event ran the rail/content relayout off the restored size (see
    // "main window resized: relayout" logs above).
    if let Some(window) = app.get_window("main") {
        let scale = window.scale_factor().unwrap_or(1.0);
        let size = window.inner_size().unwrap_or_default();
        let (w, h) = (size.width as f64 / scale, size.height as f64 / scale);
        let (want_w, want_h) = (1600.0 / scale, 1000.0 / scale);
        log(&format!(
            "window-state restore: {w:.0}x{h:.0} logical (seeded {want_w:.0}x{want_h:.0}, scale {scale})"
        ));
        check(
            (w - want_w).abs() <= want_w * 0.1 && (h - want_h).abs() <= want_h * 0.1,
            "window-state restored seeded size for runtime-created main window",
        );
    }

    // t2.0 — add a server through the real command (health check + save +
    // emit + sync). This is the same path the chrome UI takes.
    sleep_until(&t0, 2.0);
    let state = app.state::<std::sync::Mutex<AppConfig>>();
    let added = tauri::async_runtime::block_on(async {
        commands::add_server(app.clone(), LABHUB_URL.to_string(), state).await
    });
    match &added {
        Ok(server) => log(&format!(
            "add_server ok: id={} name={}",
            server.id, server.name
        )),
        Err(e) => log(&format!("add_server FAILED: {e}")),
    }
    check(added.is_ok(), "add_server succeeded");

    // t3.5 — managed content webview exists and config says active.
    sleep_until(&t0, 3.5);
    let labels: Vec<String> = app
        .webviews()
        .values()
        .map(|w| w.label().to_string())
        .collect();
    log(&format!("webview labels after add: {labels:?}"));
    check(
        app.get_webview(&label).is_some(),
        "content webview created by sync",
    );
    {
        let config = app
            .state::<std::sync::Mutex<AppConfig>>()
            .lock()
            .unwrap()
            .clone();
        check(
            config.active_server.as_deref() == Some(id.as_str()),
            "add_server set new server active",
        );
    }

    // t6.0 — title events should have fired for the content webview.
    sleep_until(&t0, 6.0);
    let titles = TITLES.lock().unwrap().clone();
    let saw_title = titles.iter().any(|(l, _)| l == &label);
    log(&format!("observed titles: {titles:?}"));
    check(saw_title, "document-title event fired for content webview");

    // t6.3 — badge pipeline. The live lab needs a login to have unreads, so
    // drive a title change through note_title — the exact seam the real
    // on_document_title_changed handler calls (push-driven, per the Task 4
    // hidden-webview eval quirk). Listen for the event the rail UI gets.
    sleep_until(&t0, 6.3);
    let badge_listener = app.listen(format!("server-badge://{id}"), |event| {
        BADGE_PAYLOADS
            .lock()
            .unwrap()
            .push(event.payload().to_string());
    });
    log(&format!("badge listener armed for server-badge://{id}"));
    webviews::note_title(&app, &id, "(5) x — LabHub");
    let mut saw_five = false;
    for _ in 0..15 {
        if BADGE_PAYLOADS.lock().unwrap().iter().any(|p| p == "5") {
            saw_five = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    check(saw_five, "server-badge event emitted with payload 5");
    {
        let badges = app.state::<BadgeState>();
        let total = badges.total();
        // The dock badge itself is GUI-only to assert; total is the exact
        // value handed to Window::set_badge_count (logged as
        // "dock badge total: N" by apply_dock_badge).
        log(&format!(
            "badge state after (5): total={total} entries={} (dock target; log-only assert)",
            badges.entry_count()
        ));
        check(total == 5, "badge total = 5 after (5) title");
        check(badges.entry_count() == 1, "badge state tracks one server");
    }

    // t6.6 — reverting to a no-unread title must emit 0 (so the rail hides
    // a stale badge) and drop the entry.
    webviews::note_title(&app, &id, "LabHub");
    let mut saw_zero = false;
    for _ in 0..15 {
        if BADGE_PAYLOADS.lock().unwrap().iter().any(|p| p == "0") {
            saw_zero = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    check(
        saw_zero,
        "server-badge event emitted with payload 0 on title revert",
    );
    check(
        app.state::<BadgeState>().total() == 0,
        "badge total back to 0 after title revert",
    );
    app.unlisten(badge_listener);

    // t7.0 — notify shim + remote-origin IPC from the server origin
    // (capability check). The content webview is the active/visible one,
    // so eval callbacks fire reliably on it (Task 4 hidden-webview quirk).
    sleep_until(&t0, 7.0);
    if let Some(wv) = app.get_webview(&label) {
        check(
            probe_notify_shim(&wv) == 3,
            "notify shim: typeof Notification = function, permission = granted, construct bridges",
        );
        check(
            probe_remote_ipc(&wv, LABHUB_URL),
            "desktop_notify invoke allowed from server origin",
        );
        // Click-routing seam: desktop_notify derives the calling webview's
        // url Rust-side, so the pending click target must be the labhub
        // server id (a toast click itself is GUI-only; this is the state
        // the focus hook consumes).
        let mut target_ok = false;
        for _ in 0..15 {
            if app.state::<NotifyState>().pending_target().as_deref() == Some(id.as_str()) {
                target_ok = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        check(
            target_ok,
            "pending click target = labhub server id after shim notify",
        );
    }

    // t9.0 — screenshot: content only (the rail is auto-hidden at one
    // server, so the capture shows the content webview full-width).
    sleep_until(&t0, 9.0);
    capture("/tmp/labhub-smoke-rail-content.png");

    // t9.4 — tray menu: bootstrap's init refreshed it with the
    // placeholder, add_server's after_mutation hook rebuilt it with the
    // server. The label strings come from the same log the operator sees.
    sleep_until(&t0, 9.4);
    {
        let menus = TRAY_MENUS.lock().unwrap().clone();
        log(&format!("tray menu refreshes so far: {menus:?}"));
        check(
            menus.iter().any(|m| {
                m == "(No servers) | Add server… | Check for Updates | Show LabHub | Quit LabHub"
            }),
            "tray menu refreshed with placeholder at bootstrap",
        );
        check(
            menus.iter().any(|m| {
                let items: Vec<&str> = m.split(" | ").collect();
                items.len() == 5
                    && items[0] != "(No servers)"
                    && items[1..]
                        == [
                            "Add server…",
                            "Check for Updates",
                            "Show LabHub",
                            "Quit LabHub",
                        ]
            }),
            "tray menu rebuilt with 5 items (1 server + 4 fixed) after add",
        );
    }

    // t9.7 — close-to-tray decision + the hidden-window notify show-path.
    // The real CloseRequested needs a GUI click, so the pure decision fn
    // is asserted directly; the notify path is exercised for real: hide
    // the window, seed a pending click target, and consume — which must
    // SHOW the window again (a hidden window never fires Focused).
    sleep_until(&t0, 9.7);
    check(
        commands::set_close_to_tray(app.clone(), app.state(), true).is_ok(),
        "set_close_to_tray(true) command succeeded",
    );
    {
        let config = app
            .state::<std::sync::Mutex<AppConfig>>()
            .lock()
            .unwrap()
            .clone();
        check(
            config.close_to_tray,
            "close_to_tray persisted true in config",
        );
        check(
            tray::close_stays_in_tray("main", config.close_to_tray),
            "close decision: main window stays hidden when close_to_tray on",
        );
        check(
            !tray::close_stays_in_tray("other", config.close_to_tray),
            "close decision: other windows close regardless",
        );
        check(
            tray::build_menu_items(&config).len() == 5,
            "tray build_menu_items: N servers -> N+4 labels",
        );
    }
    if let Some(window) = app.get_window("main") {
        let hid = window.hide().is_ok();
        thread::sleep(Duration::from_millis(300));
        let hidden = hid && !window.is_visible().unwrap_or(true);
        check(hidden, "main window hidden for close-to-tray notify probe");
        app.state::<NotifyState>()
            .set_pending_target(Some(id.clone()));
        notify::consume_pending_click(&app);
        let mut shown = false;
        for _ in 0..15 {
            if window.is_visible().unwrap_or(false) {
                shown = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        check(
            shown,
            "notify click consumption SHOWS a hidden main window (show-if-hidden fix)",
        );
        check(
            app.state::<NotifyState>().pending_target().is_none(),
            "pending click target consumed exactly once",
        );
    }
    // Leave close_to_tray off for the rest of the run.
    let _ = commands::set_close_to_tray(app.clone(), app.state(), false);

    // t10.0 — rail auto-hide (wave 9): with exactly one server the chrome
    // rail must be hidden — reveal flag false and relayout width 0
    // (Webview exposes no is_visible(); the flag + bounds are the
    // API-supported proxies). Then the foreign-origin IPC proof: raw
    // webview (not via manager) on a non-configured origin, testing the
    // labhub-remote https://* pattern.
    sleep_until(&t0, 10.0);
    {
        check(
            !webviews::is_rail_revealed(&app),
            "rail auto-hidden at one server: reveal flag false",
        );
        if let Some(chrome) = app.get_webview("chrome") {
            let scale = app
                .get_window("main")
                .map_or(1.0, |w| w.scale_factor().unwrap_or(1.0));
            match chrome.bounds() {
                Ok(b) => {
                    let size = b.size.to_logical::<f64>(scale);
                    log(&format!(
                        "chrome bounds at 1 server: {size:?} logical (want width 0)"
                    ));
                    check(
                        size.width < 1.0,
                        "rail auto-hidden at one server: chrome width 0",
                    );
                }
                Err(e) => {
                    log(&format!("chrome bounds read failed: {e}"));
                    check(false, "rail auto-hidden: chrome bounds readable");
                }
            }
        }
    }
    let foreign = app.get_window("main").and_then(|window| {
        window
            .add_child(
                WebviewBuilder::new(
                    "smoke-foreign",
                    WebviewUrl::External(EXAMPLE_URL.parse().expect("example url")),
                ),
                tauri::LogicalPosition::new(240.0, 0.0),
                tauri::LogicalSize::new(400.0, 300.0),
            )
            .map_err(|e| log(&format!("foreign webview add failed: {e}")))
            .ok()
    });
    if let Some(wv) = &foreign {
        // Keep it visible: eval callbacks were observed to never fire from
        // hidden webviews (first smoke run), and visibility costs nothing
        // here — it is closed again at t15.
        let _ = wv.show();
    }
    sleep_until(&t0, 13.0);
    if let Some(wv) = &foreign {
        check(
            probe_remote_ipc(wv, EXAMPLE_URL),
            "desktop_notify invoke allowed from foreign origin (https://* pattern)",
        );
    }

    // t15.0 — Webview::close on the foreign webview (API proof).
    sleep_until(&t0, 15.0);
    match foreign.as_ref().map(|wv| wv.close()) {
        Some(Ok(())) => {
            sleep_until(&t0, 16.0);
            check(
                app.get_webview("smoke-foreign").is_none(),
                "Webview::close removed foreign webview",
            );
        }
        other => {
            log(&format!("foreign close: {other:?}"));
            check(false, "Webview::close on foreign webview");
        }
    }

    // t17.0 — remove_server closes the managed webview via sync. Seed an
    // unread first so the badge-clearing side of the removal path is
    // observable (sync must drop the entry and recompute the dock total).
    sleep_until(&t0, 17.0);
    webviews::note_title(&app, &id, "(2) x — LabHub");
    {
        let badges = app.state::<BadgeState>();
        check(badges.total() == 2, "badge total = 2 before remove");
    }
    let removed = commands::remove_server(app.clone(), app.state(), id.clone());
    check(removed.is_ok(), "remove_server succeeded");
    {
        let badges = app.state::<BadgeState>();
        log(&format!(
            "badge state after remove: total={} entries={} (dock target 0)",
            badges.total(),
            badges.entry_count()
        ));
        check(
            badges.total() == 0 && badges.entry_count() == 0,
            "remove_server cleared badge entry and recomputed total",
        );
    }
    sleep_until(&t0, 18.5);
    check(
        app.get_webview(&label).is_none(),
        "sync closed content webview on remove",
    );
    let labels: Vec<String> = app
        .webviews()
        .values()
        .map(|w| w.label().to_string())
        .collect();
    log(&format!("webview labels after remove: {labels:?}"));
    {
        let menus = TRAY_MENUS.lock().unwrap().clone();
        check(
            menus.iter().any(|m| {
                m == "(No servers) | Add server… | Check for Updates | Show LabHub | Quit LabHub"
            }),
            "tray menu rebuilt with placeholder after remove",
        );
    }

    // t19.0 — screenshot: empty rail (zero servers -> the rail is visible
    // again at full width, with the always-present add form).
    // Rail auto-hide counterpart of the t10 check: at zero servers the
    // rail must be back — reveal flag true (re-derived by sync) and the
    // relayout width restored to RAIL_WIDTH.
    sleep_until(&t0, 19.0);
    check(
        webviews::is_rail_revealed(&app),
        "rail visible again at zero servers: flag true",
    );
    if let Some(chrome) = app.get_webview("chrome") {
        let scale = app
            .get_window("main")
            .map_or(1.0, |w| w.scale_factor().unwrap_or(1.0));
        match chrome.bounds() {
            Ok(b) => {
                let size = b.size.to_logical::<f64>(scale);
                log(&format!(
                    "chrome bounds at 0 servers: {size:?} logical (want width {})",
                    webviews::RAIL_WIDTH
                ));
                check(
                    (size.width - webviews::RAIL_WIDTH).abs() < 1.0,
                    "rail visible again at zero servers: chrome width = RAIL_WIDTH",
                );
            }
            Err(e) => {
                log(&format!("chrome bounds read failed: {e}"));
                check(false, "rail visible again: chrome bounds readable");
            }
        }
    }
    capture("/tmp/labhub-smoke-rail-empty.png");

    // t20.0 — opener plugin reachable (compile-time path exists; dry call).
    sleep_until(&t0, 20.0);
    match app
        .opener()
        .open_url("https://labhub.taylabs.org", None::<&str>)
    {
        Ok(()) => log("opener plugin reachable (opened default browser)"),
        Err(e) => log(&format!("opener plugin call failed (non-fatal): {e}")),
    }

    // t20.4 — explicit window-state save (the plugin also saves on
    // RunEvent::Exit; here the save path itself is what is asserted:
    // the file must land next to config.json with a main-window entry).
    sleep_until(&t0, 20.4);
    {
        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
        match app.save_window_state(StateFlags::all()) {
            Ok(()) => {
                let path = labhub_desktop::config::config_path(&app)
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.join(".window-state.json")));
                let raw = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok());
                match (path, raw) {
                    (Some(p), Some(raw)) => {
                        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&raw);
                        let has_main = parsed
                            .ok()
                            .and_then(|v| v.get("main").cloned())
                            .is_some_and(|m| m["width"].as_f64().unwrap_or(0.0) > 0.0);
                        log(&format!(
                            "window-state saved: {} ({} bytes, main entry: {})",
                            p.display(),
                            raw.len(),
                            has_main
                        ));
                        check(has_main, "window-state save wrote a main-window entry");
                    }
                    (Some(_), None) => check(false, "window-state save file readable"),
                    _ => check(false, "window-state path resolvable"),
                }
            }
            Err(e) => {
                log(&format!("window-state save failed: {e}"));
                check(false, "window-state save ok");
            }
        }
    }

    sleep_until(&t0, 21.0);
    let failures = FAILURES.load(Ordering::SeqCst);
    log(&format!(
        "SMOKE timeline end: {}",
        if failures == 0 {
            "ALL PASS".to_string()
        } else {
            format!("{failures} FAILURES")
        }
    ));
    app.exit(if failures == 0 { 0 } else { 1 });
}

fn main() {
    // Sandbox HOME so config save/load hits a throwaway directory instead
    // of the developer's real LabHub desktop config.
    let home = std::env::temp_dir().join("labhub-smoke-home");
    std::fs::create_dir_all(&home).expect("create smoke HOME");
    std::env::set_var("HOME", &home);

    // Seed a saved window state (1600x1000 physical) so the window-state
    // plugin has something to restore for the runtime-created "main"
    // window — asserted at t0.5 (restore -> Resized -> relayout).
    {
        let dir = home.join("Library/Application Support/org.taylabs.labhub-desktop");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(
            dir.join(".window-state.json"),
            r#"{"main":{"width":1600,"height":1000,"x":120,"y":120,"prev_x":0,"prev_y":0,"maximized":false,"visible":true,"decorated":true,"fullscreen":false}}"#,
        );
    }

    log::set_logger(&SmokeLogger).expect("install smoke logger");
    log::set_max_level(log::LevelFilter::Info);
    log(&format!("HOME sandboxed to {}", home.display()));

    tauri::Builder::default()
        .plugin(labhub_desktop::window_state_plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Updater + process plugins registered so bootstrap's updater::init
        // runs against the real plugin state (its registration log line is
        // the Task 8 smoke evidence). No check ever fires here: the
        // background timer (30 s) outlives the ~21 s run and nothing clicks
        // the tray item — zero network.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::set_active,
            commands::get_app_config,
            commands::set_close_to_tray,
            labhub_desktop::notify::desktop_notify,
        ])
        .on_window_event(labhub_desktop::handle_window_event)
        .setup(move |app| {
            if let Ok(path) = labhub_desktop::config::config_path(app.handle()) {
                log(&format!("config path in use: {}", path.display()));
                check(path.starts_with(&home), "config sandboxed under smoke HOME");
            }
            labhub_desktop::bootstrap(app)?;
            let handle = app.handle().clone();
            thread::spawn(move || timeline(handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running smoke application");
}
