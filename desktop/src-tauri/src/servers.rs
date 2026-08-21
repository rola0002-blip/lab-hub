//! Server identity derivation and health probing.

use serde::Deserialize;
use std::time::Duration;
use url::Url;
use uuid::Uuid;

/// Stable server id for a *normalized* URL.
///
/// The id is UUID v5 (DNS namespace) over the name material
/// `labhub-desktop:<url>`. That prefix is part of the scheme: changing it —
/// or the URL normalization rules — re-keys every server id and orphans the
/// stored config entries and per-server session stores. Treat it as frozen.
pub fn server_id(normalized_url: &str) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_DNS,
        format!("labhub-desktop:{normalized_url}").as_bytes(),
    )
    .hyphenated()
    .to_string()
}

/// Result of probing a server's `/api/health`.
#[derive(Debug, Clone, Deserialize)]
pub struct HealthInfo {
    pub version: Option<String>,
}

/// GETs `<url>/api/health` (10 s timeout, at most 3 redirects). A server is
/// healthy iff it answers HTTP 200 with a JSON body where `"ok"` is `true`.
/// All failures map to user-friendly strings.
pub async fn check_health(normalized_url: &str) -> Result<HealthInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("Unreachable: {e}"))?;
    let response = client
        .get(format!("{normalized_url}/api/health"))
        .send()
        .await
        .map_err(|e| format!("Unreachable: {e}"))?;
    if response.status().as_u16() != 200 {
        return Err("Not a LabHub server (no /api/health)".into());
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Not a LabHub server (no /api/health)".to_string())?;
    if body.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err("Server reported unhealthy".into());
    }
    let version = body
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    Ok(HealthInfo { version })
}

/// Default display name for a server: host without `www.` prefix or port.
/// `_health` is reserved for org-name enrichment later.
pub fn default_name(normalized_url: &str, _health: &HealthInfo) -> String {
    match Url::parse(normalized_url).ok().and_then(|u| {
        u.host_str()
            .map(|host| host.strip_prefix("www.").unwrap_or(host).to_string())
    }) {
        Some(name) => name,
        None => normalized_url.to_string(),
    }
}
