use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct SidecarState {
    pub port: u16,
    child: Option<Child>,
}

/// Starts the sidecar server process during app setup.
///
/// The sidecar is the existing Node.js/Bun standalone server that serves
/// the HTTP+SSE API. We spawn it with `--port 0` so it picks a free port,
/// then read stdout until we see `SIDECAR_PORT=<port>`.
///
/// This is called from setup() — errors are logged but don't crash the app.
pub fn start_sidecar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;

    eprintln!("[sidecar] Resource dir: {}", resource_dir.display());

    // In development, run from dist-standalone; in production, from bundled resources
    let (bun_path, server_path) = if cfg!(debug_assertions) {
        // Dev mode: use system bun and dist-standalone output
        let bun = which_bun();
        let server = std::env::current_dir()
            .unwrap_or_default()
            .join("dist-standalone/index.cjs");
        eprintln!("[sidecar] Dev mode — bun: {}, server: {}", bun.display(), server.display());
        (bun, server)
    } else {
        // Production: bundled sidecar in Resources/
        let bun = resource_dir.join("bun");
        let server = resource_dir.join("server.cjs");
        eprintln!(
            "[sidecar] Prod mode — bun: {} (exists={}), server: {} (exists={})",
            bun.display(),
            bun.exists(),
            server.display(),
            server.exists()
        );
        (bun, server)
    };

    if !bun_path.exists() {
        return Err(format!("Bun binary not found at: {}", bun_path.display()).into());
    }
    if !server_path.exists() {
        return Err(format!("Server bundle not found at: {}", server_path.display()).into());
    }

    let mut child = Command::new(&bun_path)
        .arg(server_path.to_str().unwrap())
        .arg("--port")
        .arg("0")
        .env("HOST", "127.0.0.1")
        .env("CORS_ORIGIN", "tauri://localhost")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Read stdout to discover the port
    let stdout = child.stdout.take().expect("failed to capture stdout");
    let reader = BufReader::new(stdout);
    let mut port: u16 = 0;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read sidecar stdout: {e}"))?;
        eprintln!("[sidecar] {line}");
        if let Some(port_str) = line.strip_prefix("SIDECAR_PORT=") {
            port = port_str
                .trim()
                .parse()
                .map_err(|e| format!("Invalid port: {e}"))?;
            break;
        }
    }

    if port == 0 {
        let _ = child.kill();
        return Err("Sidecar exited without reporting a port".into());
    }

    eprintln!("[tauri] Sidecar running on port {port}");

    // Store state
    let state = app.state::<Mutex<SidecarState>>();
    let mut state = state.lock().unwrap();
    state.port = port;
    state.child = Some(child);

    Ok(())
}

/// Stops the sidecar process on app exit.
pub fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<Mutex<SidecarState>>();
    let mut state = state.lock().unwrap();
    if let Some(ref mut child) = state.child {
        eprintln!("[tauri] Stopping sidecar...");
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("[tauri] Sidecar stopped");
    }
    state.child = None;
}

/// Find the bun binary on the system PATH.
fn which_bun() -> std::path::PathBuf {
    // Try ~/.bun/bin/bun first (bun's default install location)
    if let Some(home) = std::env::var_os("HOME") {
        let bun_home = std::path::PathBuf::from(home).join(".bun/bin/bun");
        if bun_home.exists() {
            return bun_home;
        }
    }
    // Try common locations
    for path in &["/usr/local/bin/bun", "/opt/homebrew/bin/bun"] {
        let p = std::path::PathBuf::from(path);
        if p.exists() {
            return p;
        }
    }
    // Fall back to PATH lookup
    which::which("bun").unwrap_or_else(|_| std::path::PathBuf::from("bun"))
}
