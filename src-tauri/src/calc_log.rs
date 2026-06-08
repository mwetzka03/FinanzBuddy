use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

#[derive(Clone, Serialize)]
pub struct CalcLogPayload {
  pub class: String,
  pub method: String,
  pub message: String,
}

pub fn init_calc_log(app: &AppHandle) {
  *APP_HANDLE.lock().expect("calc_log lock") = Some(app.clone());
}

pub fn log(class: &str, method: &str, message: &str) {
  let Some(app) = APP_HANDLE.lock().expect("calc_log lock").clone() else {
    return;
  };
  let _ = app.emit(
    "calc-log",
    CalcLogPayload {
      class: class.to_string(),
      method: method.to_string(),
      message: message.to_string(),
    },
  );
}

/// Berechnungs-Logs im Format `[Klasse]: [Methode]: [Text mit Input und Output]`.
/// Werden als Tauri-Event `calc-log` an die App gesendet (Dev-Konsole bei Entwicklermodus).
#[macro_export]
macro_rules! calc_log {
  ($class:expr, $method:expr, $($arg:tt)*) => {{
    $crate::calc_log::log($class, $method, &format!($($arg)*));
  }};
}

pub use calc_log;
