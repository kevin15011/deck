//! Ownership ledger, independent of the idle Native view. Locks never span I/O.
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum State {
    Loading,
    Leased,
    Idle,
    Retiring,
    Uncertain,
}
#[derive(Clone)]
pub(super) struct Template {
    process: std::sync::Weak<super::process::Process>,
    binary: std::path::PathBuf,
    management_identity: Option<String>,
    compatibility: String,
    hook_state: Option<serde_json::Value>,
}
impl Template {
    pub fn sibling(&self) -> Result<super::Native, String> {
        super::Native::sibling_process(
            self.process
                .upgrade()
                .filter(|p| p.alive())
                .ok_or("Retained process unavailable")?,
            self.binary.clone(),
            self.management_identity.clone(),
            true,
            self.hook_state.clone(),
        )
    }
}
struct Entry {
    group: String,
    state: State,
    template: Option<Template>,
}
#[derive(Default)]
pub(super) struct Registry {
    entries: Mutex<BTreeMap<String, Entry>>,
    changed: tokio::sync::Notify,
}
impl Registry {
    pub async fn wait_retiring(&self, session: &str) -> Result<(), String> {
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            loop {
                let wake = self.changed.notified();
                tokio::pin!(wake);
                wake.as_mut().enable();
                let retiring = self
                    .entries
                    .lock()
                    .unwrap()
                    .get(session)
                    .is_some_and(|e| e.state == State::Retiring);
                if !retiring {
                    return;
                }
                wake.await;
            }
        })
        .await
        .map_err(|_| "Retained native retirement is still owned; wait for settlement".to_string())
    }

    pub fn recover(&self, store: &crate::Store) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        for r in store.all()?.into_iter().filter(|r| {
            r.phase == deck2_shared::Phase::Uncertain && r.mode == deck2_shared::Mode::SessionV1
        }) {
            if !crate::member_integration::Integration::for_receipt(&r)
                .is_ok_and(|i| i.concurrent_lead())
            {
                continue;
            }
            let group = r
                .native_pid
                .map(|pid| format!("recovered-process:{pid}"))
                .unwrap_or_else(|| format!("recovered-unknown:{}", r.id));
            if entries
                .insert(
                    r.session,
                    Entry {
                        group,
                        state: State::Uncertain,
                        template: None,
                    },
                )
                .is_some()
            {
                return Err("Recovered retained ownership is ambiguous".into());
            }
        }
        Ok(())
    }
    pub fn release_stopped(&self, session: &str, pid: i32) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let Some(entry) = entries.get(session) else { return true };
        // Live leases own their cleanup. Only bootstrap creates these synthetic entries.
        if entry.state != State::Uncertain || entry.group != format!("recovered-process:{pid}") {
            return false;
        }
        entries.remove(session);
        self.changed.notify_waiters();
        true
    }
    pub fn session_state(&self, session: &str) -> Option<&'static str> {
        self.entries
            .lock()
            .unwrap()
            .get(session)
            .map(|e| match e.state {
                State::Loading => "loading",
                State::Leased => "leased",
                State::Idle => "idle",
                State::Retiring => "retiring",
                State::Uncertain => "uncertain",
            })
    }
    pub fn occupied(&self, session: &str) -> bool {
        self.entries
            .lock()
            .unwrap()
            .get(session)
            .is_some_and(|e| e.state != State::Idle)
    }
    pub fn group_available(&self, group: &str) -> bool {
        self.entries
            .lock()
            .unwrap()
            .values()
            .filter(|e| e.group == group)
            .all(|e| e.state == State::Idle)
    }
    pub fn compatible(&self, key: &str) -> Option<(String, Template)> {
        let entries = self.entries.lock().unwrap();
        entries.values().find_map(|entry| {
            let template = entry.template.as_ref()?;
            if template.compatibility != key
                || !template.process.upgrade().is_some_and(|p| p.alive())
                || entries.values().any(|e| {
                    e.group == entry.group && !matches!(e.state, State::Idle | State::Leased)
                })
            {
                return None;
            }
            Some((entry.group.clone(), template.clone()))
        })
    }
    pub fn counts(&self) -> (usize, usize) {
        let entries = self.entries.lock().unwrap();
        (
            entries.len(),
            entries
                .values()
                .map(|e| &e.group)
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
        )
    }
    pub fn reserve(self: &Arc<Self>, session: &str, group: Option<&str>) -> Result<Lease, String> {
        let mut entries = self.entries.lock().unwrap();
        if entries.contains_key(session) {
            return Err("Retained session already owns a native reservation".into());
        }
        if entries.len() >= super::reuse::MAX_THREADS {
            return Err("Retained thread capacity is occupied; no active owner evicted".into());
        }
        let groups = entries
            .values()
            .map(|e| e.group.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        if group.is_none() && groups.len() >= super::reuse::MAX_GROUPS {
            return Err("Retained process capacity is occupied; no active owner evicted".into());
        }
        if let Some(group) = group
            && (!groups.contains(group)
                || entries
                    .values()
                    .any(|e| e.group == group && !matches!(e.state, State::Idle | State::Leased)))
        {
            return Err("Retained process has an active operation; wait for settlement".into());
        }
        let group = group
            .map(str::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        entries.insert(
            session.into(),
            Entry {
                group: group.clone(),
                state: State::Loading,
                template: None,
            },
        );
        Ok(Lease {
            registry: self.clone(),
            session: session.into(),
            group,
            started: false,
            released: false,
        })
    }
}
/// Dropping a launched lease never releases capacity. The owner must explicitly
/// report observed process/thread and helper settlement.
pub(super) struct Lease {
    registry: Arc<Registry>,
    session: String,
    pub group: String,
    started: bool,
    released: bool,
}
impl Lease {
    pub fn state(&self, state: State) {
        if let Some(e) = self.registry.entries.lock().unwrap().get_mut(&self.session) {
            e.state = state;
        }
    }
    pub fn started(&mut self) {
        self.started = true;
        self.state(State::Loading);
    }
    pub fn prepared(&self, native: &super::Native, compatibility: &str) {
        let template = native
            .shared
            .as_ref()
            .filter(|_| native.initialized)
            .map(|p| Template {
                process: Arc::downgrade(p),
                binary: native.binary.clone(),
                management_identity: native.management_identity.clone(),
                compatibility: compatibility.into(),
                hook_state: native.hook_state.clone(),
            });
        if let Some(e) = self.registry.entries.lock().unwrap().get_mut(&self.session) {
            e.template = template;
            e.state = State::Leased;
        }
    }
    pub fn settle(mut self) {
        self.registry.entries.lock().unwrap().remove(&self.session);
        self.started = false;
        self.released = true;
        self.registry.changed.notify_waiters();
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if self.released {
            return;
        }
        let mut entries = self.registry.entries.lock().unwrap();
        if self.started {
            if let Some(e) = entries.get_mut(&self.session) {
                e.state = State::Uncertain;
            }
        } else {
            entries.remove(&self.session);
        }
        self.registry.changed.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Oracle: reservations include loading and uncertain owners. No I/O needed.
    #[test]
    fn loading_uncertain_and_retiring_owners_keep_capacity() {
        let registry = Arc::new(Registry::default());
        let mut leases = vec![];
        for i in 0..super::super::reuse::MAX_GROUPS {
            leases.push(registry.reserve(&format!("s{i}"), None).unwrap());
        }
        assert!(registry.reserve("overflow", None).is_err());
        let mut lost = leases.pop().unwrap();
        let group = lost.group.clone();
        lost.started();
        lost.state(State::Retiring);
        drop(lost);
        assert_eq!(registry.counts(), (4, 4));
        assert!(!registry.group_available(&group));
        assert!(registry.reserve("overflow", None).is_err());
        drop(leases); // Never launched: safe release.
        assert_eq!(registry.counts(), (1, 1));
    }
    #[test]
    fn loading_and_retirement_exclude_group_operations() {
        let registry = Arc::new(Registry::default());
        let mut a = registry.reserve("a", None).unwrap();
        let group = a.group.clone();
        a.started();
        assert!(registry.reserve("b", Some(&group)).is_err());
        a.state(State::Leased);
        let mut b = registry.reserve("b", Some(&group)).unwrap();
        b.started();
        assert_eq!(registry.counts(), (2, 1));
        assert!(!registry.group_available(&group));
        b.state(State::Retiring);
        b.settle();
        a.state(State::Idle);
        assert!(registry.group_available(&group));
        a.settle();
        assert_eq!(registry.counts(), (0, 0));
    }
}
