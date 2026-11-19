//! Read-only folder suggestions for the project picker.
use axum::{Json, extract::Query, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
pub(crate) struct DirectoryQuery {
    path: Option<String>,
    prefix: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct Folder {
    name: String,
    path: PathBuf,
}

#[derive(Serialize)]
pub(crate) struct Suggestions {
    directories: Vec<Folder>,
    truncated: bool,
}

pub(crate) fn expand(raw: &str, home: &Path) -> PathBuf {
    if raw == "~" {
        return home.to_owned();
    }
    raw.strip_prefix("~/")
        .map_or_else(|| PathBuf::from(raw), |tail| home.join(tail))
}

fn list(home: &Path, query: DirectoryQuery) -> Result<Suggestions, &'static str> {
    let raw = query.path.as_deref().unwrap_or("~/");
    let prefix = query.prefix.as_deref().unwrap_or("");
    let limit = query.limit.unwrap_or(40);
    if raw.len() > 4096
        || prefix.len() > 255
        || prefix.contains(['/', '\\', '\0'])
        || !(1..=100).contains(&limit)
    {
        return Err("Invalid directory query");
    }
    let home = home.canonicalize().map_err(|_| "Home folder unavailable")?;
    let input = expand(raw, &home);
    if !input.is_absolute() {
        return Err("Choose a directory inside your home folder");
    }
    let parent = input.canonicalize().map_err(|_| "Directory unavailable")?;
    if !parent.starts_with(&home) {
        return Err("Choose a directory inside your home folder");
    }
    let entries = parent.read_dir().map_err(|_| "Directory unavailable")?;
    let mut directories = Vec::new();
    let mut truncated = false;
    for (index, entry) in entries.enumerate() {
        if index == 2000 {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if !name.starts_with(prefix)
            || name.starts_with('.') && !prefix.starts_with('.')
            || name.chars().any(char::is_control)
        {
            continue;
        }
        let Ok(path) = entry.path().canonicalize() else {
            continue;
        };
        if !path.starts_with(&home) || !path.is_dir() || path.to_str().is_none() {
            continue;
        }
        if directories.len() == limit {
            truncated = true;
            break;
        }
        directories.push(Folder { name, path });
    }
    directories.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Suggestions {
        directories,
        truncated,
    })
}

pub(crate) async fn suggestions(
    Query(query): Query<DirectoryQuery>,
) -> Result<Json<Suggestions>, (StatusCode, &'static str)> {
    let home = std::env::var_os("HOME")
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Home folder unavailable"))?;
    tokio::task::spawn_blocking(move || list(Path::new(&home), query))
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Directory lookup unavailable",
            )
        })?
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestions_respect_prefix_home_boundary_and_limit() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        std::fs::create_dir(&home).unwrap();
        for name in ["Deck", "Deck Next", ".private"] {
            std::fs::create_dir(home.join(name)).unwrap();
        }
        std::fs::write(home.join("Deck.txt"), "").unwrap();
        std::os::unix::fs::symlink(temp.path(), home.join("escape")).unwrap();
        let lookup = |path: &str, prefix: &str, limit| {
            list(
                &home,
                DirectoryQuery {
                    path: Some(path.into()),
                    prefix: Some(prefix.into()),
                    limit: Some(limit),
                },
            )
        };
        let page = lookup("~/", "", 30).unwrap();
        let names: Vec<_> = page.directories.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["Deck", "Deck Next"]);
        assert!(lookup("~", "Deck", 1).unwrap().truncated);
        assert_eq!(
            lookup("~/", ".", 30).unwrap().directories[0].name,
            ".private"
        );
        assert!(lookup("~/escape", "", 30).is_err());
    }
}
