//! Navigation preferences belong to this host, never to the original history writer.
use crate::Store;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Default, Clone, Serialize, Deserialize)]
pub(crate) struct Entry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub hidden: bool,
}
#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Navigation {
    pub projects: BTreeMap<String, Entry>,
    pub sessions: BTreeMap<String, Entry>,
    #[serde(default)]
    pub order_revision: u64,
    #[serde(default)]
    pub project_order: Vec<String>,
    #[serde(default)]
    pub session_order: BTreeMap<String, Vec<String>>,
}

// Replace the submitted subset in place so paging and filtering retain unseen preferences.
pub(crate) fn merge_order(order: &mut Vec<String>, keys: Vec<String>) {
    let visible: std::collections::BTreeSet<_> = keys.iter().cloned().collect();
    let mut reordered = keys.into_iter();
    order.retain_mut(|key| {
        if !visible.contains(key) {
            return true;
        }
        if let Some(next) = reordered.next() {
            *key = next;
            return true;
        }
        false
    });
    order.extend(reordered);
}
pub(crate) fn title(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 160 || value.chars().any(char::is_control) {
        return Err("Use a title of 1–160 bytes without control characters".into());
    }
    Ok(value.into())
}
impl Store {
    pub(crate) fn navigation(&self) -> Result<Navigation, String> {
        let body: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key='sidebar_navigation'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Navigation unavailable")?;
        body.map(|v| serde_json::from_str(&v).map_err(|_| "Navigation is corrupt".into()))
            .unwrap_or_else(|| Ok(Navigation::default()))
    }
    pub(crate) fn save_navigation(&self, value: &Navigation) -> Result<(), String> {
        self.conn.execute("INSERT INTO meta(key,value) VALUES('sidebar_navigation',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(value).map_err(|_| "Cannot encode navigation")?]).map_err(|_| "Cannot save navigation")?;
        Ok(())
    }
    pub(crate) fn navigation_settled(&self, ids: &[String]) -> Result<(), String> {
        if self.ordinary_preparing()? {
            return Err("Wait for session preparation to settle before removing navigation".into());
        }
        if self.all()?.iter().any(|r| {
            ids.contains(&r.session)
                && (r.phase.active()
                    || matches!(
                        r.phase,
                        deck2_shared::Phase::Queued | deck2_shared::Phase::Uncertain
                    ))
        }) || self.tasks()?.iter().any(|t| {
            ids.contains(&t.session)
                && t.attempts.iter().any(|a| {
                    a.phase.active()
                        || matches!(
                            a.phase,
                            deck2_shared::Phase::Queued | deck2_shared::Phase::Uncertain
                        )
                })
        }) {
            return Err(
                "Stop or cancel active work and resolve uncertain ownership before removing it"
                    .into(),
            );
        }
        Ok(())
    }
    pub(crate) fn rename_navigation_session(
        &mut self,
        id: &str,
        value: &str,
    ) -> Result<(), String> {
        let mut session = self.session_by_id(id)?;
        session.title = title(value)?;
        self.save_session(&session)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sidebar_order_preserves_legacy_preferences_and_unloaded_items() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("state.db");
        let store = Store::open(&db, dir.path().to_str().unwrap()).unwrap();
        store
            .conn
            .execute(
                "INSERT INTO meta(key,value) VALUES('sidebar_navigation',?1)",
                [r#"{"projects":{"project":{"title":"Saved name","hidden":true}},"sessions":{}}"#],
            )
            .unwrap();
        let mut navigation = store.navigation().unwrap();
        assert!(navigation.project_order.is_empty());
        assert!(navigation.session_order.is_empty());
        navigation.project_order = vec!["project".into(), "two".into()];
        let existing = navigation
            .session_order
            .entry("project".into())
            .or_default();
        merge_order(
            existing,
            vec!["one".into(), "unloaded".into(), "three".into()],
        );
        merge_order(existing, vec!["three".into(), "one".into(), "new".into()]);
        store.save_navigation(&navigation).unwrap();
        drop(store);
        let store = Store::open(&db, dir.path().to_str().unwrap()).unwrap();
        let navigation = store.navigation().unwrap();
        assert_eq!(navigation.project_order, ["project", "two"]);
        assert_eq!(
            navigation.session_order["project"],
            ["three", "unloaded", "one", "new"]
        );
        assert!(navigation.projects["project"].hidden);
        assert_eq!(
            navigation.projects["project"].title.as_deref(),
            Some("Saved name")
        );
    }

    // Protects durable rename without changing immutable ownership or native context.
    #[test]
    fn sidebar_rename_validates_and_survives_restart() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("state.db");
        let mut s = Store::open(&db, d.path().to_str().unwrap()).unwrap();
        let id = s.session.clone();
        let before = s.session_by_id(&id).unwrap();
        assert!(s.rename_navigation_session(&id, "\n").is_err());
        assert!(
            s.rename_navigation_session(&id, "bad\u{0000}title")
                .is_err()
        );
        s.rename_navigation_session(&id, " Renamed ").unwrap();
        let mut nav = s.navigation().unwrap();
        nav.projects
            .entry(before.project.id.clone())
            .or_default()
            .title = Some("Project title".into());
        s.save_navigation(&nav).unwrap();
        drop(s);
        let s = Store::open(&db, d.path().to_str().unwrap()).unwrap();
        let after = s.session_by_id(&id).unwrap();
        assert_eq!(after.title, "Renamed");
        assert_eq!(after.project, before.project);
        assert_eq!(after.native, before.native);
        assert_eq!(
            s.navigation().unwrap().projects[&before.project.id]
                .title
                .as_deref(),
            Some("Project title")
        );
    }
}
