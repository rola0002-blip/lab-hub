// SP11 architecture spike — throwaway evidence binary. See
// docs/handoffs/2026-08-21-sp11-spike.md for what this proves.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::webview::PageLoadEvent;
use tauri::{
    LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl, Window, WindowEvent,
};

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

fn log(msg: &str) {
    let t0 = T0.get_or_init(Instant::now);
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    println!(
        "[t+{:7.3}s epoch={epoch}] {msg}",
        t0.elapsed().as_secs_f64()
    );
}

fn sleep_until(t0: &Instant, target_secs: f64) {
    let elapsed = t0.elapsed().as_secs_f64();
    if elapsed < target_secs {
        thread::sleep(Duration::from_secs_f64(target_secs - elapsed));
    }
}

fn wait_flag(flag: &AtomicBool, timeout_secs: f64) -> bool {
    let start = Instant::now();
    while !flag.load(Ordering::SeqCst) {
        if start.elapsed().as_secs_f64() > timeout_secs {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
    true
}

fn evalcb(webview: &Webview, js: &str, label: &str) {
    let label = label.to_string();
    let dispatched = label.clone();
    match webview.eval_with_callback(js, move |result| {
        log(&format!("{label} => {result}"));
    }) {
        Ok(()) => log(&format!("{dispatched} (eval dispatched)")),
        Err(e) => log(&format!("{dispatched} (eval dispatch FAILED: {e})")),
    }
}

fn find_window_id() -> Option<i64> {
    let out = Command::new("swift")
        .arg("/tmp/spike-findwin.swift")
        .args(["spike", "LabHub", "labhub-desktop"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    stdout.parse::<i64>().ok()
}

fn capture(window: &Window, path: &str) {
    match find_window_id() {
        Some(id) => {
            let st = Command::new("screencapture")
                .args(["-x", "-l", &id.to_string(), path])
                .status();
            match st {
                Ok(s) if s.success() => log(&format!("SCREENSHOT {path} via window id {id}")),
                s => log(&format!("SCREENSHOT {path} FAILED via -l: {s:?}")),
            }
        }
        None => {
            let scale = window.scale_factor().unwrap_or(2.0);
            match (window.outer_position(), window.outer_size()) {
                (Ok(p), Ok(s)) => {
                    let rect = format!(
                        "{},{},{},{}",
                        (p.x as f64 / scale) as i64,
                        (p.y as f64 / scale) as i64,
                        (s.width as f64 / scale) as i64,
                        (s.height as f64 / scale) as i64
                    );
                    let st = Command::new("screencapture")
                        .args(["-x", "-R", &rect, path])
                        .status();
                    log(&format!("SCREENSHOT {path} via rect {rect}: {st:?}"));
                }
                (p, s) => log(&format!(
                    "SCREENSHOT {path} rect fallback failed: {p:?} {s:?}"
                )),
            }
        }
    }
}

fn log_bounds(label: &str, webview: &Webview, window: &Window) {
    let scale = window.scale_factor().unwrap_or(2.0);
    match webview.bounds() {
        Ok(b) => {
            let p = b.position.to_logical::<f64>(scale);
            let s = b.size.to_logical::<f64>(scale);
            log(&format!(
                "BOUNDS {label}: pos=({:.1},{:.1}) size=({:.1}x{:.1}) logical",
                p.x, p.y, s.width, s.height
            ));
        }
        Err(e) => log(&format!("BOUNDS {label}: ERROR {e}")),
    }
}

#[tauri::command]
fn spike_ping() -> String {
    "pong".into()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![spike_ping])
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::Focused(_)) {
                log(&format!("WINDOW-EVENT {} {:?}", window.label(), event));
            }
        })
        .setup(|app| {
            let window = app
                .get_window("main")
                .expect("config window 'main' to exist");
            window.set_title("SP11 SPIKE")?;

            // S1: the config webview becomes the 240px chrome rail on the left.
            let (win_w, win_h) = {
                let s = window.inner_size()?;
                let scale = window.scale_factor().unwrap_or(2.0);
                (s.width as f64 / scale, s.height as f64 / scale)
            };
            let rail = app.get_webview("main").expect("config webview 'main'");
            rail.set_position(LogicalPosition::new(0.0, 0.0))?;
            rail.set_size(LogicalSize::new(240.0, win_h))?;
            rail.set_auto_resize(true)?;
            log(&format!("S1 rail ready: 240x{win_h:.0} logical, auto_resize on"));

            let content_w = (win_w - 240.0).max(400.0);
            let content_size = LogicalSize::new(content_w, win_h);
            let content_pos = LogicalPosition::new(240.0, 0.0);

            // S3 + S4 webview: labhub sign-in, visible.
            let labhub_loaded = Arc::new(AtomicBool::new(false));
            let lh = labhub_loaded.clone();
            let labhub = window.add_child(
                WebviewBuilder::new(
                    "labhub",
                    WebviewUrl::External(LABHUB_URL.parse().expect("labhub url")),
                )
                .initialization_script("window.__SPIKE_MARK = (window.__SPIKE_MARK||0) + 1;")
                .on_document_title_changed(|wv, title| {
                    log(&format!("S3 TITLE webview={} title={title:?}", wv.label()));
                })
                .on_page_load(move |wv, payload| {
                    log(&format!(
                        "PAGE-LOAD {} {:?} {}",
                        wv.label(),
                        payload.event(),
                        payload.url()
                    ));
                    if payload.event() == PageLoadEvent::Finished {
                        lh.store(true, Ordering::SeqCst);
                    }
                })
                .auto_resize(),
                content_pos,
                content_size,
            )?;
            log("S1 labhub webview added (initialization_script + title handler + auto_resize)");

            // S1 toggle target: example.org, hidden until t+11s.
            let example = window.add_child(
                WebviewBuilder::new(
                    "example",
                    WebviewUrl::External(EXAMPLE_URL.parse().expect("example url")),
                )
                .on_page_load(|wv, payload| {
                    log(&format!(
                        "PAGE-LOAD {} {:?} {}",
                        wv.label(),
                        payload.event(),
                        payload.url()
                    ));
                })
                .auto_resize(),
                content_pos,
                content_size,
            )?;
            example.hide()?;
            log("S1 example.org webview added (hidden)");

            // S2: two labhub webviews with isolated data stores, both hidden.
            let mut s2_loaded = Vec::new();
            let mut s2_webviews = Vec::new();
            for (name, store) in [("s2a", [0x11u8; 16]), ("s2b", [0x22u8; 16])] {
                let flag = Arc::new(AtomicBool::new(false));
                let f = flag.clone();
                let wv = window.add_child(
                    WebviewBuilder::new(
                        name,
                        WebviewUrl::External(LABHUB_URL.parse().expect("labhub url")),
                    )
                    .data_store_identifier(store)
                    .on_page_load(move |wv, payload| {
                        log(&format!(
                            "PAGE-LOAD {} {:?} {}",
                            wv.label(),
                            payload.event(),
                            payload.url()
                        ));
                        if payload.event() == PageLoadEvent::Finished {
                            f.store(true, Ordering::SeqCst);
                        }
                    }),
                    content_pos,
                    content_size,
                )?;
                wv.hide()?;
                s2_loaded.push(flag);
                s2_webviews.push(wv);
                log(&format!("S2 {name} added with data_store_identifier {store:02x?} (hidden)"));
            }
                let s2a = s2_webviews[0].clone();
            let s2b = s2_webviews[1].clone();

            let app_handle = app.handle().clone();
            thread::spawn(move || {
                let t0 = Instant::now();
                std::fs::write("/tmp/spike-findwin.swift", SWIFT_FINDWIN).ok();
                log("SP11 SPIKE timeline start");

                let loaded = wait_flag(&labhub_loaded, 10.0);
                log(&format!("labhub load finished by wait: {loaded}"));
                let a_loaded = wait_flag(&s2_loaded[0], 10.0);
                let b_loaded = wait_flag(&s2_loaded[1], 10.0);
                log(&format!("s2a/s2b load finished by wait: {a_loaded}/{b_loaded}"));

                // t2.0 — S5 precondition: is __TAURI__ injected on the remote page?
                sleep_until(&t0, 2.0);
                evalcb(
                    &labhub,
                    "typeof window.__TAURI__",
                    "S5 typeof window.__TAURI__",
                );

                // t3.0 — S4: init script ran exactly once?
                sleep_until(&t0, 3.0);
                evalcb(
                    &labhub,
                    "String(window.__SPIKE_MARK)",
                    "S4 window.__SPIKE_MARK",
                );

                // t3.5 / t4.5 — S2: marker set in A, read from A and B.
                sleep_until(&t0, 3.5);
                match s2a.eval("localStorage.setItem('spike','A'); 'marker-set'") {
                    Ok(()) => log("S2 marker set in s2a via localStorage"),
                    Err(e) => log(&format!("S2 marker set FAILED: {e}")),
                }
                sleep_until(&t0, 4.5);
                evalcb(
                    &s2a,
                    "JSON.stringify({cookie: document.cookie, lsLen: localStorage.length, marker: localStorage.getItem('spike')})",
                    "S2 webview A read",
                );
                evalcb(
                    &s2b,
                    "JSON.stringify({cookie: document.cookie, lsLen: localStorage.length, marker: localStorage.getItem('spike')})",
                    "S2 webview B read",
                );

                // t5.0 — S1 evidence: labhub sign-in visible.
                sleep_until(&t0, 5.0);
                capture(&window, "/tmp/spike-t5-labhub.png");

                // t5.5+ — S5: invoke from remote origin, poll result.
                sleep_until(&t0, 5.5);
                evalcb(
                    &labhub,
                    "(function(){ return typeof window.__TAURI__ !== 'undefined' ? String(typeof window.__TAURI__.core.invoke) : 'no-global'; })()",
                    "S5 invoke type",
                );
                match labhub.eval(
                    "window.__S5__={state:'pending'}; window.__TAURI__.core.invoke('spike_ping').then(function(r){window.__S5__={state:'resolved',value:String(r)}},function(e){window.__S5__={state:'rejected',error:String(e)}}); 'invoke-dispatched'",
                ) {
                    Ok(()) => log("S5 invoke dispatched"),
                    Err(e) => log(&format!("S5 invoke dispatch FAILED: {e}")),
                }
                for t in [7.0, 8.5, 10.0] {
                    sleep_until(&t0, t);
                    evalcb(&labhub, "JSON.stringify(window.__S5__)", "S5 result poll");
                }

                // t11.0 — S1 toggle: hide labhub, show example.org.
                sleep_until(&t0, 11.0);
                if let Err(e) = labhub.hide() {
                    log(&format!("S1 hide labhub FAILED: {e}"));
                }
                if let Err(e) = example.show() {
                    log(&format!("S1 show example FAILED: {e}"));
                }
                log("S1 toggled: labhub hidden, example.org shown");

                // t12.0 — S1 evidence: example.org visible.
                sleep_until(&t0, 12.0);
                capture(&window, "/tmp/spike-t12-example.png");

                // t12.5 — S1 auto_resize: programmatic resize, no panics.
                sleep_until(&t0, 12.5);
                match window.set_size(LogicalSize::new(1400.0, 900.0)) {
                    Ok(()) => log("S1 resized window to 1400x900 logical"),
                    Err(e) => log(&format!("S1 resize FAILED: {e}")),
                }
                sleep_until(&t0, 13.5);
                log_bounds("rail", &rail, &window);
                log_bounds("labhub", &labhub, &window);
                log_bounds("example", &example, &window);

                sleep_until(&t0, 14.5);
                log("SP11 SPIKE timeline end");
                app_handle.exit(0);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running spike application");
}
