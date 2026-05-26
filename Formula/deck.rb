# Homebrew formula for deck CLI
#
# Usage: brew install deck/tap/deck
#
# Architecture-specific URLs require SHA-256 updates per release.
# Update SHA-256 values before publishing a new version.
#
# To release a new version:
# 1. Run build-binaries to produce darwin-x64 and darwin-arm64 binaries
# 2. Calculate SHA-256: shasum -a 256 deck_v*.tar.gz
# 3. Update SHA256_X64 and SHA256_ARM64 below
# 4. Update VERSION to match the tag
# 5. Submit PR to homebrew-tap

class Deck < Formula
  desc "Developer team CLI with autonomous agents"
  homepage "https://github.com/deck-cli/deck"
  license "MIT"

  # VERSION must be updated per release
  # Follows semver from GitHub release tag
  VERSION = "0.0.2"

  # SHA-256 checksums - UPDATE THESE PER RELEASE
  # Run: shasum -a 256 deck_vVERSION_darwin-x64.tar.gz
  SHA256_X64 = "REPLACE_ME"
  SHA256_ARM64 = "REPLACE_ME"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/deck-cli/deck/releases/download/v#{VERSION}/deck_v#{VERSION}_darwin-arm64.tar.gz"
      sha256 SHA256_ARM64
    else
      url "https://github.com/deck-cli/deck/releases/download/v#{VERSION}/deck_v#{VERSION}_darwin-x64.tar.gz"
      sha256 SHA256_X64
    end
  end

  def install
    # Determine os and arch for binary filename
    os = OS.mac? ? "darwin" : "linux"
    arch = Hardware::CPU.arch == :arm64 ? "arm64" : "x64"

    # Extract binary to libexec
    libexec.install "deck-#{os}-#{arch}"

    # Create wrapper script
    bin.write_exec_script "#{libexec}/deck-#{os}-#{arch}"
  end

  test do
    # Verify --version outputs expected format
    output = shell_output("#{bin}/deck --version")
    assert_match(/^deck /, output)
    assert_match(/version:/, output)
    assert_match(/commit:/, output)
    assert_match(/date:/, output)
    assert_match(/target:/, output)
    assert_match(/channel:/, output)

    # Verify doctor command works
    assert_equal 0, shell_output("#{bin}/deck doctor").exit_code
  end
end