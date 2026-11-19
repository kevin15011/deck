//! Recorded content and reviewed project selection. The Store mutex serializes
//! admission and activation; SQLite transactions make each durable effect atomic.
use crate::{Store, tasks::digest};
use deck2_shared::{API, AdmissionSnapshot, Definition};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub use deck2_shared::Assignment;
pub fn assignment_from_runner(r: &crate::opencode::Runner) -> Assignment {
    Assignment {
        runner: r.provenance.runner.clone(),
        model: r.model.clone(),
        executable: r.provenance.executable.clone(),
        content: r.provenance.content.clone(),
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Configuration {
    #[serde(default, rename="executionBudget", alias="execution_budget")]
    pub execution_budget: crate::session_scheduler::ExecutionBudget,
    #[serde(default="default_concurrent_tasks", rename="maxConcurrentTasks", alias="max_concurrent_tasks")]
    pub max_concurrent_tasks: usize,
    #[serde(default)]
    pub cbm: Option<deck2_shared::GraphBinding>,
    #[serde(default)]
    pub runner: Option<deck2_shared::RunnerBinding>,
    #[serde(default)]
    pub helper: Option<deck2_shared::HelperSelection>,
    pub revision: u64,
    pub project: String,
    pub host_id: String,
    pub team_enabled: bool,
    pub investigator: Option<Assignment>,
    pub codex_executable: Option<String>,
    pub definitions: Vec<String>,
    pub modes: std::collections::BTreeMap<String, Vec<String>>,
}
fn default_concurrent_tasks()->usize {4}
impl Configuration {
    pub fn qualification(&self) -> Option<String> {
        self.investigator.as_ref().map(|a| {
            digest(
                serde_json::to_string(a)
                    .expect("serializable assignment")
                    .as_bytes(),
            )
        })
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlanRequest {
    pub api: u32,
    pub expected_revision: u64,
    pub team_enabled: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyRequest {
    pub api: u32,
    pub operation_id: String,
    pub allow: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Plan {
    #[serde(default)]
    pub helper: Option<deck2_shared::HelperSelection>,
    #[serde(default)]
    pub artifact_store: Option<String>,
    pub id: String,
    pub before: Configuration,
    pub team_enabled: bool,
    pub qualification: Option<String>,
    pub trusted: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ManagementOperation {
    #[serde(default)]
    pub published: bool,
    #[serde(default)]
    pub cancel_requested: bool,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub owner: Option<String>,
    pub id: String,
    pub plan: String,
    pub allow: bool,
    pub phase: String,
    pub revision: u64,
}
pub(crate) fn definitions() -> Vec<Definition> {
    let mut list = vec![];
    for (name, body, kind, roles, modes, source) in [
        (
            "Read-only conversation",
            crate::native::INSTRUCTIONS.to_string(),
            "managed_policy",
            vec!["conversation"],
            vec!["read_only"],
            "crates/host/src/native.rs::INSTRUCTIONS",
        ),
        (
            "Reviewed edit operation policy",
            crate::native::EDIT_INSTRUCTIONS.to_string(),
            "managed_policy",
            vec!["editor"],
            vec!["reviewed_edit"],
            "crates/host/src/native.rs::EDIT_INSTRUCTIONS",
        ),
        (
            "Team Lead",
            crate::tasks::LEAD.to_string(),
            "managed_policy",
            vec!["lead"],
            vec!["team"],
            "crates/host/src/tasks.rs::LEAD",
        ),
        (
            "Investigator",
            crate::tasks::INVESTIGATOR.to_string(),
            "managed_policy",
            vec!["investigator"],
            vec!["team"],
            "crates/host/src/tasks.rs::INVESTIGATOR",
        ),
        (
            "Lead dynamic tools",
            crate::native::team_tools().to_string(),
            "tool_schema",
            vec!["lead"],
            vec!["team"],
            "crates/host/src/native.rs::team_tools",
        ),
        (
            "Scoped project tools",
            crate::opencode::read_tools().to_string(),
            "tool_schema",
            vec!["investigator"],
            vec!["team"],
            "crates/host/src/opencode.rs::read_tools",
        ),
        (
            "Codex disabled extensions",
            serde_json::to_string(crate::native::DISABLED).unwrap(),
            "adapter_configuration",
            vec!["conversation", "editor", "lead"],
            vec!["read_only", "reviewed_edit", "team"],
            "crates/host/src/native.rs::DISABLED",
        ),
    ] {
        list.push(Definition {
            digest: digest(body.as_bytes()),
            name: name.into(),
            body,
            kind: kind.into(),
            source: source.into(),
            owner: "Deck managed content; native installation and credentials remain runner-owned"
                .into(),
            roles: roles.into_iter().map(String::from).collect(),
            modes: modes.into_iter().map(String::from).collect(),
            required_resources: vec!["exact qualified native route".into()],
        });
    }
    for (name, body, roles, modes, source) in [
        (
            "Developer native restrictions",
            serde_json::json!({"disabled_extensions":crate::native::DISABLED,"permissions":":read-only","network_access":false,"approvals":{"lead":"on-request","quality":"never"},"tools":"finite host-owned lifecycle tools for Lead only"}).to_string(),
            vec!["lead","quality"],vec!["developer","quality"],"native.rs::prepare_mode",
        ),
        (
            "Shared authority and provenance",
            crate::lifecycle::SHARED.to_string(),
            vec!["lead", "quality"],
            vec!["developer", "quality"],
            "lifecycle::SHARED",
        ),
        (
            "Developer Lead",
            crate::lifecycle::LEAD.to_string(),
            vec!["lead"],
            vec!["developer"],
            "lifecycle::LEAD",
        ),
        (
            "Generic verification",
            crate::lifecycle::VERIFICATION.to_string(),
            vec!["lead", "quality"],
            vec!["developer", "quality"],
            "lifecycle::VERIFICATION",
        ),
        (
            "Independent Quality",
            crate::lifecycle::QUALITY.to_string(),
            vec!["quality"],
            vec!["quality"],
            "lifecycle::QUALITY",
        ),
        (
            "Targeted Code Economy",
            crate::lifecycle::ECONOMY.to_string(),
            vec!["quality"],
            vec!["quality"],
            "lifecycle::ECONOMY",
        ),
        (
            "Developer lifecycle tools",
            crate::lifecycle::tools().to_string(),
            vec!["lead"],
            vec!["developer"],
            "lifecycle::tools",
        ),
    ] {
        list.push(Definition {
            digest: digest(body.as_bytes()),
            name: name.into(),
            body,
            source: format!("crates/host/src/{source}"),
            owner: "Deck managed finite fragment".into(),
            kind: "managed_policy".into(),
            roles: roles.into_iter().map(String::from).collect(),
            modes: modes.into_iter().map(String::from).collect(),
            required_resources: vec!["Codex 0.166.0 app-server read-only".into()],
        });
    }
    list.push(Definition {
        digest: digest(crate::session_contract::POLICY.as_bytes()),
        name: "Connected session continuity".into(),
        body: crate::session_contract::POLICY.into(),
        source: "Deck1 core/session/mcp.ts::CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE".into(),
        owner: "Deck canonical session contract".into(),
        kind: "managed_policy".into(),
        roles: vec!["lead".into()],
        modes: vec!["session_v1".into()],
        required_resources: vec!["Codex 0.166.0 session MCP".into()],
    });
    list
}
pub fn compact_definitions() -> Vec<Definition> {
    let mut d = definitions()
        .into_iter()
        .find(|d| d.name == "Scoped project tools")
        .unwrap();
    d.body = crate::opencode::compact_tools().to_string();
    d.digest = digest(d.body.as_bytes());
    d.source = "crates/host/src/opencode.rs::compact_tools".into();
    vec![d]
}
impl Store {
    pub(crate) fn init_configuration(&mut self) -> Result<(), String> {
        self.conn.execute_batch("SAVEPOINT configuration_migration; CREATE TABLE IF NOT EXISTS definitions(digest TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS configurations(revision INTEGER PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS configuration_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS management_operations(id TEXT PRIMARY KEY,plan TEXT UNIQUE NOT NULL,body TEXT NOT NULL);").map_err(|_|"Cannot begin configuration migration")?;
        let result = (|| {
            let defs = definitions()
                .into_iter()
                .chain(crate::ordinary::definitions())
                .collect::<Vec<_>>();
            for d in &defs {
                self.conn
                    .execute(
                        "INSERT OR IGNORE INTO definitions VALUES(?1,?2)",
                        params![d.digest, serde_json::to_string(d).unwrap()],
                    )
                    .map_err(|_| "Cannot record exact content")?;
                if self.definition(&d.digest)? != *d {
                    return Err("Recorded content identity conflict".into());
                }
            }
            let existing: u32 = self
                .conn
                .query_row("SELECT count(*) FROM configurations", [], |r| r.get(0))
                .map_err(|_| "Cannot inspect configuration")?;
            if existing == 0 {
                self.save_configuration(&Configuration {
                    execution_budget: Default::default(),
                    max_concurrent_tasks: 4,
                    runner: None,
                    cbm: None,
                    helper: None,
                    revision: 1,
                    project: self.project.clone(),
                    host_id: self.host_id()?,
                    team_enabled: true,
                    investigator: None,
                    codex_executable: None,
                    modes: [
                        "read_only",
                        "reviewed_edit",
                        "team",
                        "developer",
                        "quality",
                        "session_v1",
                    ]
                    .into_iter()
                    .map(|mode| {
                        (
                            mode.to_string(),
                            defs.iter()
                                .filter(|d| d.modes.iter().any(|m| m == mode))
                                .map(|d| d.digest.clone())
                                .collect(),
                        )
                    })
                    .collect(),
                    definitions: defs.into_iter().map(|d| d.digest).collect(),
                })?;
            }
            let mut connected = self.configuration()?;
            if !connected.modes.contains_key("session_v1") {
                let ids = definitions()
                    .into_iter()
                    .filter(|d| d.modes.iter().any(|m| m == "session_v1"))
                    .map(|d| d.digest)
                    .collect::<Vec<_>>();
                connected.revision = self.next_configuration_revision()?;
                for id in &ids {
                    if !connected.definitions.contains(id) {
                        connected.definitions.push(id.clone());
                    }
                }
                connected.modes.insert("session_v1".into(), ids);
                self.save_configuration(&connected)?;
            }
            // Add newly introduced finite selections without rewriting history or
            // the exact content of already admitted attempts.
            let mut current = self.configuration()?;
            if !current.modes.contains_key("developer") {
                current.revision = self.next_configuration_revision()?;
                for mode in ["developer", "quality"] {
                    let ids: Vec<_> = definitions()
                        .into_iter()
                        .filter(|d| d.modes.iter().any(|m| m == mode))
                        .map(|d| d.digest)
                        .collect();
                    current.definitions.extend(
                        ids.iter()
                            .filter(|id| !current.definitions.contains(id))
                            .cloned()
                            .collect::<Vec<_>>(),
                    );
                    current.modes.insert(mode.into(), ids);
                }
                self.save_configuration(&current)?;
            }
            self.conn
                .execute_batch("RELEASE configuration_migration")
                .map_err(|_| "Cannot commit configuration migration")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = self.conn.execute_batch(
                "ROLLBACK TO configuration_migration; RELEASE configuration_migration",
            );
        }
        result
    }
    /// Compiled managed content (for example the connected session continuity
    /// policy) can change between builds. Admission records the current mode
    /// selection while dispatch requires this build's exact content, so a stale
    /// selection would refuse every new turn. Record this build's content as a
    /// new revision per project; admitted attempts keep their exact revision.
    /// Team is excluded: its RTK selection intentionally differs and dispatch
    /// does not compare it with the compiled list.
    /// Runs at startup after projects are migrated.
    pub(crate) fn refresh_compiled_selections(&mut self) -> Result<(), String> {
        let compiled = definitions();
        let mut roots = std::collections::BTreeSet::from([self.project.clone()]);
        roots.extend(self.projects()?.into_iter().map(|p| p.root));
        for root in roots {
            let Ok(mut c) = self.configuration_for(&root) else { continue };
            let mut changed = false;
            for mode in ["read_only", "reviewed_edit", "session_v1", "developer"] {
                let Some(recorded) = c.modes.get(mode) else { continue };
                let current: Vec<String> = compiled.iter()
                    .filter(|d| d.modes.iter().any(|m| m == mode))
                    .map(|d| d.digest.clone())
                    .collect();
                if *recorded == current { continue; }
                for id in &current {
                    self.definition(id)?;
                    if !c.definitions.contains(id) { c.definitions.push(id.clone()); }
                }
                c.modes.insert(mode.into(), current);
                changed = true;
            }
            if changed {
                c.revision = self.next_configuration_revision()?;
                self.save_configuration(&c)?;
            }
        }
        Ok(())
    }
    // Host-wide RTK lives in meta. Current per-project records mirror it for
    // compatibility; historical revisions and already admitted work stay exact.
    pub(crate) fn init_settings_model(&mut self) -> Result<(), String> {
        if self.conn.query_row("SELECT value FROM meta WHERE key='settings_model_v1'",[],|r|r.get::<_,String>(0)).optional().map_err(|_|"Cannot read settings model")?.is_some() { return Ok(()); }
        let projects=self.projects()?;
        let enabled=projects.iter().map(|p|self.configuration_for(&p.root)).collect::<Result<Vec<_>,_>>()?.iter().any(|c|c.helper.is_some());
        let helper=if enabled { Some(crate::managed_tools::release("1.2.0")?.selection) } else {None};
        self.conn.execute_batch("SAVEPOINT settings_model") .map_err(|_|"Cannot migrate settings")?;
        let result=(|| {
            self.select_host_helper(helper)?;
            self.conn.execute("INSERT INTO meta(key,value) VALUES('settings_model_v1','1')",[]).map_err(|_|"Cannot retain settings migration")?;
            Ok::<_,String>(())
        })();
        if result.is_ok() { self.conn.execute_batch("RELEASE settings_model").map_err(|_|"Cannot commit settings migration")?; }
        else { let _=self.conn.execute_batch("ROLLBACK TO settings_model; RELEASE settings_model"); }
        result
    }
    pub(crate) fn select_host_helper(&self, helper: Option<deck2_shared::HelperSelection>) -> Result<(),String> {
        if let Some(h)=&helper {crate::managed_tools::validate_selection(h)?;}
        self.conn.execute("INSERT INTO meta(key,value) VALUES('host_rtk',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&helper).unwrap()]).map_err(|_|"Cannot select host RTK")?;
        for p in self.projects()? {
            let mut c=self.configuration_for(&p.root)?;
            if c.helper==helper && c.team_enabled {continue;}
            c.revision=self.next_configuration_revision()?;
            c.team_enabled=true;
            c.helper=helper.clone();
            if helper.is_some() {
                for d in compact_definitions() {
                    self.conn.execute("INSERT OR IGNORE INTO definitions VALUES(?1,?2)",params![d.digest,serde_json::to_string(&d).unwrap()]).map_err(|_|"Cannot retain RTK content")?;
                    let ids=c.modes.get_mut("team").ok_or("Missing team content")?;
                    ids.retain(|id|self.definition(id).is_ok_and(|d|d.name!="Scoped project tools"));
                    if !ids.contains(&d.digest){ids.push(d.digest.clone());}
                    if !c.definitions.contains(&d.digest){c.definitions.push(d.digest);}
                }
                c.definitions.retain(|id|c.modes.values().any(|ids|ids.contains(id)));
            }
            self.save_configuration(&c)?;
        }
        Ok(())
    }
    pub fn definition(&self, id: &str) -> Result<Definition, String> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Invalid recorded content digest".into());
        }
        let body: String = self
            .conn
            .query_row("SELECT body FROM definitions WHERE digest=?1", [id], |r| {
                r.get(0)
            })
            .map_err(|_| "Recorded content unavailable; no current-content fallback")?;
        let d: Definition = serde_json::from_str(&body).map_err(|_| "Corrupt recorded content")?;
        if d.digest != id || digest(d.body.as_bytes()) != id {
            return Err("Recorded content digest mismatch".into());
        }
        Ok(d)
    }
    pub fn configuration(&self) -> Result<Configuration, String> { self.configuration_for(&self.project) }
    pub fn configuration_for(&self, project: &str) -> Result<Configuration, String> {
        let body: String = self
            .conn
            .query_row(
                "SELECT body FROM configurations WHERE json_extract(body,'$.project')=?1 ORDER BY revision DESC LIMIT 1",
                [project],
                |r| r.get(0),
            )
            .map_err(|_| "Configuration unavailable")?;
        let c: Configuration = serde_json::from_str(&body).map_err(|_| "Corrupt configuration")?;
        if c.project != project || c.host_id != self.host_id()? {
            return Err("Foreign configuration ownership".into());
        }
        Ok(c)
    }
    pub(crate) fn save_configuration(&self, c: &Configuration) -> Result<(), String> {
        c.execution_budget.validate(c.max_concurrent_tasks)?;
        self.conn
            .execute(
                "INSERT INTO configurations VALUES(?1,?2)",
                params![
                    c.revision as i64,
                    serde_json::to_string(c).map_err(|_| "Cannot encode configuration")?
                ],
            )
            .map_err(|_| "Cannot persist configuration")?;
        Ok(())
    }
    pub fn register_codex(&mut self, digest: String) -> Result<(), String> {
        let mut c = self.configuration()?;
        if c.codex_executable.as_ref().is_some_and(|d| d != &digest) {
            return Err("Startup executable differs from the persisted selection; review runner selection explicitly".into());
        }
        if c.codex_executable.is_none() {
            c.revision = self.next_configuration_revision()?;
            c.codex_executable = Some(digest);
            self.save_configuration(&c)?;
        }
        Ok(())
    }
    pub fn register_assignment(&mut self,assignment:Assignment)->Result<(),String>{let p=self.project.clone();self.register_assignment_for(&p,assignment)}
    pub fn register_assignment_for(&mut self,project:&str,assignment:Assignment)->Result<(),String>{
        let mut c = self.configuration_for(project)?;
        if c.investigator.as_ref() != Some(&assignment) {
            c.revision = self.next_configuration_revision()?;
            c.investigator = Some(assignment);
            self.save_configuration(&c)?;
        }
        Ok(())
    }
    pub fn admission_definition_ids(
        &self,
        mode: &deck2_shared::Mode,
    ) -> Result<Vec<String>, String> {
        let mode = match mode {
            deck2_shared::Mode::SessionV1 => "session_v1",
            deck2_shared::Mode::Team => "team",
            deck2_shared::Mode::Developer => "developer",
            deck2_shared::Mode::ReviewedEdit => "reviewed_edit",
            _ => "read_only",
        };
        Ok(definitions()
            .into_iter()
            .filter(|d| d.modes.iter().any(|m| m == mode))
            .map(|d| d.digest)
            .collect())
    }
    pub fn admission_snapshot(&self, mode: &deck2_shared::Mode) -> Result<AdmissionSnapshot,String> { self.admission_snapshot_for(&self.project, mode) }
    pub fn admission_snapshot_for(
        &self,
        project: &str,
        mode: &deck2_shared::Mode,
    ) -> Result<AdmissionSnapshot, String> {
        let c = self.configuration_for(project)?;
        if *mode == deck2_shared::Mode::Team && !c.team_enabled {
            return Err("Team investigation is disabled for new work. Review Configuration to re-enable it.".into());
        }
        let mode = match mode {
            deck2_shared::Mode::SessionV1 => "session_v1",
            deck2_shared::Mode::Team => "team",
            deck2_shared::Mode::Developer => "developer",
            deck2_shared::Mode::ReviewedEdit => "reviewed_edit",
            _ => "read_only",
        };
        if mode == "team" && c.investigator.is_none() {
            return Err("No qualified investigator assignment; new team admission blocked".into());
        }
        let refs = c
            .modes
            .get(mode)
            .ok_or("Mode selection not recorded")?
            .clone();
        for id in &refs {
            self.definition(id)?;
        }
        Ok(AdmissionSnapshot {
            native: None,
            project: self.project_by_id(&crate::projects::id(project))?,
            session_contract: None,
            selection: None,
            cbm: if mode == "team" { c.cbm } else { None },
            runner: c.runner.clone(),
            helper: if mode == "team" { c.helper } else { None },
            revision: c.revision,
            codex_executable: c.codex_executable,
            definitions: refs,
            investigator: if mode == "team" { c.investigator } else { None },
            exclusions: if mode == "session_v1" {
                vec!["Native role/skill generation and runtime hooks are verified at dispatch; delivery is not proof of model consumption".into()]
            } else {
                vec!["External skill discovery/loading disabled on this qualified route; managed policy fragments are not standalone skills".into(),if mode=="team"{"Code Economy targeted role bundle excluded for Lead/Investigate under I14/I37"}else{"Reviewed-edit operation policy is separate from the targeted role bundle"}.into()]
            },
            delivery_observed: false,
        })
    }
    pub fn validate_snapshot(&self, s: &AdmissionSnapshot) -> Result<(), String> {
        if let Some(native) = &s.native {
            crate::native_identity::validate_binding(native)?;
            if s.runner.as_ref() != Some(&native.executable) { return Err("Native executable admission mismatch".into()); }
        }

        if let Some(c) = &s.session_contract {
            crate::session_contract::validate(c)?;
        }
        if s.selection.is_some() {
            return self.validate_ordinary_snapshot(s);
        }
        let body: String = self
            .conn
            .query_row(
                "SELECT body FROM configurations WHERE revision=?1",
                [s.revision as i64],
                |r| r.get(0),
            )
            .map_err(|_| "Admission revision unavailable; dispatch blocked")?;
        let c: Configuration =
            serde_json::from_str(&body).map_err(|_| "Invalid admission configuration")?;
        if c.project != s.project.root || self.project_by_id(&s.project.id)? != s.project { return Err("Admission project mismatch".into()); }
        if !c.modes.values().any(|ids| ids == &s.definitions)
            || s.definitions.is_empty()
            || s.definitions.iter().any(|id| !c.definitions.contains(id))
            || !crate::member_integration::snapshot_runner_matches(s, &c)
            || s.cbm.is_some() && s.cbm != c.cbm
            || s.investigator.is_some() && s.investigator != c.investigator
            || s.helper.is_some() && s.helper != c.helper
        {
            return Err("Admission selection mismatch".into());
        }
        for id in &s.definitions {
            self.definition(id)?;
        }
        Ok(())
    }
    pub fn execution_tools(&self, s: &AdmissionSnapshot) -> Result<serde_json::Value, String> {
        self.validate_snapshot(s)?;
        let mut expected = if s.selection.is_some() {
            crate::ordinary::definition_ids(true)
        } else {
            self.admission_definition_ids(&deck2_shared::Mode::Team)?
        };
        let tools = if let Some(helper) = &s.helper {
            crate::managed_tools::validate_selection(helper)?;
            expected.retain(|id| {
                self.definition(id)
                    .is_ok_and(|d| d.name != "Scoped project tools")
            });
            expected.extend(compact_definitions().into_iter().map(|d| d.digest));
            crate::opencode::compact_tools()
        } else {
            crate::opencode::read_tools()
        };
        let tools = if s.cbm.is_some() {
            expected.extend(
                crate::cbm_management::definitions()
                    .into_iter()
                    .map(|d| d.digest),
            );
            crate::cbm_management::tools(tools)
        } else {
            tools
        };
        if expected != s.definitions {
            return Err("Admitted finite tool/content selection unavailable; no fallback".into());
        }
        Ok(tools)
    }
    pub fn plan_configuration(&mut self,r:&PlanRequest,q:&Option<String>)->Result<Plan,String>{let p=self.project.clone();self.plan_configuration_for(&p,r,q)}
    pub fn plan_configuration_for(
        &mut self,
        project:&str,
        r: &PlanRequest,
        qualification: &Option<String>,
    ) -> Result<Plan, String> {
        let c = self.configuration_for(project)?;
        if r.api != API || r.expected_revision != c.revision || qualification != &c.qualification()
        {
            return Err(
                "Configuration or qualification changed. Refresh and review a new plan.".into(),
            );
        }
        let count: u32 = self
            .conn
            .query_row("SELECT count(*) FROM configuration_plans WHERE json_extract(body,'$.before.project')=?1", [project], |r| r.get(0))
            .map_err(|_| "Cannot inspect plans")?;
        if count >= 256 {
            return Err("Configuration plan history is full".into());
        }
        let p = Plan {
            helper: None,
            artifact_store: None,
            id: uuid::Uuid::new_v4().to_string(),
            before: c,
            team_enabled: r.team_enabled,
            qualification: qualification.clone(),
            trusted: self.trusted_project(project)?,
        };
        self.conn
            .execute(
                "INSERT INTO configuration_plans VALUES(?1,?2)",
                params![p.id, serde_json::to_string(&p).unwrap()],
            )
            .map_err(|_| "Cannot record configuration plan")?;
        Ok(p)
    }
    pub fn operation_not_recorded(&self, id: &str) -> bool {
        self.conn.is_autocommit()
            && self
                .conn
                .query_row(
                    "SELECT body FROM management_operations WHERE id=?1",
                    [id],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .is_ok_and(|v| v.is_none())
    }
    pub fn operation(&self, id: &str) -> Result<ManagementOperation, String> {
        let body: String = self
            .conn
            .query_row(
                "SELECT body FROM management_operations WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| "Management operation not recorded; retry the exact reviewed operation")?;
        serde_json::from_str(&body).map_err(|_| "Corrupt management operation".into())
    }
    // Reconcile first, then cancel only this exact retained identity. A durable
    // cancelled receipt fences delayed/retried applies that were not admitted.
    pub fn discard_configuration(&mut self, project: &str, plan: &str, r: &ApplyRequest) -> Result<ManagementOperation, String> {
        if r.api != API || !(8..=80).contains(&r.operation_id.len())
            || !r.operation_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return Err("Invalid management operation identity".into());
        }
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(|_| "Cannot reconcile change")?;
        let result = (|| {
            let p = self.helper_plan(plan)?;
            if p.before.project != project || p.before.host_id != self.host_id()? {
                return Err("Change belongs to another project".into());
            }
            let prior: Option<String> = self.conn.query_row("SELECT body FROM management_operations WHERE id=?1",[&r.operation_id],|row|row.get(0)).optional().map_err(|_| "Cannot reconcile change receipt")?;
            if let Some(body) = prior {
                let mut o: ManagementOperation = serde_json::from_str(&body).map_err(|_| "Invalid change receipt")?;
                if o.plan != plan || o.allow != r.allow { return Err("Change identity mismatch".into()); }
                if !crate::managed_tools::terminal(&o.phase) {
                    if p.helper.is_none() || o.owner.as_deref() != Some(self.host_id()?.as_str()) { return Err("Cannot cancel an uncertain change".into()); }
                    o.cancel_requested = true;
                    self.conn.execute("UPDATE management_operations SET body=?2 WHERE id=?1",params![o.id,serde_json::to_string(&o).unwrap()]).map_err(|_| "Cannot retain cancellation")?;
                }
                return Ok(o);
            }
            let o = ManagementOperation { id:r.operation_id.clone(),plan:plan.into(),allow:r.allow,
                phase:if r.allow { "cancelled" } else { "denied" }.into(),revision:p.before.revision,
                owner:if p.helper.is_some(){Some(self.host_id()?)}else{None}, ..Default::default() };
            self.conn.execute("INSERT INTO management_operations VALUES(?1,?2,?3)",params![o.id,o.plan,serde_json::to_string(&o).unwrap()]).map_err(|_| "Cannot retain discarded change")?;
            Ok(o)
        })();
        match result {
            Ok(o) => match self.conn.execute_batch("COMMIT") {
                Ok(()) => Ok(o),
                Err(_) => { let _ = self.conn.execute_batch("ROLLBACK"); Err("Discard outcome uncertain; retry this same change".into()) }
            },
            Err(e) => { let _ = self.conn.execute_batch("ROLLBACK"); Err(e) }
        }
    }
    pub fn apply_configuration(
        &mut self,
        plan: &str,
        r: &ApplyRequest,
        qualification: &Option<String>,
    ) -> Result<ManagementOperation, String> {
        if r.api != API
            || !(8..=80).contains(&r.operation_id.len())
            || !r
                .operation_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid management operation identity".into());
        }
        self.conn
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "Cannot begin management operation")?;
        let result = (|| {
            let prior: Option<String> = self
                .conn
                .query_row(
                    "SELECT body FROM management_operations WHERE id=?1",
                    [&r.operation_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| "Cannot inspect management identity")?;
            if let Some(body) = prior {
                let o: ManagementOperation =
                    serde_json::from_str(&body).map_err(|_| "Corrupt management receipt")?;
                return if o.plan == plan && o.allow == r.allow {
                    Ok(o)
                } else {
                    Err("Management identity conflicts with accepted operation".into())
                };
            }
            let body: String = self
                .conn
                .query_row(
                    "SELECT body FROM configuration_plans WHERE id=?1",
                    [plan],
                    |r| r.get(0),
                )
                .map_err(|_| "Unknown reviewed plan")?;
            let p: Plan = serde_json::from_str(&body).map_err(|_| "Corrupt reviewed plan")?;
            if p.helper.is_some() {
                return Err("Helper operation requires asynchronous publication boundary".into());
            }
            let c = self.configuration_for(&p.before.project)?;
            if p.before != c || p.qualification != *qualification || p.trusted != self.trusted_project(&p.before.project)? {
                return Err(
                    "Plan is stale or authority/preparation changed. Refresh and review again."
                        .into(),
                );
            }
            let mut next = c.clone();
            if r.allow {
                next.revision=self.next_configuration_revision()?;
                next.team_enabled = p.team_enabled;
                // An artifact review with no selection is a reviewed helper disable.
                // Ordinary team plans have no artifact-store identity.
                if p.artifact_store.is_some() { next.helper = None; }
                self.save_configuration(&next)?;
                if p.artifact_store.is_some() { self.select_host_helper(None)?; }
            }
            let o = ManagementOperation {
                id: r.operation_id.clone(),
                plan: plan.into(),
                allow: r.allow,
                phase: if r.allow { "applied" } else { "denied" }.into(),
                revision: next.revision,
                ..Default::default()
            };
            self.conn
                .execute(
                    "INSERT INTO management_operations VALUES(?1,?2,?3)",
                    params![o.id, o.plan, serde_json::to_string(&o).unwrap()],
                )
                .map_err(|_| "Plan already decided or operation persistence failed")?;
            Ok(o)
        })();
        match result {
            Ok(o) => {
                if self.conn.execute_batch("COMMIT").is_err() {
                    let _ = self.conn.execute_batch("ROLLBACK");
                    return Err("Management commit unconfirmed; reconnect using the same operation identity".into());
                }
                Ok(o)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
}

/// Validate recorded configuration before opening it writable. Missing historical snapshots
/// remain unknown; definitions present in a snapshot must retain their bytes.
pub(crate) fn inspect(conn: &rusqlite::Connection, project: &str) -> Result<(), String> {
    let invalid = "Unsupported or corrupt configuration state; preserve it for inspection";
    let schema: String = conn.query_row("SELECT value FROM meta WHERE key='schema'", [], |r|r.get(0)).map_err(|_|invalid)?;
    let helper_identity = |h: &deck2_shared::HelperSelection| {
        !h.version.is_empty()
            && h.version.len() <= 40
            && [&h.executable, &h.catalog].iter().all(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
    };
    let mut definitions = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT digest,body FROM definitions")
        .map_err(|_| invalid)?;
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| invalid)?
    {
        let (id, body) = row.map_err(|_| invalid)?;
        let d: Definition = serde_json::from_str(&body).map_err(|_| invalid)?;
        if id != d.digest || digest(d.body.as_bytes()) != id {
            return Err(invalid.into());
        }
        definitions.insert(id, d);
    }
    let host: String = conn
        .query_row("SELECT value FROM meta WHERE key='host'", [], |r| r.get(0))
        .map_err(|_| invalid)?;
    let mut revisions = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT revision,body FROM configurations")
        .map_err(|_| invalid)?;
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| invalid)?
    {
        let (id, body) = row.map_err(|_| invalid)?;
        let c: Configuration = serde_json::from_str(&body).map_err(|_| invalid)?;
        if id < 1
            || c.revision != id as u64
            || (c.project != project && conn.query_row("SELECT count(*) FROM projects WHERE json_extract(body,'$.root')=?1", [&c.project], |r|r.get::<_,u64>(0)).unwrap_or(0) != 1)
            || c.host_id != host
            || c.runner.as_ref().is_some_and(|b| {
                crate::runner_management::validate_binding(b).is_err()
                    || c.codex_executable.as_ref() != Some(&b.executable)
            })
            || c.cbm
                .as_ref()
                .is_some_and(|b| !crate::cbm_management::valid_binding(b))
            || c.helper.as_ref().is_some_and(|h| !helper_identity(h))
            || c.definitions.iter().any(|d| !definitions.contains_key(d))
            || c.modes
                .values()
                .flatten()
                .any(|d| !c.definitions.contains(d))
        {
            return Err(invalid.into());
        }
        revisions.insert(c.revision, c);
    }
    if revisions.is_empty() {
        return Err(invalid.into());
    }
    let mut plans = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT id,body FROM configuration_plans")
        .map_err(|_| invalid)?;
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| invalid)?
    {
        let (id, body) = row.map_err(|_| invalid)?;
        let p: Plan = serde_json::from_str(&body).map_err(|_| invalid)?;
        if p.id != id
            || revisions.get(&p.before.revision) != Some(&p.before)
            || p.qualification != p.before.qualification()
            || p.helper.as_ref().is_some_and(|h| {
                !helper_identity(h)
                    || !p.trusted
                    || p.artifact_store
                        .as_ref()
                        .is_none_or(|s| s.is_empty() || s.len() > 200)
            })
            || p.artifact_store.as_ref().is_some_and(|s| s.is_empty() || s.len() > 200)
        {
            return Err(invalid.into());
        }
        plans.insert(id, p);
    }
    let mut stmt = conn
        .prepare("SELECT id,plan,body FROM management_operations")
        .map_err(|_| invalid)?;
    for row in stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| invalid)?
    {
        let (id, plan, body) = row.map_err(|_| invalid)?;
        let o: ManagementOperation = serde_json::from_str(&body).map_err(|_| invalid)?;
        if o.id != id
            || o.plan != plan
            || !plans.contains_key(&plan)
            || !revisions.contains_key(&o.revision)
            || if let Some(p) = plans.get(&plan).filter(|p| p.helper.is_some()) {
                o.owner.as_ref() != Some(&host)
                    || if o.allow {
                        !matches!(
                            o.phase.as_str(),
                            "accepted"
                                | "downloading"
                                | "validating"
                                | "published_not_selected"
                                | "recovery_required"
                                | "applied"
                                | "cancelled"
                                | "stale"
                                | "failed"
                        ) || matches!(o.phase.as_str(), "applied" | "published_not_selected")
                            && !o.published
                            || o.phase == "applied"
                                && revisions.get(&o.revision).is_none_or(|c| {
                                    c.helper != p.helper || c.project != p.before.project || o.revision <= p.before.revision
                                })
                    } else {
                        o.phase != "denied"
                    }
            } else {
                if o.allow { !matches!(o.phase.as_str(), "applied" | "cancelled") } else { o.phase != "denied" }
            }
        {
            return Err(invalid.into());
        }
    }
    let mut prior = Vec::<deck2_shared::Receipt>::new();
    let mut stmt = conn
        .prepare("SELECT body FROM receipts ORDER BY rowid")
        .map_err(|_| invalid)?;
    for row in stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| invalid)?
    {
        let r: deck2_shared::Receipt =
            serde_json::from_str(&row.map_err(|_| invalid)?).map_err(|_| invalid)?;
        if let Some(s) = &r.configuration {
            if (r.mode == deck2_shared::Mode::SessionV1) != s.session_contract.is_some()
                || s.session_contract
                    .as_ref()
                    .is_some_and(|c| crate::session_contract::validate(c).is_err())
                || r.decisions.iter().any(|d| {
                    d.native.is_some()
                        && (r.mode != deck2_shared::Mode::SessionV1
                            || (if schema == "18" { crate::session_contract::validate_native(d) } else { crate::session_contract::validate_legacy_native(d) }).is_err())
                })
            {
                return Err(invalid.into());
            }

            if r.mode.ordinary() {
                crate::ordinary::inspect_snapshot(conn, s, &r.session, &r.mode)?;
                prior.push(r);
                continue;
            }
            if s.selection.is_some() {
                return Err(invalid.into());
            }
            let c = revisions.get(&s.revision).ok_or(invalid)?;
            let mode = match r.mode {
                deck2_shared::Mode::ReadOnly => "read_only",
                deck2_shared::Mode::SessionV1 => "session_v1",
                deck2_shared::Mode::ReviewedEdit => "reviewed_edit",
                deck2_shared::Mode::Team => "team",
                deck2_shared::Mode::Developer => "developer",
                deck2_shared::Mode::OrdinaryReadOnlyV1 | deck2_shared::Mode::OrdinaryReviewedV1 => {
                    "ordinary_v1"
                }
            };
            // The former continuation admission copied the preceding native
            // snapshot even when a different mode was requested. Preparation
            // rejected it before delivery/dispatch. Retain that failed evidence
            // verbatim, only with an earlier valid completed receipt as witness.
            let legacy_failed = matches!(
                r.mode,
                deck2_shared::Mode::ReadOnly | deck2_shared::Mode::ReviewedEdit
            ) && !r.fresh
                && r.phase == deck2_shared::Phase::Failed
                && r.detail == "Admitted native content is unavailable in this build; no fallback"
                && r.policy
                    == if mode == "read_only" {
                        "deck2-readonly-v1"
                    } else {
                        "deck2-reviewed-v1"
                    }
                && !r.cancel_requested
                && r.native_pid.is_some()
                && r.handshake_ms.is_none()
                && r.dispatch_ms.is_none()
                && r.acknowledgment_ms.is_none()
                && r.first_output_ms.is_none()
                && r.thread.is_none()
                && r.turn.is_none()
                && r.model.is_none()
                && r.generation.is_empty()
                && r.text.is_empty()
                && r.decisions.is_empty()
                && r.attachments.is_empty()
                && r.local_tool_calls == 0
                && s.delivery_observed
                && prior
                    .iter()
                    .rev()
                    .find(|p| p.session == r.session && p.thread.is_some())
                    .is_some_and(|p| {
                        p.mode != r.mode
                            && matches!(
                                p.mode,
                                deck2_shared::Mode::ReadOnly | deck2_shared::Mode::ReviewedEdit
                            )
                            && p.phase == deck2_shared::Phase::Completed
                            && p.handshake_ms.is_some()
                            && p.dispatch_ms.is_some()
                            && p.acknowledgment_ms.is_some()
                            && p.turn.is_some()
                            && !p.generation.is_empty()
                            && p.configuration.as_ref() == Some(s)
                    });
            if (c.modes.get(mode) != Some(&s.definitions) && !legacy_failed)
                || !crate::member_integration::snapshot_runner_matches(s, c)
                || s.cbm.is_some() && s.cbm != c.cbm
                    || (mode == "team" && (s.investigator != c.investigator || s.helper != c.helper))
                || (mode != "team" && (s.investigator.is_some() || s.helper.is_some()))
            {
                return Err(invalid.into());
            }
        }
        prior.push(r);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn prepared() -> Store {
        let mut s = Store::open_memory("/fixture").unwrap();
        s.register_assignment(Assignment {
            runner: "test".into(),
            model: "p/m".into(),
            executable: "hash".into(),
            content: crate::tasks::digest(crate::tasks::INVESTIGATOR.as_bytes()),
        })
        .unwrap();
        s
    }
    // Regression: a build whose compiled session policy changed refused every
    // connected turn ("Admitted native content is unavailable in this build")
    // because every project's recorded session_v1 selection kept the old digest.
    // Oracle: startup converges all projects to this build's content with one
    // new revision each, is idempotent, and historical revisions stay exact.
    #[test]
    fn compiled_content_change_refreshes_recorded_mode_selections() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a"); let b = d.path().join("b");
        std::fs::create_dir(&a).unwrap(); std::fs::create_dir(&b).unwrap();
        let path = d.path().join("state.db");
        let (b_root, stale_revision) = {
            let mut s = Store::open(&path, a.to_str().unwrap()).unwrap();
            let b_root = s.register_project(b.to_str().unwrap()).unwrap().root;
            let mut old = definitions().into_iter().find(|d| d.modes.iter().any(|m| m == "session_v1")).unwrap();
            old.body = "Previous build's session continuity policy".into();
            old.digest = digest(old.body.as_bytes());
            s.conn.execute("INSERT INTO definitions VALUES(?1,?2)", params![old.digest, serde_json::to_string(&old).unwrap()]).unwrap();
            let mut stale_revision = 0;
            for root in [a.to_str().unwrap(), b_root.as_str()] {
                let mut c = s.configuration_for(root).unwrap();
                c.revision = s.next_configuration_revision().unwrap();
                c.definitions.push(old.digest.clone());
                c.modes.insert("session_v1".into(), vec![old.digest.clone()]);
                s.save_configuration(&c).unwrap();
                stale_revision = c.revision;
            }
            (b_root, stale_revision)
        };
        let s = Store::open(&path, a.to_str().unwrap()).unwrap();
        let expected = s.admission_definition_ids(&deck2_shared::Mode::SessionV1).unwrap();
        for root in [a.to_str().unwrap(), b_root.as_str()] {
            assert_eq!(s.configuration_for(root).unwrap().modes["session_v1"], expected, "{root}");
        }
        assert_eq!(s.admission_snapshot(&deck2_shared::Mode::SessionV1).unwrap().definitions, expected);
        let stale: String = s.conn.query_row("SELECT body FROM configurations WHERE revision=?1", [stale_revision as i64], |r| r.get(0)).unwrap();
        assert_ne!(serde_json::from_str::<Configuration>(&stale).unwrap().modes["session_v1"], expected, "history is not rewritten");
        let revisions = |s: &Store| s.conn.query_row("SELECT count(*) FROM configurations", [], |r| r.get::<_, i64>(0)).unwrap();
        let before = revisions(&s);
        drop(s);
        let s = Store::open(&path, a.to_str().unwrap()).unwrap();
        assert_eq!(revisions(&s), before, "an unchanged build records no new revision");
    }
    // Protects atomic activation if the operation receipt cannot be persisted.
    // Protects legacy state migration and host-wide launch selection across projects.
    // Oracle: decision 11; historical revisions stay immutable, current projects converge.
    #[test]
    fn settings_model_migrates_legacy_projects_and_launch_selection() {
        let d = tempfile::tempdir().unwrap();
        let a=d.path().join("a"); let b=d.path().join("b");
        std::fs::create_dir(&a).unwrap(); std::fs::create_dir(&b).unwrap();
        let path=d.path().join("state.db");
        let mut s=Store::open(&path,a.to_str().unwrap()).unwrap();
        s.register_project(b.to_str().unwrap()).unwrap();
        s.conn.execute("DELETE FROM meta WHERE key='settings_model_v1'",[]).unwrap();
        let mut old=s.configuration_for(b.to_str().unwrap()).unwrap();
        old.revision=s.next_configuration_revision().unwrap();
        old.team_enabled=false;
        old.helper=Some(crate::managed_tools::release("0.50.0").unwrap().selection);
        s.save_configuration(&old).unwrap();
        drop(s);
        let mut s=Store::open(&path,a.to_str().unwrap()).unwrap();
        for root in [&a,&b] {
            let c=s.configuration_for(root.to_str().unwrap()).unwrap();
            assert!(c.team_enabled);
            assert_eq!(c.helper,Some(crate::managed_tools::release("1.2.0").unwrap().selection));
            s.register_assignment_for(root.to_str().unwrap(),Assignment{runner:"opencode".into(),model:"fixture".into(),executable:"a".repeat(64),content:"b".repeat(64)}).unwrap();
            assert_eq!(s.admission_snapshot_for(root.to_str().unwrap(),&deck2_shared::Mode::Team).unwrap().helper,c.helper);
        }
        let historical:String=s.conn.query_row("SELECT body FROM configurations WHERE revision=?1",[old.revision],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Configuration>(&historical).unwrap(),old);
        assert_eq!(s.conn.query_row("PRAGMA quick_check",[],|r|r.get::<_,String>(0)).unwrap(),"ok");
        // New projects inherit the host choice and a disable reaches every launch.
        let third=d.path().join("third");std::fs::create_dir(&third).unwrap();
        s.register_project(third.to_str().unwrap()).unwrap();
        assert!(s.configuration_for(third.to_str().unwrap()).unwrap().helper.is_some());
        s.select_host_helper(None).unwrap();
        for root in [&a,&b,&third] {assert!(s.configuration_for(root.to_str().unwrap()).unwrap().helper.is_none());}
        drop(s);
        let s=Store::open(&path,a.to_str().unwrap()).unwrap();
        assert!(s.configuration().unwrap().helper.is_none(),"reopening must preserve an explicit host disable");
    }
    #[test]
    fn management_storage_failure_rolls_back_selection() {
        let mut s = prepared();
        let c = s.configuration().unwrap();
        let p = s
            .plan_configuration(
                &PlanRequest {
                    api: API,
                    expected_revision: c.revision,
                    team_enabled: false,
                },
                &c.qualification(),
            )
            .unwrap();
        s.conn.execute_batch("CREATE TRIGGER fail_management BEFORE INSERT ON management_operations BEGIN SELECT RAISE(ABORT,'receipt fault'); END;").unwrap();
        let r = ApplyRequest {
            api: API,
            operation_id: "storage-fault".into(),
            allow: true,
        };
        assert!(
            s.apply_configuration(&p.id, &r, &c.qualification())
                .is_err()
        );
        assert_eq!(s.configuration().unwrap(), c);
        assert!(s.operation_not_recorded(&r.operation_id));
        s.conn
            .execute_batch("DROP TRIGGER fail_management")
            .unwrap();
        assert_eq!(
            s.apply_configuration(&p.id, &r, &c.qualification())
                .unwrap()
                .phase,
            "applied"
        );
    }
    #[test]
    fn missing_team_content_does_not_block_unrelated_readonly_admission() {
        let s = prepared();
        let inv = crate::tasks::digest(crate::tasks::INVESTIGATOR.as_bytes());
        s.conn
            .execute("DELETE FROM definitions WHERE digest=?1", [inv])
            .unwrap();
        assert!(s.admission_snapshot(&deck2_shared::Mode::Team).is_err());
        assert!(s.admission_snapshot(&deck2_shared::Mode::ReadOnly).is_ok());
    }
    #[test]
    fn legacy_content_remains_unknown_and_corrupt_five_is_not_repaired() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let mut s = Store::open(&path, "/fixture").unwrap();
        let mut r = s
            .accept(&deck2_shared::Submit {
                attachments: Vec::new(),
                api: API,
                id: "legacy-command".into(),
                mode: deck2_shared::Mode::ReadOnly,
                prompt: "hello".into(),
            })
            .unwrap();
        r.configuration = None;
        r.phase = deck2_shared::Phase::Completed;
        s.save(&mut r).unwrap();
        s.conn.execute_batch("DROP TABLE projects; UPDATE sessions SET body=json_remove(body,'$.project'); UPDATE receipts SET body=json_remove(body,'$.configuration.project'); UPDATE tasks SET body=json_remove(body,'$.project'); DROP TABLE decision_replies; DROP TABLE decision_commands; DROP TABLE session_decisions; DROP TABLE session_events; DROP TABLE management_operations; DROP TABLE configuration_plans; DROP TABLE configurations; DROP TABLE definitions; UPDATE meta SET value='4' WHERE key='schema';").unwrap();
        drop(s);
        let s = Store::open(&path, "/fixture").unwrap();
        assert!(s.get(&r.id).unwrap().unwrap().configuration.is_none());
        s.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; UPDATE definitions SET body='{}';").unwrap();
        drop(s);
        let before = std::fs::read(&path).unwrap();
        assert!(Store::open(&path, "/fixture").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    #[test]
    fn schema_four_configuration_migration_rolls_back_on_storage_fault() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let s = Store::open(&path, "/fixture").unwrap();
        s.conn.execute_batch("DROP TABLE projects; UPDATE sessions SET body=json_remove(body,'$.project'); UPDATE receipts SET body=json_remove(body,'$.configuration.project'); UPDATE tasks SET body=json_remove(body,'$.project'); DROP TABLE decision_replies; DROP TABLE decision_commands; DROP TABLE session_decisions; DROP TABLE session_events; DROP TABLE management_operations; DROP TABLE configuration_plans; DROP TABLE configurations; DROP TABLE definitions; UPDATE meta SET value='4' WHERE key='schema'; CREATE TRIGGER fail_migration BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT,'migration fault'); END; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;").unwrap();
        drop(s);
        let before = std::fs::read(&path).unwrap();
        assert!(Store::open(&path, "/fixture").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
