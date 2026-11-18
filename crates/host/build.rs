fn main() {
    let assets = std::path::Path::new("../../dist/assets");
    println!("cargo:rerun-if-changed=../../dist/assets");
    assert!(
        assets.join("app.js").is_file(),
        "Build browser assets first: ./scripts/build.sh (see scripts/env.sh for the local toolchain)"
    );
}
