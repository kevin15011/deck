//! Minimal Linux reservation keeper. After fork the child uses only fixed stack
//! storage and async-signal-safe syscalls, inherits no application descriptors,
//! never sends a destructive signal, and never executes application work.
use super::{Result, error};
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::{AsRawFd, FromRawFd},
};
pub(super) struct Guard {
    pub pid: i32,
    send: Option<File>,
    tracked: std::sync::atomic::AtomicUsize,
}
impl Guard {
    pub fn start(dir: &File, nonce: &str) -> Result<Self> {
        let marker = format!("\"nonce\":\"{nonce}\"").into_bytes();
        let mut pipe = [0; 2];
        if unsafe {
            libc::socketpair(
                libc::AF_UNIX,
                libc::SOCK_STREAM | libc::SOCK_CLOEXEC,
                0,
                pipe.as_mut_ptr(),
            )
        } != 0
        {
            return Err(error("cannot reserve process containment"));
        }
        let dirfd = dir.as_raw_fd();
        let maxfd = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) }.max(1024) as i32;
        let pid = unsafe { libc::fork() };
        if pid < 0 {
            unsafe {
                libc::close(pipe[0]);
                libc::close(pipe[1]);
            }
            return Err(error("cannot reserve process containment"));
        }
        if pid == 0 {
            unsafe {
                // No allocator, Rust IO, mutex, or destructor may run in this fork child.
                libc::setpgid(0, 0);
                let low = pipe[0].min(dirfd);
                let high = pipe[0].max(dirfd);
                let mut fallback = false;
                for (first, last) in [(0, low - 1), (low + 1, high - 1), (high + 1, i32::MAX)] {
                    if first <= last
                        && libc::syscall(libc::SYS_close_range, first as u32, last as u32, 0u32)
                            != 0
                    {
                        fallback = true;
                    }
                }
                if fallback {
                    for fd in 0..maxfd {
                        if fd != pipe[0] && fd != dirfd {
                            libc::close(fd);
                        }
                    }
                }
                let mut groups = [0i32; 8192];
                let mut count = 0usize;
                let mut word = [0u8; 4];
                let mut offset = 0;
                loop {
                    let n = libc::read(pipe[0], word[offset..].as_mut_ptr().cast(), 4 - offset);
                    if n == 0 {
                        break;
                    }
                    if n < 0 {
                        if *libc::__errno_location() == libc::EINTR {
                            continue;
                        }
                        loop {
                            libc::pause();
                        }
                    }
                    offset += n as usize;
                    if offset == 4 {
                        let group = i32::from_ne_bytes(word);
                        if group <= 0 || count == groups.len() {
                            loop {
                                libc::pause();
                            }
                        }
                        groups[count] = group;
                        count += 1;
                        offset = 0;
                        let ack = [1u8];
                        if libc::write(pipe[0], ack.as_ptr().cast(), 1) != 1 {
                            loop {
                                libc::pause();
                            }
                        }
                    }
                }
                if offset != 0 {
                    loop {
                        libc::pause();
                    }
                }
                loop {
                    let mut unknown = false;
                    for group in &groups[..count] {
                        if libc::kill(-*group, 0) == 0 || *libc::__errno_location() != libc::ESRCH {
                            unknown = true;
                            break;
                        }
                    }
                    if !unknown {
                        break;
                    }
                    let duration = libc::timespec {
                        tv_sec: 0,
                        tv_nsec: 100_000_000,
                    };
                    libc::nanosleep(&duration, std::ptr::null_mut());
                }
                // Remove only our nonce. Replaced, corrupt or unreadable locks are retained.
                let fd = libc::openat(
                    dirfd,
                    c"daemon.lock".as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK,
                );
                if fd >= 0 {
                    let mut body = [0u8; 8192];
                    let n = libc::read(fd, body.as_mut_ptr().cast(), body.len());
                    if n > 0
                        && body[..n as usize]
                            .windows(marker.len())
                            .any(|w| w == marker)
                    {
                        libc::unlinkat(dirfd, c"daemon.lock".as_ptr(), 0);
                        libc::fsync(dirfd);
                    }
                    libc::close(fd);
                }
                libc::_exit(0);
            }
        }
        unsafe {
            libc::close(pipe[0]);
            if libc::setpgid(pid, pid) != 0 {
                libc::close(pipe[1]);
                return Err(error("cannot contain reservation keeper"));
            }
            let timeout = libc::timeval {
                tv_sec: 2,
                tv_usec: 0,
            };
            libc::setsockopt(
                pipe[1],
                libc::SOL_SOCKET,
                libc::SO_RCVTIMEO,
                (&timeout as *const libc::timeval).cast(),
                std::mem::size_of::<libc::timeval>() as u32,
            );
        }
        Ok(Self {
            pid,
            tracked: std::sync::atomic::AtomicUsize::new(0),
            send: Some(unsafe { File::from_raw_fd(pipe[1]) }),
        })
    }
    pub fn track(&self, pid: u32) -> Result<()> {
        if pid == 0 || pid > i32::MAX as u32 {
            return Err(error("invalid owned process group"));
        }
        if self
            .tracked
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            >= 8192
        {
            return Err(error(
                "containment reservation capacity reached; settle work and restart",
            ));
        }
        let mut send = self
            .send
            .as_ref()
            .ok_or_else(|| error("original containment guard unavailable"))?;
        send.write_all(&(pid as i32).to_ne_bytes())
            .map_err(|_| error("original containment guard failed"))?;
        let mut ack = [0u8];
        send.read_exact(&mut ack)
            .map_err(|_| error("original containment registration unconfirmed"))?;
        if ack != [1] {
            return Err(error("original containment registration invalid"));
        }
        Ok(())
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        drop(self.send.take());
        let pid = self.pid;
        std::thread::spawn(move || unsafe {
            libc::waitpid(pid, std::ptr::null_mut(), 0);
        });
    }
}
