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
    pub targets: TargetsByOs,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TargetsByOs {
    #[serde(default)]
    pub windows: Option<TargetSpec>,
    #[serde(default)]
    pub macos: Option<TargetSpec>,
    #[serde(default)]
    pub linux: Option<TargetSpec>,
}

impl TargetsByOs {
    pub fn for_current_os(&self) -> Option<&TargetSpec> {
        if cfg!(target_os = "windows") {
            self.windows.as_ref()
        } else if cfg!(target_os = "macos") {
            self.macos.as_ref()
        } else {
            self.linux.as_ref()
        }
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
    #[serde(rename = "appimage")]
    Appimage,
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
    let path = app_handle
        .path()
        .resolve("catalog.json", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("failed to locate bundled catalog: {e}"))?;
    let bytes =
        std::fs::read(&path).map_err(|e| format!("failed to read bundled catalog: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid bundled catalog: {e}"))
}
