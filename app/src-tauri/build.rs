fn main() {
    tauri_build::build();

    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-arg-bin=knowledge-bridge=-Wl,-rpath,$ORIGIN/../lib/project-graph");
    }
}
