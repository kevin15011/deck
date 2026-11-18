//! Durable workspace projects. Selection never participates in execution lookup.
use crate::Store;
use deck2_shared::ProjectBinding;
use rusqlite::{Connection, params};
use std::{os::unix::fs::MetadataExt, path::Path};

pub fn id(root: &str) -> String {
    format!("project-{}", &crate::tasks::digest(root.as_bytes())[..24])
}
pub(crate) fn identity(root: &str) -> Result<String, String> {
    let path = Path::new(root);
    let canonical = path
        .canonicalize()
        .map_err(|_| "Recorded project is unavailable")?;
    if canonical != path || !path.is_absolute() || !canonical.is_dir() {
        return Err("Recorded project root was replaced or is not canonical".into());
    }
    let m = std::fs::symlink_metadata(path).map_err(|_| "Project identity unavailable")?;
    Ok(format!("{}:{}", m.dev(), m.ino()))
}
pub fn available(root: &str) -> Result<(), String> {
    identity(root).map(|_| ())
}
pub fn validate(p: &ProjectBinding) -> Result<(), String> {
    if p.id != id(&p.root) || p.identity.as_ref() != Some(&identity(&p.root)?) {
        return Err("Recorded project identity changed; execution withheld".into());
    }
    Ok(())
}
impl Store {
    pub(crate) fn init_projects(&mut self, schema: &str) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL, trusted INTEGER NOT NULL CHECK(trusted IN (0,1))); ").map_err(|_| "Cannot migrate projects")?;
        if !["15", "16", "17", "18"].contains(&schema) {
            let p = ProjectBinding {
                id: id(&self.project),
                root: self.project.clone(),
                identity: identity(&self.project).ok(),
            };
            let trust = self.trusted()?;
            self.conn
                .execute(
                    "INSERT INTO projects VALUES(?1,?2,?3)",
                    params![p.id, serde_json::to_string(&p).unwrap(), trust],
                )
                .map_err(|_| "Cannot bind recorded project")?;
            for mut session in self.sessions()? {
                if !session.project.id.is_empty() {
                    return Err("Unexpected legacy project binding".into());
                }
                session.project = p.clone();
                self.conn
                    .execute(
                        "UPDATE sessions SET body=?1 WHERE id=?2",
                        params![serde_json::to_string(&session).unwrap(), session.id],
                    )
                    .map_err(|_| "Cannot migrate session project")?;
            }
            for mut r in self.all()? {
                if let Some(s) = &mut r.configuration {
                    s.project = p.clone();
                }
                self.conn
                    .execute(
                        "UPDATE receipts SET body=?1 WHERE id=?2",
                        params![serde_json::to_string(&r).unwrap(), r.id],
                    )
                    .map_err(|_| "Cannot migrate admission project")?;
            }
            for mut t in self.tasks()? {
                for a in &mut t.attempts {
                    if let Some(s) = &mut a.configuration {
                        s.project = p.clone();
                    }
                }
                self.save_task(&t)?;
            }
            // Other durable snapshots also inherit the recorded origin, never startup selection.
            self.conn.execute("UPDATE session_selections SET body=json_set(body,'$.snapshot.project',json(?1))", [serde_json::to_string(&p).unwrap()]).map_err(|_| "Cannot migrate selections")?;
        }
        Ok(())
    }
    pub fn project_by_id(&self, id: &str) -> Result<ProjectBinding, String> {
        let body: String = self
            .conn
            .query_row("SELECT body FROM projects WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "Unknown registered project")?;
        let p: ProjectBinding =
            serde_json::from_str(&body).map_err(|_| "Corrupt project binding")?;
        if p.id != id || p.id != crate::projects::id(&p.root) {
            return Err("Invalid project binding".into());
        }
        Ok(p)
    }
    pub fn projects(&self) -> Result<Vec<ProjectBinding>, String> {
        let mut q = self
            .conn
            .prepare("SELECT id FROM projects ORDER BY rowid")
            .map_err(|_| "Projects unavailable")?;
        q.query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "Projects unavailable")?
            .map(|r| self.project_by_id(&r.map_err(|_| "Project unavailable")?))
            .collect()
    }
    pub fn session_project(&self, session: &str) -> Result<ProjectBinding, String> {
        let s = self.session_by_id(session)?;
        if self.project_by_id(&s.project.id)? != s.project {
            return Err("Session project binding changed".into());
        }
        Ok(s.project)
    }
    pub fn execution_project(&self, session: &str) -> Result<ProjectBinding, String> {
        let p = self.session_project(session)?;
        validate(&p)?;
        Ok(p)
    }
    pub fn register_project(&mut self, root: &str) -> Result<ProjectBinding, String> {
        if root.len() > 4096 || root.chars().any(char::is_control) {
            return Err("Invalid project path".into());
        }
        let p = ProjectBinding {
            id: id(root),
            root: root.into(),
            identity: Some(identity(root)?),
        };
        if let Ok(old) = self.project_by_id(&p.id) {
            if old != p {
                return Err("Recorded project identity changed".into());
            }
            return Ok(old);
        }
        let mut c = self.configuration()?;
        c.project = root.into();
        c.cbm = None;
        c.team_enabled = true;
        c.investigator = None;
        c.revision = self.next_configuration_revision()?;
        let tx = self
            .conn
            .transaction()
            .map_err(|_| "Cannot register project")?;
        tx.execute(
            "INSERT INTO projects VALUES(?1,?2,0)",
            params![p.id, serde_json::to_string(&p).unwrap()],
        )
        .map_err(|_| "Cannot register project")?;
        tx.execute(
            "INSERT INTO configurations VALUES(?1,?2)",
            params![c.revision, serde_json::to_string(&c).unwrap()],
        )
        .map_err(|_| "Cannot register project configuration")?;
        tx.commit()
            .map_err(|_| "Cannot commit project registration")?;
        Ok(p)
    }
    pub(crate) fn next_configuration_revision(&self) -> Result<u64, String> {
        self.conn
            .query_row(
                "SELECT COALESCE(MAX(revision),0)+1 FROM configurations",
                [],
                |r| r.get(0),
            )
            .map_err(|_| "Configuration revision unavailable".into())
    }
    pub fn trusted_project(&self, project: &str) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT trusted FROM projects WHERE id=?1",
                [id(project)],
                |r| r.get(0),
            )
            .map_err(|_| "Project trust unavailable".into())
    }
}
pub(crate) fn inspect(conn: &Connection) -> Result<(), String> {
    let read = |id: &str| -> Result<ProjectBinding, String> {
        let b: String = conn
            .query_row("SELECT body FROM projects WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "Missing project binding")?;
        serde_json::from_str(&b).map_err(|_| "Corrupt project binding".into())
    };
    let mut q = conn
        .prepare("SELECT body FROM sessions")
        .map_err(|_| "Sessions unavailable")?;
    let mut sessions = std::collections::HashMap::new();
    for b in q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "Sessions unavailable")?
    {
        let s: deck2_shared::Session = serde_json::from_str(&b.map_err(|_| "Session unavailable")?)
            .map_err(|_| "Invalid session")?;
        if s.project.id != id(&s.project.root) || read(&s.project.id)? != s.project {
            return Err("Invalid immutable session project".into());
        }
        sessions.insert(s.id, s.project);
    }
    let mut q = conn
        .prepare("SELECT body FROM receipts")
        .map_err(|_| "Receipts unavailable")?;
    for b in q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "Receipts unavailable")?
    {
        let r: deck2_shared::Receipt = serde_json::from_str(&b.map_err(|_| "Receipt unavailable")?)
            .map_err(|_| "Invalid receipt")?;
        if r.configuration
            .as_ref()
            .is_some_and(|c| Some(&c.project) != sessions.get(&r.session))
        {
            return Err("Admission project differs from session".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use deck2_shared::{API, Mode, ScopedSubmit, SessionCommand};
    fn create(s: &mut Store, p: &ProjectBinding, id: &str) -> deck2_shared::Session {
        s.create_session(&SessionCommand {
            project_id: Some(p.id.clone()),
            members: None,
            approvals: None,
            api: API,
            id: id.into(),
            title: id.into(),
        })
        .unwrap()
    }
    fn command(session: &str, id: &str) -> ScopedSubmit {
        ScopedSubmit {
            attachments: vec![],
            api: API,
            id: id.into(),
            prompt: "Fresh fixture input".into(),
            mode: Mode::ReadOnly,
            session: session.into(),
            queue: true,
            fresh: true,
        }
    }
    // Oracle: project compatibility 01/03. A root is part of durable identity,
    // independent of the next startup argument and of the selected project.
    #[test]
    fn project73_bindings_configuration_trust_and_restart() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let a = a.to_str().unwrap();
        let b = b.to_str().unwrap();
        let db = d.path().join("state.db");
        let mut s = Store::open(&db, a).unwrap();
        let pa = s.project_by_id(&id(a)).unwrap();
        let pb = s.register_project(b).unwrap();
        let sa = create(&mut s, &pa, "session-a");
        let sb = create(&mut s, &pb, "session-b");
        s.set_trust(a, true).unwrap();
        assert!(s.trusted_project(a).unwrap());
        assert!(!s.trusted_project(b).unwrap());
        let ca = s.configuration_for(a).unwrap();
        s.register_assignment_for(
            b,
            crate::configuration::Assignment {
                runner: "fixture".into(),
                model: "B".into(),
                executable: "fixture".into(),
                content: "fixture".into(),
            },
        )
        .unwrap();
        assert!(s.configuration_for(a).unwrap().investigator.is_none());
        assert_eq!(
            s.configuration_for(b).unwrap().investigator.unwrap().model,
            "B"
        );
        let mut cb = s.configuration_for(b).unwrap();
        cb.team_enabled = false;
        cb.revision = s.next_configuration_revision().unwrap();
        s.save_configuration(&cb).unwrap();
        assert_eq!(s.configuration_for(a).unwrap(), ca);
        let ra = s.admit(&command(&sa.id, "command-a")).unwrap();
        let rb = s.admit(&command(&sb.id, "command-b")).unwrap();
        assert_eq!(ra.configuration.as_ref().unwrap().project, pa);
        assert_eq!(rb.configuration.as_ref().unwrap().project, pb);
        assert_eq!(rb.configuration.as_ref().unwrap().revision, cb.revision);
        let mut foreign = sb.clone();
        foreign.project = pa.clone();
        assert!(s.save_session(&foreign).is_err());
        let mut foreign = rb.clone();
        foreign.configuration.as_mut().unwrap().project = pa.clone();
        assert!(s.save(&mut foreign).is_err());
        // Identical relative paths cannot acquire authority from the other project.
        std::fs::write(Path::new(a).join("same.txt"), "A").unwrap();
        std::fs::write(Path::new(b).join("same.txt"), "B").unwrap();
        assert!(
            crate::decisions::text_file(a, Path::new(b).join("same.txt").to_str().unwrap())
                .is_err()
        );
        s.set_trust(b, false).unwrap();
        assert!(s.trusted_project(a).unwrap());
        drop(s);
        let s = Store::open(&db, b).unwrap();
        assert_eq!(s.project, a);
        assert_eq!(s.session_project(&sb.id).unwrap(), pb);
        assert_eq!(s.session_project(&sa.id).unwrap(), pa);
        assert_eq!(s.all().unwrap().len(), 2);
        assert!(
            s.all()
                .unwrap()
                .iter()
                .all(|r| r.phase == deck2_shared::Phase::Queued)
        );
    }
    // Oracle: transactional legacy migration must use meta.project, never startup B.
    #[test]
    fn project73_legacy_migration_uses_recorded_origin() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let db = d.path().join("state.db");
        let mut s = Store::open(&db, a.to_str().unwrap()).unwrap();
        let sid = s.session.clone();
        s.admit(&command(&sid, "legacy-command")).unwrap();
        drop(s);
        let c = Connection::open(&db).unwrap();
        c.execute_batch("UPDATE meta SET value='14' WHERE key='schema'; UPDATE sessions SET body=json_remove(body,'$.project'); UPDATE receipts SET body=json_remove(body,'$.configuration.project'); DROP TABLE projects;").unwrap();
        drop(c);
        let s = Store::open(&db, b.to_str().unwrap()).unwrap();
        let p = s.session_project(&sid).unwrap();
        assert_eq!(p.root, a.to_str().unwrap());
        assert_eq!(
            s.all().unwrap()[0].configuration.as_ref().unwrap().project,
            p
        );
        assert!(s.project_by_id(&id(b.to_str().unwrap())).is_err());
        drop(s);
        // Inspect rejects forged project ownership read-only, before schema writes.
        let c = Connection::open(&db).unwrap();
        c.execute(
            "UPDATE sessions SET body=json_set(body,'$.project.root',?1)",
            [b.to_str().unwrap()],
        )
        .unwrap();
        drop(c);
        let before = std::fs::read(&db).unwrap();
        assert!(Store::open(&db, b.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read(&db).unwrap(), before);
    }
    #[test]
    fn project73_root_disappearance_and_replacement_do_not_rebind() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        std::fs::create_dir(&a).unwrap();
        let db = d.path().join("state.db");
        let mut s = Store::open(&db, a.to_str().unwrap()).unwrap();
        let sid = s.session.clone();
        let binding = s.session_project(&sid).unwrap();
        std::fs::rename(&a, d.path().join("old")).unwrap();
        assert!(s.execution_project(&sid).is_err());
        assert_eq!(s.session_project(&sid).unwrap(), binding);
        std::fs::create_dir(&a).unwrap();
        assert!(s.execution_project(&sid).is_err());
        assert!(s.register_project(a.to_str().unwrap()).is_err());
        std::fs::remove_dir(&a).unwrap();
        std::os::unix::fs::symlink(d.path().join("old"), &a).unwrap();
        assert!(s.execution_project(&sid).is_err());
        drop(s);
        let s = Store::open(&db, a.to_str().unwrap()).unwrap();
        assert_eq!(s.session_project(&sid).unwrap(), binding);
        assert!(s.execution_project(&sid).is_err());
    }
}
