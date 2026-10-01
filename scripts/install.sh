#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Deck — AI Runner Installer & Configuration Tool
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh | bash
#
# Or download and run:
#   curl -fsLO https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh
#   chmod +x install.sh
#   ./install.sh
# ============================================================================

GITHUB_OWNER="kevin15011"
GITHUB_REPO="deck"
BINARY_NAME="deck"

TX_TMPDIR=""
TX_TARGET_PATH=""
TX_LOCK_DIR=""
TX_BACKUP_PATH=""
TX_BACKUP_TMP=""
TX_BACKUP_SHA=""
TX_CANDIDATE_SHA=""
TX_REPLACE_ARMED="false"
TX_REPLACED="false"
TX_VERIFIED="false"
TX_HAS_BACKUP="false"
TX_LOCK_OWNED="false"
TX_LOCK_TOKEN=""
TX_PRESERVE_ARTIFACTS="false"
TX_CLEANUP_DONE="false"
TEST_HOOKS_ENABLED="false"

# ============================================================================
# Color support
# ============================================================================

setup_colors() {
    if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
        RED='\033[0;31m'
        GREEN='\033[0;32m'
        YELLOW='\033[1;33m'
        BLUE='\033[0;34m'
        CYAN='\033[0;36m'
        BOLD='\033[1m'
        DIM='\033[2m'
        NC='\033[0m'
    else
        RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' DIM='' NC=''
    fi
}

# ============================================================================
# Logging helpers
# ============================================================================

info()    { echo -e "${BLUE}[info]${NC}    $*"; }
success() { echo -e "${GREEN}[ok]${NC}      $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}    $*"; }
error()   { echo -e "${RED}[error]${NC}   $*" >&2; }
fatal()   { error "$@"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}==>${NC} ${BOLD}$*${NC}"; }

file_sha256() {
    local file_path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file_path" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file_path" | awk '{print $1}'
    else
        return 127
    fi
}

rename_no_follow() {
    local source_path="$1"
    local destination_path="$2"
    if command -v perl >/dev/null 2>&1; then
        perl -e 'rename($ARGV[0], $ARGV[1]) or die "$!\n"' "$source_path" "$destination_path"
        return $?
    fi
    if mv --help 2>/dev/null | grep -q -- ' -T'; then
        mv -fT "$source_path" "$destination_path"
        return $?
    fi
    error "No safe no-follow rename primitive is available on this system."
    return 1
}

validate_target_regular() {
    local target_path="$1"
    if [ -L "$target_path" ]; then
        error "Refusing to replace symlinked destination: ${target_path}"
        return 1
    fi
    if [ -e "$target_path" ] && [ ! -f "$target_path" ]; then
        error "Refusing to replace existing destination because it is not a regular file: ${target_path}"
        return 1
    fi
    return 0
}

verify_macos_signature() {
    local candidate_path="$1"
    [ "${OS:-}" = "darwin" ] || return 0

    if [ "$TEST_HOOKS_ENABLED" = "true" ]; then
        case "${DECK_INSTALL_TEST_MACOS_SIGNATURE:-}" in
            valid) return 0 ;;
            invalid)
                error "Downloaded candidate does not have a valid macOS code signature."
                return 1
                ;;
        esac
    fi

    if ! command -v codesign >/dev/null 2>&1; then
        error "Cannot verify the downloaded macOS binary because codesign is unavailable."
        return 1
    fi

    local signature_output
    if ! signature_output="$(codesign --verify --deep --strict --verbose=2 "$candidate_path" 2>&1)"; then
        error "Downloaded candidate does not have a valid macOS code signature: ${signature_output}"
        return 1
    fi
    success "macOS code signature verified"
}

lock_owner_matches() {
    local owner_file="$1"
    local expected_token="$2"
    [ -f "$owner_file" ] || return 1
    awk -v token="$expected_token" '
        BEGIN { owner_count = 0; matched = 0 }
        /^owner_token=/ {
            owner_count++
            if ($0 == "owner_token=" token) matched = 1
        }
        END { exit !(owner_count == 1 && matched == 1) }
    ' "$owner_file"
}

validate_backup_for_restore() {
    local reason="$1"
    if [ "$TX_HAS_BACKUP" != "true" ] || [ -z "$TX_BACKUP_PATH" ]; then
        error "${reason}; no previous binary was present to roll back to."
        return 1
    fi
    if [ ! -e "$TX_BACKUP_PATH" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; backup is missing. Preserved candidate, backup path, and lock for inspection: ${TX_TARGET_PATH} ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    if [ -L "$TX_BACKUP_PATH" ] || [ ! -f "$TX_BACKUP_PATH" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; backup is not a regular file. Preserved candidate, backup path, and lock for inspection: ${TX_TARGET_PATH} ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    local backup_live_sha
    backup_live_sha="$(file_sha256 "$TX_BACKUP_PATH" 2>/dev/null || true)"
    if [ -z "$backup_live_sha" ] || [ "$backup_live_sha" != "$TX_BACKUP_SHA" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; backup digest changed. Preserved candidate, backup, and lock for inspection: ${TX_TARGET_PATH} ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    return 0
}

restore_backup_to_target() {
    local reason="$1"
    validate_backup_for_restore "$reason" || return 1
    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_REPLACE_BACKUP_WITH_SYMLINK_BEFORE_RESTORE:-}" ]; then
        rm -f "$TX_BACKUP_PATH"
        ln -s "$DECK_INSTALL_TEST_REPLACE_BACKUP_WITH_SYMLINK_BEFORE_RESTORE" "$TX_BACKUP_PATH"
    fi
    if ! rename_no_follow "$TX_BACKUP_PATH" "$TX_TARGET_PATH"; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; rollback failed. Preserved backup and lock for inspection: ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    if [ -L "$TX_TARGET_PATH" ] || [ ! -f "$TX_TARGET_PATH" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; rollback result is uncertain because restored target is not a non-symlink regular file. Preserved remaining evidence and lock for inspection: ${TX_TARGET_PATH} ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    local restored_sha
    restored_sha="$(file_sha256 "$TX_TARGET_PATH" 2>/dev/null || true)"
    if [ -z "$restored_sha" ] || [ "$restored_sha" != "$TX_BACKUP_SHA" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; rollback verification failed. Preserved lock for inspection: ${TX_LOCK_DIR}"
        return 1
    fi
    TX_HAS_BACKUP="false"
    TX_REPLACED="false"
    TX_REPLACE_ARMED="false"
    return 0
}

restore_owned_candidate() {
    local reason="$1"
    if { [ "$TX_REPLACED" != "true" ] && [ "$TX_REPLACE_ARMED" != "true" ]; } || [ -z "$TX_TARGET_PATH" ] || [ -z "$TX_CANDIDATE_SHA" ]; then
        return 0
    fi
    if [ -L "$TX_TARGET_PATH" ] || [ ! -f "$TX_TARGET_PATH" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; live destination is no longer this installer's candidate. Preserved backup and lock for inspection: ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    local live_sha
    live_sha="$(file_sha256 "$TX_TARGET_PATH" 2>/dev/null || true)"
    if [ "$TX_HAS_BACKUP" = "true" ] && [ -n "$TX_BACKUP_SHA" ] && [ "$live_sha" = "$TX_BACKUP_SHA" ]; then
        TX_REPLACED="false"
        TX_REPLACE_ARMED="false"
        return 0
    fi
    if [ -z "$live_sha" ] || [ "$live_sha" != "$TX_CANDIDATE_SHA" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; live destination changed after replacement. Preserved backup and lock for inspection: ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        return 1
    fi
    if [ "$TX_HAS_BACKUP" = "true" ]; then
        restore_backup_to_target "$reason" || return 1
        error "${reason}; restored previous binary."
        return 0
    fi
    rm -f "$TX_TARGET_PATH"
    if [ -e "$TX_TARGET_PATH" ]; then
        TX_PRESERVE_ARTIFACTS="true"
        error "${reason}; could not remove unverified candidate and no previous binary was present."
        return 1
    fi
    TX_REPLACED="false"
    TX_REPLACE_ARMED="false"
    error "${reason}; removed unverified candidate. No previous binary was present to roll back to."
    return 0
}

cleanup_transaction() {
    local reason="${1:-EXIT}"
    local exit_status="${2:-0}"
    local cleanup_status=0
    if [ "$TX_CLEANUP_DONE" = "true" ]; then
        return 0
    fi
    TX_CLEANUP_DONE="true"
    set +e

    if [ "$TX_VERIFIED" != "true" ] && [ "$exit_status" != "0" ] && { [ "$TX_REPLACED" = "true" ] || [ "$TX_REPLACE_ARMED" = "true" ]; }; then
        if [ "$reason" = "EXIT" ]; then
            restore_owned_candidate "Installer exited before verification completed" || true
        else
            restore_owned_candidate "Interrupted by ${reason} before verification completed" || true
        fi
    fi

    if [ "$TX_PRESERVE_ARTIFACTS" != "true" ]; then
        if [ -n "$TX_TMPDIR" ] && ! rm -rf "$TX_TMPDIR"; then
            cleanup_status=1
            TX_PRESERVE_ARTIFACTS="true"
            error "Cleanup failed; retained transaction artifacts for inspection: ${TX_TMPDIR} ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        fi
    fi
    if [ "$TX_PRESERVE_ARTIFACTS" != "true" ]; then
        if [ -n "$TX_BACKUP_TMP" ] && ! rm -f "$TX_BACKUP_TMP"; then
            cleanup_status=1
            TX_PRESERVE_ARTIFACTS="true"
            error "Cleanup failed; retained backup temp and lock for inspection: ${TX_BACKUP_TMP} ${TX_LOCK_DIR}"
        fi
    fi
    if [ "$TX_PRESERVE_ARTIFACTS" != "true" ]; then
        if [ "$TX_HAS_BACKUP" = "true" ] && [ -n "$TX_BACKUP_PATH" ] && ! rm -f "$TX_BACKUP_PATH"; then
            cleanup_status=1
            TX_PRESERVE_ARTIFACTS="true"
            error "Cleanup failed; retained backup and lock for inspection: ${TX_BACKUP_PATH} ${TX_LOCK_DIR}"
        fi
    fi
    if [ "$TX_PRESERVE_ARTIFACTS" != "true" ]; then
        if [ "$TX_LOCK_OWNED" = "true" ] && [ -n "$TX_LOCK_DIR" ] && [ -n "$TX_LOCK_TOKEN" ]; then
            if ! lock_owner_matches "${TX_LOCK_DIR}/owner.txt" "$TX_LOCK_TOKEN"; then
                cleanup_status=1
                TX_PRESERVE_ARTIFACTS="true"
                error "Lock ownership changed; preserved lock for inspection: ${TX_LOCK_DIR}"
            elif ! rm -rf "$TX_LOCK_DIR"; then
                cleanup_status=1
                TX_PRESERVE_ARTIFACTS="true"
                error "Cleanup failed; retained lock for inspection: ${TX_LOCK_DIR}"
            fi
        fi
    fi
    return "$cleanup_status"
}

handle_signal() {
    local signal_name="$1"
    trap - EXIT HUP INT TERM
    cleanup_transaction "$signal_name" "128"
    exit 128
}

# ============================================================================
# Help
# ============================================================================

show_help() {
    cat <<EOF
${BOLD}Deck installer${NC}

AI Runner Installer & Configuration Tool.

Usage: install.sh [OPTIONS]

Options:
  --dir DIR         Custom install directory
  --version VERSION Install a specific release tag/version (for example v0.4.0)
  --recovery        Run non-interactive recovery mode for a blocked binary
  --insecure        Skip checksum verification (not recommended)
  -h, --help        Show this help

Examples:
  curl -fsL https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/scripts/install.sh | bash
  ./install.sh --dir \$HOME/.local/bin
  ./install.sh --recovery --dir \$HOME/.local/bin --version v0.4.0
  ./install.sh --insecure

EOF
}

# ============================================================================
# Platform detection
# ============================================================================

detect_platform() {
    local uname_os uname_arch

    uname_os="$(uname -s)"
    uname_arch="$(uname -m)"

    case "$uname_os" in
        Darwin) OS="darwin"; OS_LABEL="macOS"; ;;
        Linux)  OS="linux";  OS_LABEL="Linux"; ;;
        *)      fatal "Unsupported OS: $uname_os. Only macOS and Linux are supported." ;;
    esac

    case "$uname_arch" in
        x86_64|amd64)   ARCH="x64" ;;
        arm64|aarch64)  ARCH="arm64" ;;
        *)              fatal "Unsupported architecture: $uname_arch. Only x64 and arm64 are supported." ;;
    esac

    success "Platform: ${OS_LABEL} (${OS}-${ARCH})"
}

# ============================================================================
# Archive naming
#
# Format: deck_v{VERSION}_{OS}-{ARCH}.tar.gz
# Examples:
#   deck_v1.0.0_linux-x64.tar.gz
#   deck_v1.0.0_darwin-arm64.tar.gz
# ============================================================================

get_archive_name() {
    local version="$1"
    echo "deck_v${version}_${OS}-${ARCH}.tar.gz"
}

validate_version() {
    local raw="$1"
    case "$raw" in
        ""|*[!A-Za-z0-9.v+-]*) fatal "Invalid version: ${raw}" ;;
    esac

    local normalized="${raw#v}"
    if [[ ! "$normalized" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
        fatal "Invalid version: ${raw}. Expected semver like v1.2.3."
    fi

    LATEST_VERSION="v${normalized}"
    VERSION_NUMBER="$normalized"
}

validate_install_dir() {
    local dir="$1"
    [ -z "$dir" ] && fatal "Install directory cannot be empty."
    case "$dir" in
        /*) ;;
        *) fatal "Install directory must be an absolute path: ${dir}" ;;
    esac
    if [[ "$dir" == *"/../"* || "$dir" == *"/.." || "$dir" == "/.." ]]; then
        fatal "Install directory contains unsafe path segments: ${dir}"
    fi
    if [ -e "$dir" ] && [ ! -d "$dir" ]; then
        fatal "Install path is not a directory: ${dir}"
    fi
}

canonicalize_install_dir() {
    local dir="$1"
    validate_install_dir "$dir"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" || fatal "Could not create install directory: ${dir}"
    fi
    local canonical=""
    if [ -d "$dir" ]; then
        canonical="$(cd -P "$dir" && pwd)" || fatal "Could not resolve install directory: ${dir}"
    else
        local parent base parent_canonical
        parent="$(dirname "$dir")"
        base="$(basename "$dir")"
        [ -d "$parent" ] || fatal "Install directory parent does not exist: ${parent}"
        parent_canonical="$(cd -P "$parent" && pwd)" || fatal "Could not resolve install directory parent: ${parent}"
        canonical="${parent_canonical}/${base}"
    fi
    case "$canonical" in
        /*) ;;
        *) fatal "Could not resolve install directory to an absolute path: ${dir}" ;;
    esac
    printf '%s\n' "$canonical"
}

validate_release_base_url() {
    local base_url="$1"
    case "$base_url" in
        https://*|file://*) return 0 ;;
        http://*) fatal "Recovery downloads require HTTPS release URLs; plaintext HTTP is refused." ;;
        *) fatal "Release base URL must use https:// or file:// for local hermetic fixtures." ;;
    esac
}

acquire_transaction_lock() {
    local target_path="$1"
    TX_TARGET_PATH="$target_path"
    TX_LOCK_DIR="${target_path}.install.lock"
    TX_LOCK_TOKEN="$$-$(date +%s)-${RANDOM:-0}"
    if mkdir "$TX_LOCK_DIR" 2>/dev/null; then
        TX_LOCK_OWNED="true"
        {
            printf 'owner_token=%s\n' "$TX_LOCK_TOKEN"
            printf 'pid=%s\n' "$$"
            printf 'target=%s\n' "$target_path"
            printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date)"
        } > "${TX_LOCK_DIR}/owner.txt"
        return 0
    fi

    error "Another active installer transaction is using ${target_path}."
    if [ -f "${TX_LOCK_DIR}/owner.txt" ]; then
        error "Lock details: ${TX_LOCK_DIR}/owner.txt"
    else
        error "Lock path: ${TX_LOCK_DIR}"
    fi
    error "If no installer is active, inspect the lock directory and remove it manually before retrying. The installer will not steal stale locks."
    exit 1
}

# ============================================================================
# Prerequisites
# ============================================================================

check_prerequisites() {
    step "Checking prerequisites"

    local missing=()

    if ! command -v curl &>/dev/null; then
        missing+=("curl")
    fi

    if ! command -v tar &>/dev/null; then
        missing+=("tar")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        fatal "Missing required tools: ${missing[*]}. Please install them and try again."
    fi

    success "curl and tar are available"
}

# ============================================================================
# Get latest version from GitHub
# ============================================================================

get_latest_version() {
    local url="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest"

    info "Fetching latest release from GitHub..."

    local response
    response="$(curl --proto '=https' --proto-redir '=https' -sL -w "\n%{http_code}" "$url")" || fatal "Failed to fetch latest release"

    local http_code body
    http_code="$(echo "$response" | tail -n1)"
    body="$(echo "$response" | sed '$d')"

    if [ "$http_code" != "200" ]; then
        fatal "GitHub API returned HTTP $http_code. Rate limited? Try again later."
    fi

    # Extract tag_name — works without jq
    LATEST_VERSION="$(echo "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

    if [ -z "$LATEST_VERSION" ]; then
        fatal "Could not determine latest version from GitHub API response"
    fi

    validate_version "$LATEST_VERSION"

    success "Latest version: ${LATEST_VERSION}"
}

# ============================================================================
# Install via binary download
# ============================================================================

install_binary() {
    step "Installing pre-built binary"

    if [ -n "${VERSION_OVERRIDE:-}" ]; then
        validate_version "$VERSION_OVERRIDE"
    else
        get_latest_version
    fi

    local archive_name
    archive_name="$(get_archive_name "$VERSION_NUMBER")"
    local release_base_url="${DECK_INSTALL_RELEASE_BASE_URL:-https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download}"
    release_base_url="${release_base_url%/}"
    validate_release_base_url "$release_base_url"
    if [ "${DECK_INSTALL_TEST_MODE:-}" = "1" ] && [[ "$release_base_url" == file://* ]]; then
        TEST_HOOKS_ENABLED="true"
        export DECK_INSTALL_TEST_INSTALLER_PID="$$"
    else
        TEST_HOOKS_ENABLED="false"
        unset DECK_INSTALL_TEST_INSTALLER_PID 2>/dev/null || true
    fi
    local download_url="${release_base_url}/${LATEST_VERSION}/${archive_name}"
    local checksums_url="${release_base_url}/${LATEST_VERSION}/checksums.txt"

    # Determine install directory before staging so the transaction happens on
    # the destination filesystem.
    local install_dir="${INSTALL_DIR:-}"
    if [ -z "$install_dir" ]; then
        if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
            install_dir="/usr/local/bin"
        elif [ "$(id -u)" = "0" ]; then
            install_dir="/usr/local/bin"
        else
            install_dir="${HOME}/.local/bin"
        fi
    fi
    install_dir="$(canonicalize_install_dir "$install_dir")"

    local target_path="${install_dir}/${BINARY_NAME}"
    validate_target_regular "$target_path" || exit 1
    acquire_transaction_lock "$target_path"

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_HOLD_AFTER_LOCK_MARKER:-}" ]; then
        printf 'held\n' > "$DECK_INSTALL_TEST_HOLD_AFTER_LOCK_MARKER"
        while [ -n "${DECK_INSTALL_TEST_HOLD_AFTER_LOCK_RELEASE:-}" ] && [ ! -f "$DECK_INSTALL_TEST_HOLD_AFTER_LOCK_RELEASE" ]; do
            sleep 0.05
        done
    fi

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_MUTATE_LOCK_OWNER:-}" ]; then
        case "$DECK_INSTALL_TEST_MUTATE_LOCK_OWNER" in
            suffix)
                {
                    printf 'owner_token=%sx\n' "$TX_LOCK_TOKEN"
                    printf 'pid=%s\n' "$$"
                } > "${TX_LOCK_DIR}/owner.txt"
                ;;
            prefix)
                {
                    printf 'xowner_token=%s\n' "$TX_LOCK_TOKEN"
                    printf 'pid=%s\n' "$$"
                } > "${TX_LOCK_DIR}/owner.txt"
                ;;
            malformed)
                printf 'owner_token %s\n' "$TX_LOCK_TOKEN" > "${TX_LOCK_DIR}/owner.txt"
                ;;
            missing)
                rm -f "${TX_LOCK_DIR}/owner.txt"
                ;;
            duplicate)
                {
                    printf 'owner_token=%s\n' "$TX_LOCK_TOKEN"
                    printf 'owner_token=%s\n' "$TX_LOCK_TOKEN"
                    printf 'pid=%s\n' "$$"
                } > "${TX_LOCK_DIR}/owner.txt"
                ;;
            *)
                fatal "Unknown test lock owner mutation: ${DECK_INSTALL_TEST_MUTATE_LOCK_OWNER}"
                ;;
        esac
    fi

    # Create staging directory inside install_dir for same-filesystem rename.
    TX_TMPDIR="$(mktemp -d "${install_dir}/.deck-install.XXXXXX")"

    # Download archive
    info "Downloading ${archive_name}..."
    if ! curl --proto '=https,file' --proto-redir '=https' -sfL -o "${TX_TMPDIR}/${archive_name}" "$download_url"; then
        fatal "Failed to download ${download_url}"
    fi

    # Verify file was actually downloaded (not a 404 HTML page)
    local file_size
    file_size="$(wc -c < "${TX_TMPDIR}/${archive_name}" | tr -d '[:space:]')"
    if [ "$file_size" -lt 1000 ] && [[ "$download_url" != file:* ]]; then
        fatal "Downloaded file is suspiciously small (${file_size} bytes). Archive may not exist for this platform."
    fi

    success "Downloaded ${archive_name} (${file_size} bytes)"

    # Download and verify checksum — fail closed unless --insecure is set.
    # Recovery mode always requires checksum verification.
    info "Verifying checksum..."
    if curl --proto '=https,file' --proto-redir '=https' -sL -o "${TX_TMPDIR}/checksums.txt" "$checksums_url"; then
        local expected_checksum
        expected_checksum="$(awk -v name="${archive_name}" '$2 == name { print $1; found=1 } END { if (!found) exit 1 }' "${TX_TMPDIR}/checksums.txt" 2>/dev/null || true)"

        if [ -n "$expected_checksum" ]; then
            local actual_checksum
            actual_checksum="$(file_sha256 "${TX_TMPDIR}/${archive_name}" 2>/dev/null || true)"
            if [ -z "$actual_checksum" ]; then
                if [ "$INSECURE" = "true" ]; then
                    warn "No sha256sum or shasum found — checksum verification skipped (--insecure)"
                    actual_checksum="$expected_checksum"
                else
                    fatal "No sha256sum or shasum found. Cannot verify checksum.\nInstall coreutils or use --insecure to skip."
                fi
            fi

            if [ "$actual_checksum" != "$expected_checksum" ]; then
                fatal "Checksum mismatch!\n  Expected: ${expected_checksum}\n  Got:      ${actual_checksum}"
            fi
            success "Checksum verified"
        else
            if [ "$INSECURE" = "true" ]; then
                warn "Archive '${archive_name}' not found in checksums.txt — checksum verification skipped (--insecure)"
            else
                fatal "Archive '${archive_name}' not found in checksums.txt. Refusing to install unverified binary.\nUse --insecure to skip."
            fi
        fi
    else
        if [ "$INSECURE" = "true" ]; then
            warn "Could not download checksums.txt — checksum verification skipped (--insecure)"
        else
            fatal "Could not download checksums.txt from:\n  ${checksums_url}\nRefusing to install without integrity verification.\nUse --insecure to skip."
        fi
    fi

    # Extract binary
    info "Extracting ${BINARY_NAME}..."
    local archive_entry
    while IFS= read -r archive_entry; do
        [ -z "$archive_entry" ] && continue
        case "$archive_entry" in
            /*|../*|*/../*|*/..) fatal "Archive contains unsafe path entry: ${archive_entry}" ;;
        esac
    done < <(tar -tzf "${TX_TMPDIR}/${archive_name}")

    local deck_member_type
    deck_member_type="$(tar -tvzf "${TX_TMPDIR}/${archive_name}" deck 2>/dev/null | awk 'NR == 1 { print substr($1, 1, 1) }')"
    if [ "$deck_member_type" != "-" ]; then
        fatal "Binary 'deck' in archive must be a regular file"
    fi

    if ! tar -xzf "${TX_TMPDIR}/${archive_name}" -C "$TX_TMPDIR" deck; then
        fatal "Failed to extract archive"
    fi

    if [ -L "${TX_TMPDIR}/${BINARY_NAME}" ]; then
        fatal "Binary '${BINARY_NAME}' in archive must not be a symlink"
    fi

    if [ ! -f "${TX_TMPDIR}/${BINARY_NAME}" ]; then
        fatal "Binary '${BINARY_NAME}' not found in archive"
    fi

    chmod +x "${TX_TMPDIR}/${BINARY_NAME}"

    # Install binary atomically using rename in the destination directory.
    info "Installing to ${target_path}..."
    local candidate_path="${TX_TMPDIR}/${BINARY_NAME}.candidate"
    TX_BACKUP_PATH="${target_path}.backup.$(date +%s).$$"
    TX_BACKUP_TMP="${TX_BACKUP_PATH}.tmp"
    mv "${TX_TMPDIR}/${BINARY_NAME}" "$candidate_path"
    TX_CANDIDATE_SHA="$(file_sha256 "$candidate_path" 2>/dev/null || true)"
    [ -z "$TX_CANDIDATE_SHA" ] && fatal "Could not compute candidate checksum before replacement."
    verify_macos_signature "$candidate_path" || fatal "Refusing to install an unsigned or invalid macOS binary."

    if [ -e "$target_path" ]; then
        validate_target_regular "$target_path" || exit 1
        TX_BACKUP_SHA="$(file_sha256 "$target_path" 2>/dev/null || true)"
        [ -z "$TX_BACKUP_SHA" ] && fatal "Could not compute existing binary checksum before backup."
        rm -f "$TX_BACKUP_TMP"
        if ! cp -p "$target_path" "$TX_BACKUP_TMP"; then
            rm -f "$TX_BACKUP_TMP"
            fatal "Could not back up existing binary at ${target_path}"
        fi
        local backup_tmp_sha
        backup_tmp_sha="$(file_sha256 "$TX_BACKUP_TMP" 2>/dev/null || true)"
        if [ "$backup_tmp_sha" != "$TX_BACKUP_SHA" ]; then
            rm -f "$TX_BACKUP_TMP"
            fatal "Could not verify backup copy for existing binary at ${target_path}"
        fi
        if ! rename_no_follow "$TX_BACKUP_TMP" "$TX_BACKUP_PATH"; then
            rm -f "$TX_BACKUP_TMP"
            fatal "Could not finalize backup for existing binary at ${target_path}"
        fi
        TX_HAS_BACKUP="true"
    fi

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_RACE_TARGET_SYMLINK_DIR:-}" ]; then
        rm -f "$target_path"
        ln -s "$DECK_INSTALL_TEST_RACE_TARGET_SYMLINK_DIR" "$target_path"
    fi

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_BEFORE_CANDIDATE_RENAME_MARKER:-}" ]; then
        if [ -e "$target_path" ]; then
            printf 'present\n' > "$DECK_INSTALL_TEST_BEFORE_CANDIDATE_RENAME_MARKER"
        else
            printf 'missing\n' > "$DECK_INSTALL_TEST_BEFORE_CANDIDATE_RENAME_MARKER"
        fi
    fi

    if ! validate_target_regular "$target_path"; then
        if [ "$TX_HAS_BACKUP" = "true" ]; then
            restore_backup_to_target "Target changed before replacement" || true
        fi
        fatal "Refusing to replace destination after boundary revalidation failed: ${target_path}"
    fi

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_RACE_TARGET_DIRECTORY:-}" ]; then
        rm -f "$target_path"
        mkdir "$target_path"
    fi

    if ! validate_target_regular "$target_path"; then
        TX_PRESERVE_ARTIFACTS="true"
        fatal "Refusing to replace destination after final boundary revalidation failed: ${target_path}"
    fi

    TX_REPLACE_ARMED="true"
    if ! rename_no_follow "$candidate_path" "$target_path"; then
        if [ "$TX_HAS_BACKUP" = "true" ] && [ ! -e "$target_path" ]; then
            restore_backup_to_target "Candidate replacement failed" || true
        fi
        fatal "Could not replace ${target_path}; rollback attempted."
    fi
    TX_REPLACED="true"

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_MUTATE_BACKUP_BEFORE_VERIFY:-}" ]; then
        case "$DECK_INSTALL_TEST_MUTATE_BACKUP_BEFORE_VERIFY" in
            missing)
                rm -f "$TX_BACKUP_PATH"
                ;;
            changed)
                printf 'changed backup\n' > "$TX_BACKUP_PATH"
                ;;
            symlink)
                rm -f "$TX_BACKUP_PATH"
                ln -s "$target_path" "$TX_BACKUP_PATH"
                ;;
            *)
                fatal "Unknown test backup mutation: ${DECK_INSTALL_TEST_MUTATE_BACKUP_BEFORE_VERIFY}"
                ;;
        esac
    fi

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_EXIT_AFTER_RENAME:-}" ]; then
        fatal "Test hook requested exit after replacement."
    fi

    if ! verify_installation "$target_path" "$VERSION_NUMBER"; then
        if [ "$TX_HAS_BACKUP" = "true" ]; then
            restore_owned_candidate "Candidate verification failed" || fatal "Candidate verification failed and rollback failed for ${target_path}"
            fatal "Candidate verification failed; rollback completed."
        fi
        restore_owned_candidate "Candidate verification failed" || true
        fatal "Candidate verification failed; no previous binary was present to roll back to."
    fi
    TX_VERIFIED="true"

    success "Installed ${BINARY_NAME} to ${target_path}"

    # Store install_dir for use by add_to_path
    INSTALL_DIR="$install_dir"
}

# ============================================================================
# Shell detection
# ============================================================================

detect_shell() {
    if [ -n "${ZSH_VERSION:-}" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ]; then
        SHELL_RC="$HOME/.bashrc"
    else
        SHELL_RC=""
    fi
}

# ============================================================================
# Add to PATH silently
# ============================================================================

add_to_path() {
    if [ -z "${SHELL_RC:-}" ] || [ ! -f "${SHELL_RC:-}" ]; then
        return
    fi

    if grep -qF -- "${INSTALL_DIR:-}" "$SHELL_RC" 2>/dev/null; then
        return
    fi

    echo "" >> "$SHELL_RC"
    echo "# Deck installer" >> "$SHELL_RC"
    echo 'export PATH="$PATH:'"${INSTALL_DIR:-}"'"' >> "$SHELL_RC"
}

# ============================================================================
# Verify installation
# ============================================================================

verify_installation() {
    step "Verifying installation"
    local binary_path="${1:-${INSTALL_DIR:-}/${BINARY_NAME}}"
    local expected_version="${2:-${VERSION_NUMBER:-}}"

    if [ -z "$binary_path" ] || [ "$binary_path" = "/${BINARY_NAME}" ]; then
        fatal "Internal installer error: no installed binary path available for verification."
    fi
    if [ -z "$expected_version" ]; then
        fatal "Internal installer error: no expected Deck version available for verification."
    fi

    # Allow PATH changes to take effect
    hash -r 2>/dev/null || true

    if [ ! -x "$binary_path" ]; then
        error "Installed candidate is not executable: ${binary_path}"
        return 1
    fi

    if [ "$TEST_HOOKS_ENABLED" = "true" ] && [ -n "${DECK_INSTALL_TEST_HOLD_DURING_VERIFY_MARKER:-}" ]; then
        printf 'held\n' > "$DECK_INSTALL_TEST_HOLD_DURING_VERIFY_MARKER"
        while [ ! -f "${DECK_INSTALL_TEST_HOLD_DURING_VERIFY_MARKER}.release" ]; do
            sleep 0.05
        done
    fi

    local version_output version_status failure_detail
    set +e
    version_output="$("$binary_path" version 2>&1)"
    version_status=$?
    set -e
    if [ "$version_status" -ne 0 ]; then
        failure_detail="exit status ${version_status}"
        if [ "$version_status" -eq 137 ]; then
            failure_detail="exit status 137 (SIGKILL)"
        elif [ "$version_status" -gt 128 ]; then
            failure_detail="exit status ${version_status} (signal $((version_status - 128)))"
        fi
        if [ -n "$version_output" ]; then
            failure_detail="${failure_detail}: ${version_output}"
        fi
        error "Installed candidate failed '${BINARY_NAME} version': ${failure_detail}"
        return 1
    fi

    local reported_version
    reported_version="$(printf '%s\n' "$version_output" | sed -n 's/^deck \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[-+0-9A-Za-z.]*\).*/\1/p' | head -1)"

    if [ -z "$reported_version" ]; then
        error "Installed candidate did not report a valid Deck version: ${version_output}"
        return 1
    fi
    if [ "$reported_version" != "$expected_version" ]; then
        error "Installed candidate reported Deck version ${reported_version}; expected ${expected_version}."
        return 1
    fi

    success "${BINARY_NAME} is installed at ${binary_path}: ${version_output%%$'\n'*}"
    return 0
}

# ============================================================================
# Print next steps
# ============================================================================

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}"
    echo "██████╗ ███████╗ ██████╗██╗  ██╗"
    echo "██╔══██╗██╔════╝██╔════╝██║  ██╔╝"
    echo "██║  ██║█████╗  ██║     █████═╝ "
    echo "██║  ██║██╔══╝  ██║     ██╔═██╗ "
    echo "██████╔╝███████╗╚██████╗██║  ██╗"
    echo "╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝"
    echo -e "${NC}"
    echo -e "  ${DIM}AI Runner Installer & Configuration Tool${NC}"
    echo ""
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}${BOLD}Installation complete!${NC}"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo -e "  ${CYAN}1.${NC} Restart your shell or run: ${BOLD}source ~/.zshrc${NC} (or ~/.bashrc)"
    echo -e "  ${CYAN}2.${NC} Run ${BOLD}${BINARY_NAME}${NC} to start the TUI installer"
    echo -e "  ${CYAN}3.${NC} Select your AI agent(s) (Pi, OpenCode, etc.)"
    echo -e "  ${CYAN}4.${NC} Configure your development environment"
    echo ""
    echo -e "${DIM}For help: ${BINARY_NAME} --help${NC}"
    echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
    setup_colors
    trap 'status=$?; trap - EXIT HUP INT TERM; cleanup_status=0; cleanup_transaction EXIT "$status" || cleanup_status=$?; if [ "$status" = "0" ] && [ "$cleanup_status" != "0" ]; then exit 1; fi; exit "$status"' EXIT
    trap 'handle_signal HUP' HUP
    trap 'handle_signal INT' INT
    trap 'handle_signal TERM' TERM

    # Parse arguments
    INSTALL_DIR=""
    INSECURE="false"
    RECOVERY="false"
    VERSION_OVERRIDE=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --dir)
                [ $# -lt 2 ] && fatal "--dir requires an argument"
                INSTALL_DIR="$2"; shift 2
                ;;
            --version)
                [ $# -lt 2 ] && fatal "--version requires an argument"
                VERSION_OVERRIDE="$2"; shift 2
                ;;
            --recovery)
                RECOVERY="true"; shift
                ;;
            --insecure)
                INSECURE="true"; shift
                ;;
            -h|--help)
                setup_colors
                show_help
                exit 0
                ;;
            *)
                fatal "Unknown option: $1. Use --help for usage."
                ;;
        esac
    done

    if [ "$RECOVERY" = "true" ] && [ "$INSECURE" = "true" ]; then
        fatal "--insecure cannot be used with --recovery. Recovery mode requires checksum verification."
    fi

    print_banner

    step "Detecting platform"
    detect_platform

    check_prerequisites
    install_binary

    if [ "$RECOVERY" != "true" ]; then
        detect_shell
        add_to_path
        print_next_steps
        return
    fi

    success "Recovery complete."
}

main "$@"
