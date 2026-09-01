use labhub_desktop::config::{normalize_url, parse_or_default, AppConfig, ServerConfig};
use labhub_desktop::servers::{default_name, server_id, HealthInfo};
use uuid::Uuid;

fn ok(input: &str) -> String {
    normalize_url(input).unwrap_or_else(|e| panic!("normalize_url({input:?}) failed: {e}"))
}

#[test]
fn url_normalization_matrix() {
    assert_eq!(ok("https://lab.example.com/"), "https://lab.example.com");
    assert_eq!(
        ok("https://lab.example.com/sign-in"),
        "https://lab.example.com"
    );
    assert_eq!(
        ok("https://lab.example.com/?x=1"),
        "https://lab.example.com"
    );
    assert_eq!(
        ok("https://lab.example.com/#/dashboard"),
        "https://lab.example.com"
    );
    assert_eq!(
        ok("https://LAB.Example.COM/Path"),
        "https://lab.example.com"
    );
    assert_eq!(ok("HTTPS://Lab.Example.COM"), "https://lab.example.com");
    assert_eq!(ok("lab.example.com"), "https://lab.example.com");
    assert_eq!(ok("lab.example.com:8443"), "https://lab.example.com:8443");
    assert_eq!(
        ok("https://lab.example.com:8443/sign-in?x=1#f"),
        "https://lab.example.com:8443"
    );
    assert_eq!(ok("http://lab.example.com"), "http://lab.example.com");
    assert_eq!(ok("  https://lab.example.com  "), "https://lab.example.com");
    assert_eq!(ok("https://lab.example.com:443"), "https://lab.example.com");
}

#[test]
fn url_normalization_is_idempotent() {
    for input in [
        "https://lab.example.com/",
        "lab.example.com:8443",
        "HTTP://Lab.Example.COM/x",
        "https://[::1]:8080/base",
    ] {
        let once = ok(input);
        assert_eq!(ok(&once), once, "re-normalizing {input:?}");
    }
}

#[test]
fn url_normalization_rejects_bad_input() {
    assert!(normalize_url("").is_err());
    assert!(normalize_url("   ").is_err());
    assert!(normalize_url("ftp://example.com").is_err());
    assert!(normalize_url("https://").is_err());
    assert!(normalize_url("not a url").is_err());
}

#[test]
fn app_config_serde_round_trip() {
    let id = server_id("https://lab.example.com");
    let config = AppConfig {
        servers: vec![ServerConfig {
            id: id.clone(),
            name: "lab".into(),
            url: "https://lab.example.com".into(),
        }],
        active_server: Some(id),
        close_to_tray: true,
    };
    let json = serde_json::to_string(&config).expect("serialize");
    let back: AppConfig = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(config, back);
}

#[test]
fn app_config_missing_fields_default() {
    let config: AppConfig = serde_json::from_str("{}").expect("empty object");
    assert_eq!(config, AppConfig::default());
    assert!(config.servers.is_empty());
    assert!(config.active_server.is_none());
    assert!(config.close_to_tray);

    let config: AppConfig = serde_json::from_str(r#"{"servers": []}"#).expect("servers only");
    assert_eq!(config, AppConfig::default());
}

#[test]
fn corrupt_json_yields_default() {
    assert_eq!(parse_or_default("{ not json"), AppConfig::default());
    assert_eq!(parse_or_default(""), AppConfig::default());
    assert_eq!(parse_or_default(r#"{"servers": 42}"#), AppConfig::default());
}

#[test]
fn server_ids_are_stable_and_distinct() {
    assert_eq!(
        server_id("https://lab.example.com"),
        server_id("https://lab.example.com")
    );
    assert_ne!(
        server_id("https://lab.example.com"),
        server_id("https://other.example.com")
    );
    // URL normalization composes: variant spellings of one host share one id.
    assert_eq!(
        server_id(&ok("https://LAB.example.com/sign-in")),
        server_id(&ok("lab.example.com"))
    );
}

#[test]
fn server_ids_are_hyphenated_v5_uuids() {
    let id = server_id("https://lab.example.com");
    let parsed = Uuid::parse_str(&id).expect("parses as uuid");
    assert_eq!(parsed.hyphenated().to_string(), id);
    assert_eq!(parsed.get_version_num(), 5);
    assert_eq!(id.len(), 36);
}

#[test]
fn default_name_strips_www_and_port() {
    let health = HealthInfo {
        version: Some("1.2.3".into()),
    };
    assert_eq!(
        default_name("https://lab.example.com", &health),
        "lab.example.com"
    );
    assert_eq!(
        default_name("https://www.example.com", &health),
        "example.com"
    );
    assert_eq!(
        default_name("https://lab.example.com:8443", &health),
        "lab.example.com"
    );
    assert_eq!(default_name("http://localhost:3000", &health), "localhost");
    assert_eq!(
        default_name("https://lab.example.com", &HealthInfo { version: None }),
        "lab.example.com"
    );
}

// 2026-09 notifications: the shipped default keeps the app in the tray on
// close — quitting is the only way to lose desktop alerts. An explicit
// false in config.json still wins.
#[test]
fn default_config_has_close_to_tray_on() {
    assert!(AppConfig::default().close_to_tray);
}

#[test]
fn config_missing_close_to_tray_field_parses_to_on() {
    let c = parse_or_default(r#"{"servers":[]}"#);
    assert!(c.close_to_tray);
}

#[test]
fn config_explicit_close_to_tray_false_is_preserved() {
    let c = parse_or_default(r#"{"servers":[],"close_to_tray":false}"#);
    assert!(!c.close_to_tray);
}
