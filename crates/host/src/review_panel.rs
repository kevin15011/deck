//! Session-bound, read-only Review catalogs and selected documents.
mod catalog;
mod document;

use crate::{
    git_review,
    server::{App, problem},
};
use axum::{
    Json,
    extract::{OriginalUri, Path, Query, State},
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use catalog::{Catalog, Observation};
use deck2_shared::ProjectBinding;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    os::unix::fs::MetadataExt,
    path::Path as FsPath,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Semaphore, watch};

const GENERATION_TTL: Duration = Duration::from_secs(120);
const LATEST_TTL: Duration = Duration::from_secs(2);
const MAX_CATALOGS: usize = 8;
const MAX_CATALOG_BYTES: usize = 64 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug)]
struct Error {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

type Result<T> = std::result::Result<T, Error>;

const QUERY: Error = Error::new(
    StatusCode::BAD_REQUEST,
    "review_query",
    "Invalid Review parameters",
);
const SESSION: Error = Error::new(StatusCode::NOT_FOUND, "session", "Unknown session");
const ENTRY: Error = Error::new(
    StatusCode::NOT_FOUND,
    "review_entry",
    "Unknown Review entry",
);
const PROJECT: Error = Error::new(
    StatusCode::CONFLICT,
    "project",
    "The session project binding is unavailable or has changed",
);
const STALE: Error = Error::new(
    StatusCode::CONFLICT,
    "review_stale",
    "Review has changed. Reload the tree and select the entry again",
);
const BUSY: Error = Error::new(
    StatusCode::TOO_MANY_REQUESTS,
    "review_busy",
    "Review is busy. Try again shortly",
);
const UNSUPPORTED: Error = Error::unavailable(
    "unsupported_repository",
    "The project cannot be inspected with confined Git",
);
const LIMIT: Error = Error::unavailable(
    "review_limit",
    "The project exceeds the bounded Review scan",
);
const NO_REPOSITORY: Error =
    Error::unavailable("no_repository", "This project has no Git repository");
const NO_HEAD: Error = Error::unavailable("no_head", "This repository has no HEAD commit");
const NO_ORIGIN: Error = Error::unavailable(
    "no_origin_default",
    "This repository has no local origin default branch",
);
const NO_MERGE_BASE: Error = Error::unavailable(
    "no_merge_base",
    "HEAD and the local origin default have no available common ancestor",
);
const AMBIGUOUS: Error = Error::unavailable(
    "ambiguous_merge_base",
    "HEAD and the local origin default have multiple merge bases",
);

impl Error {
    const fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }

    const fn unavailable(code: &'static str, message: &'static str) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, code, message)
    }

    fn git(message: String) -> Self {
        if message.contains("changed while") {
            STALE
        } else if message.contains("limit") || message.contains("exceeds") {
            LIMIT
        } else {
            UNSUPPORTED
        }
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let mut response = problem(self.status, self.code, self.message);
        if self.status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, "1".parse().unwrap());
        }
        response
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum View {
    All,
    Changes,
    Diff,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum Request {
    Tree {
        view: View,
        limit: usize,
        generation: Option<String>,
        cursor: Option<String>,
        filter: String,
        fresh: bool,
    },
    File {
        view: View,
        generation: String,
        id: String,
        known: Option<String>,
    },
    Stats {
        view: View,
        generation: String,
        ids: Vec<String>,
    },
}

#[derive(Clone, Copy)]
enum Route {
    Tree,
    File,
    Stats,
}

impl Request {
    fn parse(uri: &Uri, route: Route) -> Result<Self> {
        if let Some(query) = uri.query() {
            validate_query_encoding(query)?;
        }
        let Query(pairs) = Query::<Vec<(String, String)>>::try_from_uri(uri).map_err(|_| QUERY)?;
        let mut fields = HashMap::new();
        let mut ids = Vec::new();
        for (key, value) in pairs {
            if key == "id" && matches!(route, Route::Stats) {
                ids.push(handle(value)?);
            } else if fields.insert(key, value).is_some() {
                return Err(QUERY);
            }
        }
        let view = match fields.remove("view").as_deref() {
            Some("all") => View::All,
            Some("changes") => View::Changes,
            Some("diff") => View::Diff,
            _ => return Err(QUERY),
        };
        let generation = fields.remove("generation").map(handle).transpose()?;
        let request = match route {
            Route::Tree => {
                let cursor = fields.remove("cursor").map(handle).transpose()?;
                let limit = match fields.remove("limit") {
                    Some(raw) if !raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit()) => raw
                        .parse::<usize>()
                        .ok()
                        .filter(|n| *n <= 1000)
                        .ok_or(QUERY)?,
                    Some(_) => return Err(QUERY),
                    None => 500,
                };
                let query = fields.remove("q").unwrap_or_default();
                if query.chars().count() > 256 {
                    return Err(QUERY);
                }
                let fresh = match fields.remove("fresh").as_deref() {
                    None => false,
                    Some("1") if generation.is_none() && cursor.is_none() => true,
                    _ => return Err(QUERY),
                };
                if cursor.is_some() && generation.is_none() {
                    return Err(QUERY);
                }
                Self::Tree {
                    view,
                    limit,
                    generation,
                    cursor,
                    filter: query,
                    fresh,
                }
            }
            Route::File => Self::File {
                view,
                generation: generation.ok_or(QUERY)?,
                id: handle(fields.remove("id").ok_or(QUERY)?)?,
                known: fields.remove("knownVersion").map(handle).transpose()?,
            },
            Route::Stats => {
                if !(1..=32).contains(&ids.len()) {
                    return Err(QUERY);
                }
                Self::Stats {
                    view,
                    generation: generation.ok_or(QUERY)?,
                    ids,
                }
            }
        };
        if !fields.is_empty() {
            return Err(QUERY);
        }
        Ok(request)
    }
}

fn validate_query_encoding(query: &str) -> Result<()> {
    if query.len() > 8192 {
        return Err(QUERY);
    }
    let mut decoded = Vec::with_capacity(query.len());
    let mut bytes = query.bytes();
    while let Some(byte) = bytes.next() {
        let value = if byte == b'%' {
            let hex = |byte: u8| (byte as char).to_digit(16).map(|digit| digit as u8);
            let hi = bytes.next().and_then(hex).ok_or(QUERY)?;
            let lo = bytes.next().and_then(hex).ok_or(QUERY)?;
            (hi << 4) | lo
        } else {
            byte
        };
        decoded.push(value);
    }
    std::str::from_utf8(&decoded).map_err(|_| QUERY)?;
    Ok(())
}

fn handle(value: String) -> Result<String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err(QUERY);
    }
    Ok(value)
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Scope {
    session: String,
    project: String,
    identity: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Flight {
    scope: Scope,
    request: Request,
}

type Outcome = Result<Arc<Value>>;
type InFlight = watch::Receiver<Option<Outcome>>;

pub(crate) struct Runtime {
    gate: Arc<Semaphore>,
    catalogs: Mutex<VecDeque<(Scope, Arc<Catalog>)>>,
    in_flight: Mutex<HashMap<Flight, InFlight>>,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            gate: Arc::new(Semaphore::new(2)),
            catalogs: Mutex::new(VecDeque::new()),
            in_flight: Mutex::new(HashMap::new()),
        }
    }
}

impl Runtime {
    #[cfg(test)]
    pub(crate) fn occupy(&self) -> tokio::sync::OwnedSemaphorePermit {
        self.gate.clone().try_acquire_many_owned(2).unwrap()
    }

    fn catalog(&self, scope: &Scope, view: View, generation: Option<&str>) -> Option<Arc<Catalog>> {
        let mut catalogs = self.catalogs.lock().unwrap();
        catalogs.retain(|(_, catalog)| catalog.created.elapsed() < GENERATION_TTL);
        catalogs
            .iter()
            .rev()
            .find(|(owner, catalog)| {
                owner == scope
                    && catalog.view == view
                    && generation.map_or_else(
                        || catalog.created.elapsed() < LATEST_TTL,
                        |generation| generation == catalog.generation,
                    )
            })
            .map(|(_, catalog)| catalog.clone())
    }

    fn insert(&self, scope: Scope, catalog: Arc<Catalog>) {
        let mut catalogs = self.catalogs.lock().unwrap();
        let mut bytes: usize = catalogs.iter().map(|(_, c)| c.bytes).sum();
        while catalogs.len() >= MAX_CATALOGS || bytes + catalog.bytes > MAX_CATALOG_BYTES {
            let Some((_, oldest)) = catalogs.pop_front() else {
                break;
            };
            bytes -= oldest.bytes;
        }
        catalogs.push_back((scope, catalog));
    }
}

pub(crate) async fn tree(
    State(app): State<App>,
    Path(session): Path<String>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    dispatch(app, session, uri, Route::Tree).await
}

pub(crate) async fn file(
    State(app): State<App>,
    Path(session): Path<String>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    dispatch(app, session, uri, Route::File).await
}

pub(crate) async fn stats(
    State(app): State<App>,
    Path(session): Path<String>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    dispatch(app, session, uri, Route::Stats).await
}

fn bound_project(app: &App, session: &str) -> Result<ProjectBinding> {
    let store = app.store.lock().unwrap();
    store.session_by_id(session).map_err(|_| SESSION)?;
    store.execution_project(session).map_err(|_| PROJECT)
}

fn bound_root(project: &ProjectBinding) -> Result<File> {
    let root = git_review::directory(FsPath::new(&project.root)).map_err(|_| PROJECT)?;
    let metadata = root.metadata().map_err(|_| PROJECT)?;
    if project.identity.as_deref() != Some(&format!("{}:{}", metadata.dev(), metadata.ino())) {
        return Err(PROJECT);
    }
    Ok(root)
}

async fn dispatch(app: App, session: String, uri: Uri, route: Route) -> Response {
    async fn request(app: App, session: String, uri: Uri, route: Route) -> Outcome {
        let request = Request::parse(&uri, route)?;
        let project = bound_project(&app, &session)?;
        let root = bound_root(&project)?;
        let scope = Scope {
            session,
            project: project.id.clone(),
            identity: project.identity.clone().ok_or(PROJECT)?,
        };
        let runtime = &app.review_panel;
        if let Request::Tree {
            view,
            limit,
            generation,
            cursor,
            filter,
            fresh: false,
        } = &request
        {
            if let Some(catalog) = runtime.catalog(&scope, *view, generation.as_deref()) {
                return catalog
                    .page(*limit, cursor.as_deref(), filter)
                    .map(Arc::new);
            }
            if generation.is_some() {
                return Err(STALE);
            }
        }

        let flight = Flight { scope, request };
        let mut result = {
            let mut active = runtime.in_flight.lock().unwrap();
            if let Some(result) = active.get(&flight) {
                result.clone()
            } else {
                let permit = runtime.gate.clone().try_acquire_owned().map_err(|_| BUSY)?;
                let (done, result) = watch::channel(None);
                active.insert(flight.clone(), result.clone());
                let app = app.clone();
                let work = flight.clone();
                tokio::spawn(async move {
                    let worker = app.clone();
                    let outcome = tokio::task::spawn_blocking(move || {
                        execute(&worker, work, project, root, Arc::new(permit))
                    })
                    .await
                    .unwrap_or(Err(UNSUPPORTED))
                    .map(Arc::new);
                    let mut active = app.review_panel.in_flight.lock().unwrap();
                    active.remove(&flight);
                    done.send_replace(Some(outcome));
                });
                result
            }
        };
        result
            .wait_for(Option::is_some)
            .await
            .map_err(|_| UNSUPPORTED)?
            .clone()
            .ok_or(UNSUPPORTED)?
    }

    let response = match request(app, session, uri, route).await {
        Ok(value) => Json(value.as_ref()).into_response(),
        Err(error) => error.into_response(),
    };
    let mut response = response;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

fn execute(
    app: &App,
    flight: Flight,
    project: ProjectBinding,
    root: File,
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<Value> {
    let verify = || -> Result<()> {
        if bound_project(app, &flight.scope.session)? != project {
            return Err(PROJECT);
        }
        bound_root(&project)?;
        Ok(())
    };
    let deadline = Instant::now() + DEADLINE;
    let runtime = &app.review_panel;
    let open = |view| Observation::open(&project, &root, permit.clone(), deadline, view);
    let result = match flight.request {
        Request::Tree {
            view,
            limit,
            cursor,
            filter,
            ..
        } => {
            let observation = open(view)?;
            let catalog = Arc::new(observation.catalog()?);
            observation.check_budget()?;
            let page = catalog.page(limit, cursor.as_deref(), &filter)?;
            observation.verify_metadata()?;
            verify()?;
            runtime.insert(flight.scope, catalog);
            return Ok(page);
        }
        Request::File {
            view,
            generation,
            id,
            known,
        } => {
            let catalog = runtime
                .catalog(&flight.scope, view, Some(&generation))
                .ok_or(STALE)?;
            let row = catalog.entry(&id)?;
            if row.entry.kind == catalog::Kind::Directory {
                return Err(ENTRY);
            }
            let observation = open(view).map_err(stale_baseline)?;
            let current = observation.selected(&catalog, &[row])?;
            let file = document::file(
                &observation,
                &catalog,
                row,
                current[0].as_ref(),
                known.as_deref(),
            )?;
            observation.verify_metadata()?;
            file
        }
        Request::Stats {
            view,
            generation,
            ids,
        } => {
            let catalog = runtime
                .catalog(&flight.scope, view, Some(&generation))
                .ok_or(STALE)?;
            let rows = ids
                .iter()
                .map(|id| {
                    catalog
                        .entry(id)
                        .and_then(|row| row.entry.status.is_some().then_some(row).ok_or(ENTRY))
                })
                .collect::<Result<Vec<_>>>()?;
            let observation = open(view).map_err(stale_baseline)?;
            let current = observation.selected(&catalog, &rows)?;
            let stats = document::stats(&observation, &catalog, &rows, &current)?;
            observation.verify_metadata()?;
            stats
        }
    };
    verify()?;
    Ok(result)
}

fn stale_baseline(error: Error) -> Error {
    if matches!(
        error.code,
        "no_repository"
            | "no_head"
            | "no_origin_default"
            | "no_merge_base"
            | "ambiguous_merge_base"
    ) {
        STALE
    } else {
        error
    }
}
