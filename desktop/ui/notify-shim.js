// LabHub desktop Notification shim. Injected into every server content
// webview as a Tauri initialization_script, so it runs BEFORE any page
// script (tauri 2.11 prepends its own scripts — including the
// window.__TAURI__ global — ahead of user init scripts, so the global is
// already present when this runs).
//
// App usage contract, verified against the web app source on 2026-08-21:
// - src/components/hooks/use-push-optin.ts:25 gates on `'Notification' in window`
//   before ever touching the API
// - src/components/hooks/use-push-optin.ts:29 reads `Notification.permission === 'granted'`
//   (and only then looks for a push subscription — WKWebView ships no
//   service workers for web content, so the push opt-in stays hidden in the
//   shell and these checks are the whole in-window surface today)
// - public/sw.js:3 calls registration.showNotification — service-worker
//   context, out of this window shim's reach by design
// - the web app NEVER calls `new Notification(...)` or requestPermission;
//   the constructor bridge below is the forward contract for future
//   in-page notification calls. The app enforces its own mute/permission
//   rules BEFORE notifying — the shell just renders what it is given.
//
// Browser harmlessness: if window.__TAURI__ is absent (plain browser), this
// script leaves the native Notification API completely untouched.
(function () {
  'use strict'
  var core
  try {
    core = window.__TAURI__ && window.__TAURI__.core
  } catch (e) {
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
    } catch (e) { /* non-object options keep an empty body */ }
    try {
      window.__TAURI__.core
        .invoke('desktop_notify', {
          title: title == null ? '' : String(title),
          body: body,
        })
        .catch(function (err) {
          console.warn('desktop_notify failed', err)
        })
    } catch (e) {
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
  } catch (e) { /* unreachable on our own class; guard per policy */ }

  // Callback-compatible promise form; always resolves 'granted'.
  ShimNotification.requestPermission = function (callback) {
    try {
      if (typeof callback === 'function') callback('granted')
    } catch (e) { /* a throwing user callback must not break the shim */ }
    return Promise.resolve('granted')
  }

  try {
    Object.defineProperty(window, 'Notification', {
      value: ShimNotification,
      writable: true,
      configurable: true,
    })
  } catch (e) {
    // Never break the page: worst case the native Notification remains.
  }
})()
