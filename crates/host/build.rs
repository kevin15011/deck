fn main() {
    let assets = std::path::Path::new("../../dist/assets");
    println!("cargo:rerun-if-changed=../../dist/assets");
    let bridge = std::path::Path::new("../../dist/claude-sdk.mjs");
    println!("cargo:rerun-if-changed={}", bridge.display());
    let output =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("claude-sdk.mjs");
    if bridge.is_file() {
        std::fs::copy(bridge, output).expect("Cannot embed Claude SDK bridge");
    } else {
        // A Cargo-only build can still run Codex and OpenCode.
        std::fs::write(output, []).expect("Cannot prepare optional bridge asset");
    }
    assert!(
        assets.join("app.js").is_file(),
        "Build browser assets first: ./scripts/build.sh (see scripts/env.sh for the local toolchain)"
    );
}
