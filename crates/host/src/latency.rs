//! Bounded, metadata-only latency attribution for send admission.
//!
//! Everything here is monotonic microseconds from one process epoch. Records
//! hold only static tags and numbers: no prompts, paths, secrets or history.
//! There is no polling and no scan of persisted state; a fixed ring of recent
//! lock holds lets a later sender name what delayed it.
use std::{
    cell::Cell,
    collections::VecDeque,
    sync::{
        LazyLock, Mutex, MutexGuard,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

const HOLDS: usize = 64;
const SUBMITS: usize = 64;
/// Waits below this are scheduling noise, not contention worth attributing.
const NOTABLE_US: u64 = 5_000;

static EPOCH: LazyLock<Instant> = LazyLock::new(Instant::now);
static RING: Mutex<VecDeque<Hold>> = Mutex::new(VecDeque::new());
static PENDING: Mutex<VecDeque<(String, Waits)>> = Mutex::new(VecDeque::new());
/// Admission locks taken out of the documented active -> history -> store order.
pub(crate) static ORDER_VIOLATIONS: AtomicU64 = AtomicU64::new(0);

tokio::task_local! {
    static RUN_WAIT: Cell<(u64, u64)>;
}

pub(crate) fn mono_us() -> u64 {
    EPOCH.elapsed().as_micros() as u64
}

#[derive(Clone, Copy)]
struct Hold {
    tag: &'static str,
    start: u64,
    end: u64,
}

/// Which admission lock a wait belongs to. Rank is the required acquisition order.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Lock {
    Active = 1,
    History = 2,
    Store = 3,
}

/// Per-command admission waits, in microseconds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Waits {
    pub active_us: u64,
    pub history_us: u64,
    pub store_us: u64,
    /// Waits on locks taken before the ordered trio (identity, owner lookup).
    pub pre_us: u64,
    /// Wall time from handler entry until all ordered locks were held.
    pub span_us: u64,
    pub blocker: &'static str,
    pub blocker_us: u64,
}

impl Waits {
    pub fn total_us(&self) -> u64 {
        self.active_us + self.history_us + self.store_us + self.pre_us
    }
    pub fn apply(&self, timing: &mut deck2_shared::StartupTiming) {
        timing.submit_lock_wait_us = self.total_us();
        timing.submit_active_wait_us = self.active_us;
        timing.submit_history_wait_us = self.history_us;
        timing.submit_store_wait_us = self.store_us;
        timing.submit_lock_span_us = self.span_us;
        timing.submit_blocker = self.blocker.into();
        timing.submit_blocker_us = self.blocker_us;
    }
}

/// One traced critical section over the admission locks.
pub(crate) struct Trace {
    tag: &'static str,
    requested: u64,
    first_held: Option<u64>,
    held_rank: u8,
    waits: Waits,
    released: bool,
}

impl Trace {
    pub fn new(tag: &'static str) -> Self {
        Self {
            tag,
            requested: mono_us(),
            first_held: None,
            held_rank: 0,
            waits: Waits::default(),
            released: false,
        }
    }

    /// Lock held across the section, in the documented order.
    pub fn lock<'a, T>(&mut self, mutex: &'a Mutex<T>, which: Lock) -> MutexGuard<'a, T> {
        let rank = which as u8;
        if rank <= self.held_rank {
            ORDER_VIOLATIONS.fetch_add(1, Ordering::Relaxed);
            debug_assert!(false, "admission lock order violated");
        }
        let before = mono_us();
        let guard = mutex.lock().unwrap();
        let after = mono_us();
        self.first_held.get_or_insert(after);
        self.held_rank = rank;
        let waited = after - before;
        match which {
            Lock::Active => self.waits.active_us += waited,
            Lock::History => self.waits.history_us += waited,
            Lock::Store => self.waits.store_us += waited,
        }
        guard
    }

    /// Short lock released before the ordered trio; only its wait is recorded.
    pub fn transient<'a, T>(&mut self, mutex: &'a Mutex<T>) -> MutexGuard<'a, T> {
        let before = mono_us();
        let guard = mutex.lock().unwrap();
        self.waits.pre_us += mono_us() - before;
        guard
    }

    /// Call once every ordered lock is held. Names what held the locks during the wait.
    pub fn acquired(&mut self) {
        let now = mono_us();
        self.waits.span_us = now - self.requested;
        if self.waits.total_us() >= NOTABLE_US {
            let ring = RING.lock().unwrap();
            let mut by_tag: Vec<(&'static str, u64)> = vec![];
            for hold in ring.iter() {
                let overlap = hold.end.min(now).saturating_sub(hold.start.max(self.requested));
                if overlap == 0 {
                    continue;
                }
                match by_tag.iter_mut().find(|(tag, _)| *tag == hold.tag) {
                    Some((_, total)) => *total += overlap,
                    None => by_tag.push((hold.tag, overlap)),
                }
            }
            let dominant = by_tag.into_iter().max_by_key(|(_, total)| *total);
            // A wait with no traced overlapping hold was caused by an untraced holder.
            self.waits.blocker = dominant.map_or("untraced", |(tag, _)| tag);
            self.waits.blocker_us = dominant.map_or(0, |(_, total)| total);
        }
    }

    pub fn waits(&self) -> &Waits {
        &self.waits
    }

    /// Record the hold before the caller drops the guards, so a waiter that
    /// acquires next always finds it. Idempotent.
    pub fn release(&mut self) -> Waits {
        if !std::mem::replace(&mut self.released, true)
            && let Some(start) = self.first_held
        {
            let mut ring = RING.lock().unwrap();
            if ring.len() == HOLDS {
                ring.pop_front();
            }
            ring.push_back(Hold {
                tag: self.tag,
                start,
                end: mono_us(),
            });
        }
        self.waits.clone()
    }
}

impl Drop for Trace {
    fn drop(&mut self) {
        self.release();
    }
}

/// Keep the submit-side waits until the command's run dispatches. Bounded.
pub(crate) fn remember_submit(id: &str, waits: Waits) {
    let mut pending = PENDING.lock().unwrap();
    if pending.len() == SUBMITS {
        pending.pop_front();
    }
    pending.push_back((id.to_owned(), waits));
}

pub(crate) fn take_submit(id: &str) -> Option<Waits> {
    let mut pending = PENDING.lock().unwrap();
    let at = pending.iter().position(|(key, _)| key == id)?;
    pending.remove(at).map(|(_, waits)| waits)
}

/// Lock a mutex and add its wait to the running command, when one is in scope.
pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    locked_checked(mutex).unwrap()
}

/// Same, preserving a poisoned lock as an error for callers that report it.
pub(crate) fn locked_checked<T>(
    mutex: &Mutex<T>,
) -> Result<MutexGuard<'_, T>, std::sync::PoisonError<MutexGuard<'_, T>>> {
    let before = mono_us();
    let guard = mutex.lock();
    let waited = mono_us() - before;
    let _ = RUN_WAIT.try_with(|cell| {
        let (total, count) = cell.get();
        cell.set((total + waited, count + 1));
    });
    guard
}

/// Run a command's whole task with a wait accumulator in scope.
pub(crate) async fn scoped<F: std::future::Future>(future: F) -> F::Output {
    RUN_WAIT.scope(Cell::new((0, 0)), future).await
}

/// Waits accumulated so far by the running command: (microseconds, acquisitions).
pub(crate) fn run_waits() -> (u64, u64) {
    RUN_WAIT.try_with(|cell| cell.get()).unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, time::Duration};

    #[test]
    fn a_later_sender_names_the_holder_that_delayed_it() {
        let gate = Arc::new(Mutex::new(()));
        let (held_tx, held_rx) = std::sync::mpsc::channel();
        let holder = {
            let gate = gate.clone();
            std::thread::spawn(move || {
                let mut trace = Trace::new("workspace");
                let guard = trace.lock(&gate, Lock::Active);
                held_tx.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(80));
                trace.release();
                drop(guard);
            })
        };
        held_rx.recv().unwrap();
        let mut sender = Trace::new("submit");
        let _guard = sender.lock(&gate, Lock::Active);
        sender.acquired();
        holder.join().unwrap();
        let waits = sender.release();
        // The wait is real, is attributed to the traced holder, and the
        // components add up to no more than the wall span that contained them.
        assert!(waits.active_us >= 40_000, "{waits:?}");
        assert_eq!(waits.blocker, "workspace");
        assert!(waits.blocker_us >= 40_000 && waits.blocker_us <= waits.span_us);
        assert!(waits.total_us() <= waits.span_us);
    }

    #[test]
    fn idle_admission_reports_no_blocker() {
        let gate = Mutex::new(());
        let mut trace = Trace::new("submit");
        let _guard = trace.lock(&gate, Lock::Store);
        trace.acquired();
        assert_eq!(trace.waits().blocker, "");
        assert_eq!(trace.waits().blocker_us, 0);
    }

    #[test]
    fn untraced_holder_is_reported_as_such() {
        let gate = Arc::new(Mutex::new(()));
        let held = gate.lock().unwrap();
        let waiter = {
            let gate = gate.clone();
            std::thread::spawn(move || {
                let mut trace = Trace::new("submit");
                let _guard = trace.lock(&gate, Lock::Store);
                trace.acquired();
                trace.waits().clone()
            })
        };
        std::thread::sleep(Duration::from_millis(30));
        drop(held);
        let waits = waiter.join().unwrap();
        assert!(waits.store_us >= 10_000 && waits.total_us() >= NOTABLE_US);
        // Overlap may include other tests' holds in the shared ring, but never
        // the untraced one; the tag is either "untraced" or a traced neighbour.
        assert!(!waits.blocker.is_empty());
    }

    #[test]
    fn rings_stay_bounded() {
        for n in 0..(HOLDS + SUBMITS + 10) {
            let mut trace = Trace::new("bounded");
            let gate = Mutex::new(());
            let _guard = trace.lock(&gate, Lock::Active);
            trace.release();
            remember_submit(&format!("c{n}"), Waits::default());
        }
        assert!(RING.lock().unwrap().len() <= HOLDS);
        assert!(PENDING.lock().unwrap().len() <= SUBMITS);
        assert!(take_submit("c0").is_none(), "oldest entry evicted");
    }

    #[tokio::test]
    async fn run_scope_sums_waits_and_is_absent_outside() {
        assert_eq!(run_waits(), (0, 0));
        let gate = Mutex::new(());
        scoped(async {
            drop(locked(&gate));
            drop(locked(&gate));
            assert_eq!(run_waits().1, 2);
        })
        .await;
        assert_eq!(run_waits(), (0, 0));
    }
}
