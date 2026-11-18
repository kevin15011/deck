//! Native opener dispatch is not proof of browser authentication.
use std::{
    os::unix::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn quote(value: &std::ffi::OsStr) -> String {
    format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
}
pub fn recovery(state: &Path) -> String {
    let executable = std::env::current_exe().unwrap_or_else(|_| "deck2".into());
    format!(
        "{} open --state-dir {}",
        quote(executable.as_os_str()),
        quote(state.as_os_str())
    )
}
pub fn guidance(state: &Path) -> String {
    let command = recovery(state);
    format!(
        "Open/reopen: {command}\nManual private link: {command} --print-url\nThe bare host address does not authenticate. Keep private launch links out of logs and shared terminals."
    )
}
fn candidates(wsl: bool) -> Vec<&'static str> {
    let mut result = vec!["xdg-open"];
    if wsl {
        result.extend(["wslview", "/mnt/c/Windows/explorer.exe"]);
    }
    result
}
pub fn open(url: &str) -> Result<(), &'static str> {
    let wsl =
        std::env::var_os("WSL_DISTRO_NAME").is_some() || std::env::var_os("WSL_INTEROP").is_some();
    for program in candidates(wsl) {
        let mut child = match Command::new(program)
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
        {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("Cannot start browser opener"),
        };
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        Ok(())
                    } else {
                        Err("Browser opener reported failure; browser delivery is unconfirmed")
                    };
                }
                Ok(None) if start.elapsed() < Duration::from_secs(3) => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                outcome => {
                    // Own the process group so a hung wrapper's children cannot keep
                    // this invocation alive. Never retry a dispatched opener: it may
                    // already have delivered a tab even if its status is ambiguous.
                    unsafe {
                        libc::kill(-(child.id() as i32), libc::SIGKILL);
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(if outcome.is_err() {
                        "Cannot observe browser opener; browser delivery is unconfirmed"
                    } else {
                        "Browser opener timed out; browser delivery is unconfirmed"
                    });
                }
            }
        }
    }
    Err("No supported browser opener is available")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_candidates() {
        assert_eq!(candidates(false), ["xdg-open"]);
        assert_eq!(
            candidates(true),
            ["xdg-open", "wslview", "/mnt/c/Windows/explorer.exe"]
        );
    }
}
