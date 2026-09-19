// LabHub desktop Notification shim. Injected into every server content
// webview as a Tauri initialization_script, so it runs BEFORE any page
// script (tauri 2.11 prepends its own scripts — including the
// window.__TAURI__ global — ahead of user init scripts, so the global is
// already present when this runs).
//
// App usage contract, verified against the web app source on 2026-09-20:
// - src/components/hooks/use-notification-state.ts gates on
//   `'Notification' in window` before ever touching the API and reads
//   `Notification.permission === 'granted'`
//   (and only then looks for a push subscription — WKWebView ships no
//   service workers for web content, so the push opt-in stays hidden in the
//   shell and these checks are the whole in-window surface today)
// - src/lib/push-subscribe.ts owns the subscribe flow
// - public/sw.js:36 calls registration.showNotification — service-worker
//   context, out of this window shim's reach by design
// - the popup arm (v0.32 Tasks 8-9) made the constructor bridge load-bearing:
//   src/components/bell.tsx's alert funnel calls
//   `new Notification(title, { body, tag, silent })` — the in-shell toast arm
//   (silent carries the per-device sound toggle) and the browser popup arm
//   (always silent; the WebAudio chime is the sound there). Both set
//   `t.onclick` for click-to-navigate; the shim keeps ignoring it — the shell
//   owns click routing (focus + switch, derived Rust-side from the calling
//   webview). notification-wizard.tsx (Browser popups step, plus its preview
//   `new Notification` demo) and popup-toggle.tsx call
//   `Notification.requestPermission()`, which the shim's static 'granted'
//   below satisfies. The app still enforces its own mute/permission rules
//   BEFORE notifying — the shell just renders what it is given.
// - options.silent (optional, default false) maps to the shell's ToastSound:
//   absent/false -> OS default sound; true -> silent toast (downloads).
//
// Browser harmlessness: if window.__TAURI__ is absent (plain browser), this
// script leaves the native Notification API completely untouched.
(function () {
  'use strict'
  var core
  try {
    core = window.__TAURI__ && window.__TAURI__.core
  } catch (_e) {
    return // no Tauri IPC reachable: leave Notification native
  }
  if (!core || typeof core.invoke !== 'function') return

  function ShimNotification(title, options) {
    // Nothing user-visible is captured in-page; the shell owns rendering,
    // rate limiting, and click routing (the origin is derived Rust-side
    // from the calling webview — never sent from the page). Invoke is
    // resolved lazily so a page that grabs the constructor early still
    // bridges correctly. A missing title defaults to '' (never the string
    // "undefined").
    var body = ''
    try {
      body = options && options.body != null ? String(options.body) : ''
    } catch (_e) { /* non-object options keep an empty body */ }
    var silent = false
    try {
      silent = !!(options && options.silent)
    } catch (_e) { /* non-object options keep sound on */ }
    try {
      window.__TAURI__.core
        .invoke('desktop_notify', {
          title: title == null ? '' : String(title),
          body: body,
          silent: silent,
        })
        .catch(function (err) {
          console.warn('desktop_notify failed', err)
        })
    } catch (_e) {
      console.warn('desktop_notify dispatch failed', e)
    }
    // Click handling belongs to the shell (focus + switch to the notifying
    // server); onclick stays settable but is ignored, close() is a no-op.
    this.onclick = null
    this.close = function () {}
  }

  // Static permission -> 'granted': the shell IS the permission grant —
  // the app only notifies when its own rules allow (see contract above).
  try {
    Object.defineProperty(ShimNotification, 'permission', {
      get: function () {
        return 'granted'
      },
      configurable: false,
      enumerable: true,
    })
  } catch (_e) { /* unreachable on our own class; guard per policy */ }

  // Callback-compatible promise form; always resolves 'granted'.
  ShimNotification.requestPermission = function (callback) {
    try {
      if (typeof callback === 'function') callback('granted')
    } catch (_e) { /* a throwing user callback must not break the shim */ }
    return Promise.resolve('granted')
  }

  try {
    Object.defineProperty(window, 'Notification', {
      value: ShimNotification,
      writable: true,
      configurable: true,
    })
  } catch (_e) {
    // Never break the page: worst case the native Notification remains.
  }
})()
