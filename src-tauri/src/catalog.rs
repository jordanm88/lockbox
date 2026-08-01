use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

// Point this at a real hosted catalog.json once one exists. Until then this
// resolves to a placeholder .invalid domain, the fetch fails fast, and
// load_catalog() falls back to the bundled resource below — so the App
// Store still works fully offline with the sample entries.
const CATALOG_URL: &str = "https://REPLACE-ME.example.invalid/lockbox/catalog.json";
const CATALOG_FETCH_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalog {
    pub schema_version: u32,
    pub apps: Vec<CatalogApp>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogApp {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// Lets a catalog entry be pulled from installability without deleting
    /// it outright — e.g. a source that's gone dead, or an install method
    /// that turned out to be unreliable. Defaults to true so every existing
    /// entry (and any hand-written one that omits the field) stays
    /// installable exactly as before.
    #[serde(default = "default_active")]
    pub active: bool,
    pub targets: TargetsByOs,
}

fn default_active() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TargetsByOs {
    #[serde(default)]
    pub windows: Option<TargetSpec>,
}

impl TargetsByOs {
    pub fn for_current_os(&self) -> Option<&TargetSpec> {
        self.windows.as_ref()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSpec {
    pub url: String,
    pub archive_type: ArchiveType,
    #[serde(default)]
    pub sha256: Option<String>,
    pub launcher: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum ArchiveType {
    #[serde(rename = "zip")]
    Zip,
    #[serde(rename = "tar.gz")]
    TarGz,
    #[serde(rename = "binary")]
    Binary,
    #[serde(rename = "exe")]
    Exe,
    #[serde(rename = "installer")]
    Installer,
}

pub fn load_catalog(app_handle: &AppHandle) -> Result<AppCatalog, String> {
    if let Ok(catalog) = fetch_remote_catalog() {
        return Ok(catalog);
    }
    load_bundled_catalog(app_handle)
}

fn fetch_remote_catalog() -> Result<AppCatalog, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(CATALOG_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(CATALOG_URL)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    response.json::<AppCatalog>().map_err(|e| e.to_string())
}

fn load_bundled_catalog(app_handle: &AppHandle) -> Result<AppCatalog, String> {
    let resource_result = app_handle
        .path()
        .resolve("catalog.json", tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<AppCatalog>(&bytes).ok());

    if let Some(catalog) = resource_result {
        return Ok(catalog);
    }

    // Dev/runtime fallback: keep a compiled-in copy so the App Store still
    // works even if the packaged resource path is missing or misresolved.
    let embedded = include_str!("../resources/catalog.json");
    serde_json::from_str(embedded).map_err(|e| format!("invalid embedded catalog: {e}"))
}
