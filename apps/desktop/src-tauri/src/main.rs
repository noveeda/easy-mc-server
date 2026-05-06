use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

const PREPARE_ROOM: &str = "desktop_prepare_room";
const OPEN_ROOM: &str = "desktop_open_room";
const CLOSE_ROOM: &str = "desktop_close_room";
const RESTART_ROOM: &str = "desktop_restart_room";
const SEND_SERVER_COMMAND: &str = "desktop_send_server_command";
const STATUS_ROOM: &str = "desktop_status_room";
const RESET_ROOM: &str = "desktop_reset_room";
const NODE_PATH_ENV: &str = "EASY_MC_NODE_PATH";
const RUNTIME_EVENT_NAME: &str = "desktop-runtime-event";

type PendingResponses = Arc<Mutex<HashMap<u64, mpsc::Sender<String>>>>;

#[derive(Default)]
struct DesktopCommandBroker {
    state: Mutex<BrokerState>,
}

#[derive(Default)]
struct BrokerState {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending_responses: Option<PendingResponses>,
    next_id: u64,
}

#[tauri::command]
fn desktop_prepare_room(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, PREPARE_ROOM, request)
}

#[tauri::command]
fn desktop_open_room(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, OPEN_ROOM, request)
}

#[tauri::command]
fn desktop_close_room(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, CLOSE_ROOM, request)
}

#[tauri::command]
fn desktop_restart_room(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, RESTART_ROOM, request)
}

#[tauri::command]
fn desktop_send_server_command(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, SEND_SERVER_COMMAND, request)
}

#[tauri::command]
fn desktop_status_room(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, STATUS_ROOM, request)
}

#[tauri::command]
fn desktop_reset_room(app: tauri::AppHandle, state: tauri::State<'_, DesktopCommandBroker>, request: Option<Value>) -> Value {
    invoke_desktop_command(&app, &state, RESET_ROOM, request)
}

fn invoke_desktop_command(
    app: &tauri::AppHandle,
    broker: &tauri::State<'_, DesktopCommandBroker>,
    command: &str,
    request: Option<Value>,
) -> Value {
    let sanitized_request = match sanitize_request(command, request) {
        Ok(value) => value,
        Err(error) => return error,
    };

    let mut state = match broker.state.lock() {
        Ok(state) => state,
        Err(_) => return blocked_dto("broker_unavailable", "Desktop command broker is unavailable."),
    };

    let first_response = send_node_host_frame(app, &mut state, command, sanitized_request.clone());
    if should_retry_after_stale_host_response(command, &first_response) {
        clear_node_host(&mut state);
        return send_node_host_frame(app, &mut state, command, sanitized_request);
    }

    first_response
}

fn send_node_host_frame(app: &tauri::AppHandle, state: &mut BrokerState, command: &str, sanitized_request: Value) -> Value {
    if let Err(error) = ensure_node_host(app, state) {
        return error;
    }

    state.next_id += 1;
    let id = state.next_id;
    let frame = json!({
        "id": id,
        "command": command,
        "request": sanitized_request
    });
    let frame_text = match serde_json::to_string(&frame) {
        Ok(text) if text.len() <= MAX_REQUEST_BYTES => text,
        Ok(_) => return blocked_dto("request_too_large", "Desktop command request is too large."),
        Err(_) => return blocked_dto("invalid_request", "Desktop command request is invalid."),
    };

    let stdin = match state.stdin.as_mut() {
        Some(stdin) => stdin,
        None => return blocked_dto("node_host_unavailable", "Desktop command host is unavailable."),
    };

    let pending_responses = match state.pending_responses.as_ref() {
        Some(pending_responses) => pending_responses.clone(),
        None => return blocked_dto("node_host_unavailable", "Desktop command host is unavailable."),
    };
    let (response_tx, response_rx) = mpsc::channel();
    if register_pending_response(&pending_responses, id, response_tx).is_err() {
        return blocked_dto("node_host_unavailable", "Desktop command host is unavailable.");
    }

    if stdin.write_all(frame_text.as_bytes()).is_err() || stdin.write_all(b"\n").is_err() || stdin.flush().is_err() {
        remove_pending_response(&pending_responses, id);
        clear_node_host(state);
        return blocked_dto("node_host_write_failed", "Desktop command host did not accept the request.");
    }

    let response_line = match response_rx.recv_timeout(COMMAND_TIMEOUT) {
        Ok(line) => line,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            remove_pending_response(&pending_responses, id);
            clear_node_host(state);
            return blocked_dto("node_runner_timeout", "Desktop command host timed out.");
        }
        Err(_) => {
            remove_pending_response(&pending_responses, id);
            clear_node_host(state);
            return blocked_dto("node_host_closed", "Desktop command host closed unexpectedly.");
        }
    };

    if response_line.len() > MAX_RESPONSE_BYTES {
        clear_node_host(state);
        return blocked_dto("node_response_too_large", "Desktop command response is too large.");
    }

    parse_host_response(id, &response_line)
}

fn should_retry_after_stale_host_response(command: &str, response: &Value) -> bool {
    is_known_command(command)
        && response
            .get("failure")
            .and_then(|failure| failure.get("reason"))
            .and_then(Value::as_str)
            .is_some_and(|reason| matches!(reason, "unknown_command" | "command_unavailable"))
}

fn ensure_node_host(app: &tauri::AppHandle, state: &mut BrokerState) -> Result<(), Value> {
    if let Some(child) = state.child.as_mut() {
        match child.try_wait() {
            Ok(None) => return Ok(()),
            Ok(Some(_)) | Err(_) => clear_node_host(state),
        }
    }

    let script = node_host_script_path();
    if !script.is_file() {
        return Err(blocked_dto("node_host_missing", "Desktop command host script is missing."));
    }

    let mut child = Command::new(node_command())
        .arg(&script)
        .current_dir(desktop_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| blocked_dto("node_host_missing", "Node.js is required for this desktop dev bridge."))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| blocked_dto("node_host_unavailable", "Desktop command host stdin is unavailable."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| blocked_dto("node_host_unavailable", "Desktop command host stdout is unavailable."))?;

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                line.clear();
            }
        });
    }

    let pending_responses: PendingResponses = Arc::new(Mutex::new(HashMap::new()));
    let stdout_pending_responses = pending_responses.clone();
    let stdout_app = app.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end_matches(&['\r', '\n'][..]).to_string();
                    route_node_host_stdout_line(&stdout_app, &stdout_pending_responses, trimmed);
                }
                Err(_) => break,
            }
        }
    });

    state.child = Some(child);
    state.stdin = Some(stdin);
    state.pending_responses = Some(pending_responses);
    Ok(())
}

fn clear_node_host(state: &mut BrokerState) {
    state.stdin = None;
    state.pending_responses = None;
    if let Some(mut child) = state.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn register_pending_response(
    pending_responses: &PendingResponses,
    id: u64,
    sender: mpsc::Sender<String>,
) -> Result<(), ()> {
    match pending_responses.lock() {
        Ok(mut pending) => {
            pending.insert(id, sender);
            Ok(())
        }
        Err(_) => Err(()),
    }
}

fn remove_pending_response(pending_responses: &PendingResponses, id: u64) {
    if let Ok(mut pending) = pending_responses.lock() {
        pending.remove(&id);
    }
}

fn route_node_host_stdout_line(
    app: &tauri::AppHandle,
    pending_responses: &PendingResponses,
    response_line: String,
) {
    if response_line.len() > MAX_RESPONSE_BYTES {
        return;
    }

    let Ok(parsed) = serde_json::from_str::<Value>(&response_line) else {
        return;
    };

    if parsed
        .get("event")
        .and_then(Value::as_str)
        .is_some_and(|event| event == "desktop_runtime_event")
    {
        let payload = parsed.get("payload").cloned().unwrap_or_else(|| json!({}));
        let _ = app.emit(RUNTIME_EVENT_NAME, sanitize_response(payload));
        return;
    }

    let Some(id) = parsed.get("id").and_then(Value::as_u64) else {
        return;
    };

    let sender = match pending_responses.lock() {
        Ok(mut pending) => pending.remove(&id),
        Err(_) => None,
    };

    if let Some(sender) = sender {
        let _ = sender.send(response_line);
    }
}

fn parse_host_response(expected_id: u64, response_line: &str) -> Value {
    let parsed: Value = match serde_json::from_str(response_line) {
        Ok(value) => value,
        Err(_) => return blocked_dto("invalid_node_response", "Desktop command host returned invalid JSON."),
    };

    if parsed.get("id").and_then(Value::as_u64) != Some(expected_id) {
        return blocked_dto("node_response_mismatch", "Desktop command host returned an unexpected response.");
    }

    let result = parsed.get("result").cloned().unwrap_or_else(|| {
        blocked_dto("empty_node_response", "Desktop command host returned an empty response.")
    });

    sanitize_response(result)
}

fn sanitize_request(command: &str, request: Option<Value>) -> Result<Value, Value> {
    let value = request.unwrap_or_else(|| json!({}));
    let object = match value {
        Value::Object(object) => object,
        _ => return Err(blocked_dto("invalid_request", "Desktop command request must be an object.")),
    };

    for key in object.keys() {
        if !allowed_fields_for_command(command).contains(&key.as_str()) || is_dangerous_key(key) {
            return Err(blocked_dto(
                "invalid_request",
                "Desktop command request contains unsupported fields.",
            ));
        }
    }

    for (key, value) in object.iter() {
        if !is_valid_request_value(key, value) {
            return Err(blocked_dto(
                "invalid_request",
                "Desktop command request contains invalid values.",
            ));
        }
    }

    Ok(Value::Object(object))
}

fn allowed_fields_for_command(command: &str) -> &'static [&'static str] {
    match command {
        PREPARE_ROOM | OPEN_ROOM | RESTART_ROOM => &["minecraftVersion", "pack", "catalogModId"],
        SEND_SERVER_COMMAND => &["command"],
        CLOSE_ROOM | STATUS_ROOM | RESET_ROOM => &[],
        _ => &[],
    }
}

fn is_known_command(command: &str) -> bool {
    matches!(
        command,
        PREPARE_ROOM
            | OPEN_ROOM
            | CLOSE_ROOM
            | RESTART_ROOM
            | SEND_SERVER_COMMAND
            | STATUS_ROOM
            | RESET_ROOM
    )
}

fn is_valid_request_value(key: &str, value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };

    match key {
        "minecraftVersion" => is_safe_text(text, 32, true),
        "pack" => is_safe_text(text, 64, false),
        "command" => is_safe_console_command(text),
        _ => false,
    }
}

fn is_safe_console_command(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 256
        && !value.chars().any(|character| {
            matches!(character, '\r' | '\n')
                || character.is_control()
        })
}

fn is_safe_text(value: &str, max_len: usize, allow_plus: bool) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '_' | '-')
                || (allow_plus && character == '+')
        })
        && value.chars().next().is_some_and(|character| character.is_ascii_alphanumeric())
}

fn is_dangerous_key(key: &str) -> bool {
    matches!(key, "__proto__" | "prototype" | "constructor")
}

fn sanitize_response(value: Value) -> Value {
    sanitize_value(value, "", 0)
}

fn sanitize_value(value: Value, key: &str, depth: usize) -> Value {
    match value {
        Value::String(text) => {
            if key == "inviteLink" && depth == 1 {
                Value::String(text)
            } else {
                Value::String(redact_secret_string(&text))
            }
        }
        Value::Array(values) => Value::Array(values.into_iter().map(|entry| sanitize_value(entry, "", depth)).collect()),
        Value::Object(object) => Value::Object(sanitize_object(object, depth)),
        other => other,
    }
}

fn sanitize_object(object: Map<String, Value>, depth: usize) -> Map<String, Value> {
    object
        .into_iter()
        .filter_map(|(key, value)| {
            if should_drop_response_key(&key, depth) {
                None
            } else {
                let sanitized = sanitize_value(value, &key, depth + 1);
                Some((key, sanitized))
            }
        })
        .collect()
}

fn should_drop_response_key(key: &str, depth: usize) -> bool {
    is_nested_invite_link(key, depth) || (key != "inviteLink" && is_private_response_key(key))
}

fn is_nested_invite_link(key: &str, depth: usize) -> bool {
    key == "inviteLink" && depth > 0
}

fn is_private_response_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    ["token", "secret", "password", "credential", "authorization", "cookie", "session", "uuid", "email", "path"]
        .iter()
        .any(|private| normalized.contains(private))
}

fn redact_secret_string(value: &str) -> String {
    if looks_like_local_path(value) {
        return "[redacted-path]".to_string();
    }

    value
        .split_whitespace()
        .map(|part| {
            if part.contains("token=")
                || part.contains("invite=")
                || part.contains("secret=")
                || part.contains('@')
                || looks_like_uuid(part)
                || looks_like_network_address(part)
            {
                "[redacted]"
            } else if looks_like_embedded_local_path(part) {
                "[redacted-path]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_local_path(value: &str) -> bool {
    value.len() > 3
        && value.as_bytes().get(1) == Some(&b':')
        && matches!(value.as_bytes().get(2), Some(b'\\') | Some(b'/'))
}

fn looks_like_embedded_local_path(value: &str) -> bool {
    value
        .split(|character: char| character == '"' || character == '\'' || character == '<' || character == '>')
        .any(|part| {
            looks_like_local_path(part)
                || part.contains(":\\Users\\")
                || part.contains(":/Users/")
                || part.starts_with("/Users/")
                || part.starts_with("/home/")
                || part.starts_with("/tmp/")
                || part.starts_with("/var/")
        })
}

fn looks_like_network_address(value: &str) -> bool {
    let raw = value
        .rsplit_once('=')
        .map(|(_, rhs)| rhs)
        .unwrap_or(value);
    let trimmed = raw.trim_matches(|character: char| {
        matches!(character, '[' | ']' | '(' | ')' | ',' | ';')
    });

    if trimmed.contains(':') && trimmed.chars().filter(|character| *character == ':').count() >= 2 {
        return true;
    }

    let host = trimmed.split(':').next().unwrap_or(trimmed);
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 3
                && part.chars().all(|character| character.is_ascii_digit())
                && part.parse::<u8>().is_ok()
        })
}

fn looks_like_uuid(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(index, character)| {
            matches!(index, 8 | 13 | 18 | 23) && character == '-'
                || !matches!(index, 8 | 13 | 18 | 23) && character.is_ascii_hexdigit()
        })
}

fn node_host_script_path() -> PathBuf {
    desktop_root()
        .join("src")
        .join("runtime")
        .join("desktop-command-host-process.mjs")
}

fn node_command() -> PathBuf {
    env::var_os(NODE_PATH_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"))
}

fn desktop_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must live under apps/desktop")
        .to_path_buf()
}

fn blocked_dto(reason: &str, message: &str) -> Value {
    json!({
        "state": "blocked",
        "summary": message,
        "failure": {
            "reason": reason,
            "message": message
        }
    })
}

fn main() {
    tauri::Builder::default()
        .manage(DesktopCommandBroker::default())
        .invoke_handler(tauri::generate_handler![
            desktop_prepare_room,
            desktop_open_room,
            desktop_close_room,
            desktop_restart_room,
            desktop_send_server_command,
            desktop_status_room,
            desktop_reset_room
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri desktop shell");
}
