// LabHub desktop smoke harness — headless-drivable regression binary.
//
// Drives the real app wiring (bootstrap + commands + webview manager) on a
// timeline, asserts lifecycle behavior, and captures screenshot evidence:
//
//   1. bootstrap with a sandboxed HOME (real config untouched)
//   2. chrome rail webview exists and loads the rail UI
//   3. commands::add_server creates the content webview (label srv-<id>)
//   4. document-title + page-load events fire (via log capture)
//   5. remote-origin IPC: invoke('desktop_notify') resolves from the
//      server origin AND from a foreign origin (proves the labhub-remote
//      capability's https://* pattern)
//   6. Webview::close works (foreign webview) and remove_server closes the
//      managed webview via sync
//   7. CGWindowList screenshot of rail + content and of the empty rail
//
// Run: cargo run --bin smoke (self-exits ~20 s; exit code 0 = all PASS).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use log::Log as _;
use tauri::{Manager, Webview, WebviewBuilder, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

use labhub_desktop::commands;
use labhub_desktop::config::{normalize_url, AppConfig};
use labhub_desktop::servers::server_id;

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
        if args.starts_with("desktop_notify (stub)") {
            NOTIFY_CALLS
                .lock()
                .unwrap()
                .push(T0.get().map_or(0.0, |t| t.elapsed().as_secs_f64()));
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

const NOTIFY_PROBE: &str = "(function(){window.__SMOKE__={s:'pending'};window.__TAURI__.core.invoke('desktop_notify',{title:'smoke'}).then(function(){window.__SMOKE__={s:'ok'}},function(e){window.__SMOKE__={s:'err',e:String(e)}});return 'dispatched'})()";

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

    // t7.0 — remote-origin IPC from the server origin (capability check).
    sleep_until(&t0, 7.0);
    if let Some(wv) = app.get_webview(&label) {
        check(
            probe_remote_ipc(&wv, LABHUB_URL),
            "desktop_notify invoke allowed from server origin",
        );
    }

    // t9.0 — screenshot: rail + content.
    sleep_until(&t0, 9.0);
    capture("/tmp/labhub-smoke-rail-content.png");

    // t10.0 — foreign-origin IPC proof: raw webview (not via manager) on a
    // non-configured origin, testing the labhub-remote https://* pattern.
    sleep_until(&t0, 10.0);
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

    // t17.0 — remove_server closes the managed webview via sync.
    sleep_until(&t0, 17.0);
    let removed = commands::remove_server(app.clone(), app.state(), id.clone());
    check(removed.is_ok(), "remove_server succeeded");
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

    // t19.0 — screenshot: empty rail.
    sleep_until(&t0, 19.0);
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

    log::set_logger(&SmokeLogger).expect("install smoke logger");
    log::set_max_level(log::LevelFilter::Info);
    log(&format!("HOME sandboxed to {}", home.display()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::set_active,
            commands::get_app_config,
            commands::set_close_to_tray,
            commands::desktop_notify,
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
