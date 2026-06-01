fn main() {
  tauri_build::build();
  for file in [
    "icons/icon.ico",
    "icons/icon.png",
    "icons/128x128@2x.png",
    "../app-icon.png",
  ] {
    println!("cargo:rerun-if-changed={file}");
  }
}
