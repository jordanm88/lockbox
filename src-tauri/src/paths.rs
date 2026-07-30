use std::path::{Component, Path, PathBuf};

/// Joins `relative` onto `base`, rejecting absolute/drive-rooted paths and
/// any `..` component. `relative` comes straight from the frontend over
/// IPC, so without this a caller (buggy or malicious) could use `../../` to
/// write or read outside the Vault directory.
pub fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);

    if relative_path.as_os_str().is_empty() {
        return Err("path must not be empty".to_string());
    }

    for component in relative_path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("invalid path component in '{relative}'")),
        }
    }

    Ok(base.join(relative_path))
}
