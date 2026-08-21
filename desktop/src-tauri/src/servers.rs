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

/// 16-byte session-store key for a server id (macOS
/// `data_store_identifier`; spike S2). The id is itself a UUID v5, so this
/// is normally just its bytes; the v5 fallback only guards against a
/// hand-edited config. Frozen alongside `server_id`: changing it orphans
/// every stored session.
pub fn store_key(server_id: &str) -> [u8; 16] {
    match Uuid::parse_str(server_id) {
        Ok(uuid) => *uuid.as_bytes(),
        Err(_) => *Uuid::new_v5(&Uuid::NAMESPACE_DNS, server_id.as_bytes()).as_bytes(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_key_is_16_bytes_and_stable() {
        let url = "https://labhub.taylabs.org";
        let a = store_key(&server_id(url));
        let b = store_key(&server_id(url));
        assert_eq!(a.len(), 16);
        assert_eq!(a, b);
    }

    #[test]
    fn store_key_matches_the_server_id_uuid_bytes() {
        let id = server_id("https://labhub.taylabs.org");
        let uuid = Uuid::parse_str(&id).expect("server id is a uuid");
        assert_eq!(store_key(&id), *uuid.as_bytes());
    }

    #[test]
    fn store_keys_are_distinct_per_server() {
        let a = store_key(&server_id("https://labhub.taylabs.org"));
        let b = store_key(&server_id("https://other.example.org"));
        assert_ne!(a, b);
    }

    #[test]
    fn store_key_falls_back_to_v5_for_non_uuid_ids() {
        let key = store_key("not-a-uuid");
        assert_eq!(key.len(), 16);
        assert_eq!(key, store_key("not-a-uuid"));
    }
}
