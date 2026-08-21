//! Server identity derivation and health probing.

use crate::config::AppConfig;
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

/// Origin equality (scheme + host + port-or-known-default). The single
/// definition shared by the content-webview navigation guard
/// (`webviews.rs`) and [`server_for_url`], so "same site" can never mean
/// two different things on two code paths.
pub fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Finds the id of the configured server whose origin (scheme+host+port)
/// matches `url`'s, ignoring path/query/fragment. `desktop_notify` uses
/// this to route a notification click back to the server whose page raised
/// it — the shim always passes `location.origin`. `None` when the URL is
/// unparseable or belongs to no configured server (foreign page): the
/// notification still shows, it just has no switch target.
pub fn server_for_url(config: &AppConfig, url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    config.servers.iter().find_map(|server| {
        let server_url = Url::parse(&server.url).ok()?;
        same_origin(&parsed, &server_url).then(|| server.id.clone())
    })
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

    // --- server_for_url (notification click routing) ---

    fn config_with(urls: &[&str]) -> AppConfig {
        AppConfig {
            servers: urls
                .iter()
                .map(|&u| crate::config::ServerConfig {
                    id: server_id(u),
                    name: String::new(),
                    url: u.to_string(),
                })
                .collect(),
            active_server: None,
            close_to_tray: false,
        }
    }

    fn id_of(url: &str) -> String {
        server_id(url)
    }

    #[test]
    fn server_for_url_matches_exact_origin() {
        let config = config_with(&["https://lab.example.com"]);
        assert_eq!(
            server_for_url(&config, "https://lab.example.com"),
            Some(id_of("https://lab.example.com"))
        );
    }

    /// The shim passes `location.origin`, but any URL form must resolve —
    /// only the origin participates.
    #[test]
    fn server_for_url_ignores_path_query_and_fragment() {
        let config = config_with(&["https://lab.example.com"]);
        assert_eq!(
            server_for_url(&config, "https://lab.example.com/chat/room-7?x=1#unread"),
            Some(id_of("https://lab.example.com"))
        );
    }

    #[test]
    fn server_for_url_equates_default_ports() {
        let config = config_with(&["https://lab.example.com"]);
        assert_eq!(
            server_for_url(&config, "https://lab.example.com:443"),
            Some(id_of("https://lab.example.com"))
        );
        let config = config_with(&["http://lab.example.com"]);
        assert_eq!(
            server_for_url(&config, "http://lab.example.com:80/x"),
            Some(id_of("http://lab.example.com"))
        );
    }

    #[test]
    fn server_for_url_matches_non_default_ports_only_exactly() {
        let config = config_with(&["http://localhost:3000"]);
        assert_eq!(
            server_for_url(&config, "http://localhost:3000/app"),
            Some(id_of("http://localhost:3000"))
        );
        assert_eq!(server_for_url(&config, "http://localhost:9090"), None);
        // No port means the known default (80), not the configured 3000.
        assert_eq!(server_for_url(&config, "http://localhost"), None);
    }

    #[test]
    fn server_for_url_requires_scheme_match() {
        let config = config_with(&["https://localhost"]);
        assert_eq!(server_for_url(&config, "http://localhost"), None);
        assert_eq!(server_for_url(&config, "ftp://localhost"), None);
    }

    #[test]
    fn server_for_url_host_must_match_exactly() {
        let config = config_with(&["https://lab.example.com"]);
        // Classic suffix tricks are different hosts.
        assert_eq!(
            server_for_url(&config, "https://lab.example.com.evil.org"),
            None
        );
        assert_eq!(server_for_url(&config, "https://notlab.example.com"), None);
        assert_eq!(server_for_url(&config, "https://example.com"), None);
    }

    /// Url::parse lowercases hosts, matching normalize_url's lowercasing.
    #[test]
    fn server_for_url_is_host_case_insensitive() {
        let config = config_with(&["https://lab.example.com"]);
        assert_eq!(
            server_for_url(&config, "https://LAB.Example.COM/chat"),
            Some(id_of("https://lab.example.com"))
        );
    }

    #[test]
    fn server_for_url_returns_none_for_empty_or_foreign_config() {
        let empty = AppConfig::default();
        assert_eq!(server_for_url(&empty, "https://lab.example.com"), None);
        let other = config_with(&["https://other.example.org"]);
        assert_eq!(server_for_url(&other, "https://lab.example.com"), None);
    }

    #[test]
    fn server_for_url_returns_none_for_unparseable_urls() {
        let config = config_with(&["https://lab.example.com"]);
        assert_eq!(server_for_url(&config, ""), None);
        assert_eq!(server_for_url(&config, "not a url"), None);
        assert_eq!(server_for_url(&config, "https://"), None);
    }

    /// Defensive: duplicate origins cannot occur via commands (server_id
    /// dedupes), but a hand-edited config must still resolve deterministically.
    #[test]
    fn server_for_url_first_match_wins_on_duplicate_origins() {
        let first = id_of("https://lab.example.com");
        let second = "00000000-0000-0000-0000-000000000000".to_string();
        let config = AppConfig {
            servers: vec![
                crate::config::ServerConfig {
                    id: first.clone(),
                    name: String::new(),
                    url: "https://lab.example.com".into(),
                },
                crate::config::ServerConfig {
                    id: second,
                    name: String::new(),
                    url: "https://lab.example.com".into(),
                },
            ],
            active_server: None,
            close_to_tray: false,
        };
        assert_eq!(
            server_for_url(&config, "https://lab.example.com"),
            Some(first)
        );
    }

    /// The click router must find the RIGHT server among several.
    #[test]
    fn server_for_url_disambiguates_multiple_servers() {
        let config = config_with(&["https://a.example.org", "https://b.example.org"]);
        assert_eq!(
            server_for_url(&config, "https://b.example.org/x"),
            Some(id_of("https://b.example.org"))
        );
    }

    // --- same_origin (shared with the navigation guard) ---

    #[test]
    fn same_origin_default_port_equivalents() {
        assert!(same_origin(
            &"https://a.example.org".parse().unwrap(),
            &"https://a.example.org:443".parse().unwrap()
        ));
        assert!(!same_origin(
            &"https://a.example.org".parse().unwrap(),
            &"https://a.example.org:8443".parse().unwrap()
        ));
    }

    #[test]
    fn same_origin_rejects_host_and_scheme_drift() {
        assert!(!same_origin(
            &"https://a.example.org".parse().unwrap(),
            &"https://b.example.org".parse().unwrap()
        ));
        assert!(!same_origin(
            &"https://a.example.org".parse().unwrap(),
            &"http://a.example.org".parse().unwrap()
        ));
    }
}
