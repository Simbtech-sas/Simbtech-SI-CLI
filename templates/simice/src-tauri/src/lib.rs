mod database;
mod deployment;
mod licence_state;

use std::sync::Arc;

use tauri::{Manager, State};

use database::Engine;
use deployment::Mode;
use licence_state::{LicenceReport, LicenceStore};

struct AppState {
    licence: Arc<LicenceStore>,
    mode: Mode,
    engine: Engine,
}

#[tauri::command]
fn licence_status(state: State<'_, AppState>) -> LicenceReport {
    state.licence.report()
}

#[tauri::command]
fn install_licence(token: String, state: State<'_, AppState>) -> Result<LicenceReport, String> {
    state.licence.install(&token)?;
    Ok(state.licence.report())
}

#[tauri::command]
fn machine_fingerprint() -> Option<String> {
    licence_state::machine_fingerprint()
}

#[tauri::command]
fn deployment_mode(state: State<'_, AppState>) -> Mode {
    state.mode
}

#[tauri::command]
fn database_engine(state: State<'_, AppState>) -> Engine {
    state.engine
}

/// Gate a feature behind the licence. Call this in the command, not in the UI:
/// hiding a button is presentation, refusing the call is enforcement.
#[tauri::command]
fn require_feature(feature: String, state: State<'_, AppState>) -> Result<(), String> {
    if state.licence.has_feature(&feature) {
        Ok(())
    } else {
        Err(format!("Your licence does not include \"{feature}\"."))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build());

    // The updater reaches the network, so it exists only in builds that are
    // allowed to. A standalone install is offline by construction.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if Mode::from_env().is_networked() {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let engine = Engine::from_env();
            // SQLite over a network share corrupts — its locking assumes a local
            // filesystem. A LAN deployment must use Postgres.
            if Mode::from_env() == Mode::LanServer && engine == Engine::Sqlite {
                eprintln!(
                    "warning: lan-server mode with SQLite. Several machines sharing one \
                     SQLite file WILL corrupt it — build with SIMBKIT_DATABASE=postgres."
                );
            }
            app.manage(AppState {
                licence: Arc::new(LicenceStore::new(dir)),
                mode: Mode::from_env(),
                engine,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            licence_status,
            install_licence,
            machine_fingerprint,
            deployment_mode,
            database_engine,
            require_feature
            // si:commands
        ])
        .run(tauri::generate_context!())
        .expect("error while running Simbkit");
}
