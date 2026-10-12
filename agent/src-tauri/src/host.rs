//! Native messaging host mode: Edge starts dopadam.exe with the extension origin as argument.
//!
//! It only relays messages: Edge's stdio framing (4-byte length + JSON) on one side, the agent's
//! named pipe (one JSON object per line) on the other. When the agent is not running it answers
//! {"type":"agent_offline"} and exits, and the extension keeps working on its own.
use std::io::{Read, Write};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ClientOptions;

use crate::nmhost::PIPE_NAME;
/// Edge refuses messages from the host larger than 1 MB.
const MAX_OUT: usize = 1024 * 1024;

fn write_frame(out: &mut impl Write, json: &str) -> std::io::Result<()> {
    if json.len() > MAX_OUT {
        return Ok(());
    }
    out.write_all(&(json.len() as u32).to_ne_bytes())?;
    out.write_all(json.as_bytes())?;
    out.flush()
}

fn read_frame(input: &mut impl Read) -> std::io::Result<Option<String>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let mut buf = vec![0u8; u32::from_ne_bytes(len) as usize];
    input.read_exact(&mut buf)?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

/// True when Edge started this executable as the extension's native messaging host.
pub fn is_host_invocation() -> bool {
    std::env::args().skip(1).any(|a| a.starts_with("chrome-extension://"))
}

pub fn run_relay() {
    tokio::runtime::Builder::new_current_thread().enable_all().build().expect("runtime").block_on(relay());
}

async fn relay() {
    let client = match ClientOptions::new().open(PIPE_NAME) {
        Ok(c) => c,
        Err(_) => {
            let _ = write_frame(&mut std::io::stdout().lock(), r#"{"type":"agent_offline"}"#);
            return;
        }
    };
    let (pipe_read, mut pipe_write) = tokio::io::split(client);

    // Extension → agent: stdin is blocking, so read it on its own thread.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        while let Ok(Some(msg)) = read_frame(&mut stdin) {
            // The pipe protocol is one JSON object per line.
            if tx.send(msg.replace('\n', " ")).is_err() {
                break;
            }
        }
    });
    let to_agent = async move {
        while let Some(msg) = rx.recv().await {
            if pipe_write.write_all(format!("{msg}\n").as_bytes()).await.is_err() {
                break;
            }
        }
    };

    // Agent → extension.
    let to_extension = async move {
        let mut lines = BufReader::new(pipe_read).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if write_frame(&mut std::io::stdout().lock(), &line).is_err() {
                break;
            }
        }
    };

    // Either side closing ends the relay.
    tokio::select! {
        _ = to_agent => {}
        _ = to_extension => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let mut buf = vec![];
        write_frame(&mut buf, r#"{"type":"ping"}"#).unwrap();
        assert_eq!(&buf[..4], &(15u32).to_ne_bytes());
        let mut cursor = std::io::Cursor::new(buf);
        assert_eq!(read_frame(&mut cursor).unwrap().as_deref(), Some(r#"{"type":"ping"}"#));
        assert_eq!(read_frame(&mut cursor).unwrap(), None);
    }
}
