#!/usr/bin/env bash
# ==============================================================================
# Agentic Debugger — Linux / macOS Setup Script
#
# Downloads and installs all prerequisites, builds the project, and installs
# the CLI tool globally so it can be used as `agentic-debugger` from any terminal.
#
# Usage:
#   chmod +x scripts/setup-linux.sh
#   ./scripts/setup-linux.sh
#
# Prerequisites that will be installed if missing:
#   - Node.js >= 18 (via nvm or package manager)
#   - Python 3.8+ (via package manager)
#   - .NET SDK 8.0+ (via dotnet-install script)
#   - debugpy (via pip)
#   - netcoredbg (from GitHub releases)
#   - js-debug (via npm)
# ==============================================================================

set -euo pipefail

# --- Colours ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()    { echo -e "  ${GREEN}✔ $1${NC}"; }
skip()  { echo -e "  ${YELLOW}⏭ $1${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail()  { echo -e "  ${RED}✖ $1${NC}"; }

has_cmd() { command -v "$1" &>/dev/null; }

get_major() { echo "$1" | grep -oE '[0-9]+' | head -1; }

# --- Detect OS ----------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
    Linux*)  PLATFORM="linux";;
    Darwin*) PLATFORM="macos";;
    *)       fail "Unsupported OS: $OS"; exit 1;;
esac

# --- Detect package manager ---------------------------------------------------
PKG_INSTALL=""
if [[ "$PLATFORM" == "macos" ]]; then
    if has_cmd brew; then
        PKG_INSTALL="brew install"
    else
        warn "Homebrew not found. Some packages may need manual install."
        warn "Install Homebrew: https://brew.sh"
    fi
elif has_cmd apt-get; then
    PKG_INSTALL="sudo apt-get install -y"
elif has_cmd dnf; then
    PKG_INSTALL="sudo dnf install -y"
elif has_cmd yum; then
    PKG_INSTALL="sudo yum install -y"
elif has_cmd pacman; then
    PKG_INSTALL="sudo pacman -S --noconfirm"
fi

# --- Resolve repo root --------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ ! -f "$REPO_ROOT/package.json" ]]; then
    REPO_ROOT="$(pwd)"
fi

echo -e "${MAGENTA}═══════════════════════════════════════════════════════${NC}"
echo -e "${MAGENTA}  Agentic Debugger — ${PLATFORM} Setup${NC}"
echo -e "${MAGENTA}═══════════════════════════════════════════════════════${NC}"
echo "  Repo root: $REPO_ROOT"

# ==============================================================================
# 1. Node.js
# ==============================================================================
step "Checking Node.js (>= 18)..."
if has_cmd node; then
    NODE_VER="$(node --version 2>&1 | tr -d 'v')"
    NODE_MAJOR="$(get_major "$NODE_VER")"
    if [[ "$NODE_MAJOR" -ge 18 ]]; then
        ok "Node.js $NODE_VER found"
    else
        warn "Node.js $NODE_VER is too old (need >= 18)"
        if has_cmd nvm; then
            nvm install 22
            nvm use 22
        elif [[ -n "$PKG_INSTALL" ]]; then
            $PKG_INSTALL nodejs
        fi
    fi
else
    warn "Node.js not found. Installing..."
    if has_cmd nvm; then
        nvm install 22
        nvm use 22
    elif [[ "$PLATFORM" == "macos" ]] && has_cmd brew; then
        brew install node@22
    elif [[ -n "$PKG_INSTALL" ]]; then
        # Try NodeSource for Debian/Ubuntu
        if has_cmd apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        else
            $PKG_INSTALL nodejs npm
        fi
    else
        fail "Cannot install Node.js. Install manually from https://nodejs.org/"
        exit 1
    fi

    if has_cmd node; then
        ok "Node.js $(node --version) installed"
    else
        fail "Node.js installation failed."
        exit 1
    fi
fi

# ==============================================================================
# 2. Python
# ==============================================================================
step "Checking Python (>= 3.8)..."
PYTHON_CMD=""
for cmd in python3 python; do
    if has_cmd "$cmd"; then
        PY_VER="$($cmd --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')"
        PY_MAJOR="$(echo "$PY_VER" | cut -d. -f1)"
        PY_MINOR="$(echo "$PY_VER" | cut -d. -f2)"
        if [[ "$PY_MAJOR" -ge 3 ]] && [[ "$PY_MINOR" -ge 8 ]]; then
            PYTHON_CMD="$cmd"
            ok "Python $PY_VER found ($cmd)"
            break
        fi
    fi
done

if [[ -z "$PYTHON_CMD" ]]; then
    warn "Python >= 3.8 not found. Installing..."
    if [[ "$PLATFORM" == "macos" ]] && has_cmd brew; then
        brew install python@3.12
    elif [[ -n "$PKG_INSTALL" ]]; then
        if has_cmd apt-get; then
            $PKG_INSTALL python3 python3-pip python3-venv
        else
            $PKG_INSTALL python3 python3-pip
        fi
    fi

    for cmd in python3 python; do
        if has_cmd "$cmd"; then
            PYTHON_CMD="$cmd"
            ok "Python $($cmd --version 2>&1) installed"
            break
        fi
    done

    if [[ -z "$PYTHON_CMD" ]]; then
        warn "Python install may require terminal restart. Continuing..."
    fi
fi

# ==============================================================================
# 3. .NET SDK
# ==============================================================================
step "Checking .NET SDK (>= 8.0)..."
if has_cmd dotnet; then
    DOTNET_VER="$(dotnet --version 2>&1)"
    DOTNET_MAJOR="$(get_major "$DOTNET_VER")"
    if [[ "$DOTNET_MAJOR" -ge 8 ]]; then
        ok ".NET SDK $DOTNET_VER found"
    else
        warn ".NET SDK $DOTNET_VER is too old (need >= 8). Installing..."
        curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0
        export PATH="$HOME/.dotnet:$PATH"
    fi
else
    warn ".NET SDK not found. Installing via dotnet-install script..."
    curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0
    export PATH="$HOME/.dotnet:$PATH"

    if has_cmd dotnet; then
        ok ".NET SDK $(dotnet --version) installed"
    else
        # Add to PATH in current session
        if [[ -f "$HOME/.dotnet/dotnet" ]]; then
            export PATH="$HOME/.dotnet:$PATH"
            ok ".NET SDK $($HOME/.dotnet/dotnet --version) installed at ~/.dotnet"
            echo ""
            warn "Add to your shell profile: export PATH=\"\$HOME/.dotnet:\$PATH\""
        else
            warn ".NET SDK installation may have failed. Install manually: https://dot.net"
        fi
    fi
fi

# ==============================================================================
# 4. debugpy (Python debug adapter)
# ==============================================================================
step "Checking debugpy..."
if [[ -n "$PYTHON_CMD" ]]; then
    if $PYTHON_CMD -m debugpy --version &>/dev/null; then
        DEBUGPY_VER="$($PYTHON_CMD -m debugpy --version 2>&1)"
        ok "debugpy $DEBUGPY_VER found"
    else
        warn "debugpy not found. Installing via pip..."
        $PYTHON_CMD -m pip install --user debugpy 2>&1 || true
        if $PYTHON_CMD -m debugpy --version &>/dev/null; then
            ok "debugpy installed"
        else
            warn "debugpy install failed — Python debugging will not be available"
        fi
    fi
else
    skip "Skipping debugpy (Python not available)"
fi

# ==============================================================================
# 5. netcoredbg (.NET debug adapter)
# ==============================================================================
step "Checking netcoredbg..."
if has_cmd netcoredbg; then
    ok "netcoredbg found on PATH"
else
    warn "netcoredbg not found. Installing..."
    NETCOREDBG_DIR="/usr/local/bin"
    INSTALL_DIR="$HOME/.local/netcoredbg"

    # Determine download URL based on platform and architecture
    if [[ "$PLATFORM" == "macos" ]]; then
        if [[ "$ARCH" == "arm64" ]]; then
            DOWNLOAD_URL="https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-osx-arm64.tar.gz"
        else
            DOWNLOAD_URL="https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-osx-amd64.tar.gz"
        fi
    else
        if [[ "$ARCH" == "aarch64" ]] || [[ "$ARCH" == "arm64" ]]; then
            DOWNLOAD_URL="https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-linux-arm64.tar.gz"
        else
            DOWNLOAD_URL="https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-linux-amd64.tar.gz"
        fi
    fi

    TMP_TAR="$(mktemp /tmp/netcoredbg-XXXXXX.tar.gz)"
    mkdir -p "$INSTALL_DIR"

    if curl -fsSL "$DOWNLOAD_URL" -o "$TMP_TAR"; then
        tar xzf "$TMP_TAR" -C "$INSTALL_DIR" --strip-components=0 2>/dev/null || \
        tar xzf "$TMP_TAR" -C "$INSTALL_DIR" 2>/dev/null
        rm -f "$TMP_TAR"

        # The archive may contain a nested netcoredbg/ dir
        if [[ -f "$INSTALL_DIR/netcoredbg/netcoredbg" ]]; then
            mv "$INSTALL_DIR/netcoredbg/"* "$INSTALL_DIR/" 2>/dev/null || true
            rmdir "$INSTALL_DIR/netcoredbg" 2>/dev/null || true
        fi

        chmod +x "$INSTALL_DIR/netcoredbg" 2>/dev/null || true

        # Try to symlink to /usr/local/bin, else add to PATH
        if [[ -w /usr/local/bin ]]; then
            ln -sf "$INSTALL_DIR/netcoredbg" /usr/local/bin/netcoredbg
            ok "netcoredbg installed to /usr/local/bin"
        else
            export PATH="$INSTALL_DIR:$PATH"
            ok "netcoredbg installed to $INSTALL_DIR"
            warn "Add to your shell profile: export PATH=\"$INSTALL_DIR:\$PATH\""
        fi
    else
        fail "Failed to download netcoredbg"
        warn "Install manually: https://github.com/Samsung/netcoredbg/releases"
    fi
fi

# ==============================================================================
# 6. js-debug (JavaScript/TypeScript debug adapter)
# ==============================================================================
step "Checking js-debug (js-debug-dap)..."
if has_cmd js-debug-dap; then
    ok "js-debug-dap found on PATH"
else
    warn "js-debug-dap not found. Installing via npm..."
    npm install -g @vscode/js-debug 2>&1 || true
    if has_cmd js-debug-dap; then
        ok "js-debug-dap installed globally"
    else
        warn "js-debug-dap not found after install. VS Code's bundled js-debug may still work."
    fi
fi

# ==============================================================================
# 7. Install npm dependencies & build the project
# ==============================================================================
step "Installing npm dependencies..."
cd "$REPO_ROOT"
npm install 2>&1 | tail -1
ok "npm install complete"

step "Building the project..."
npm run build 2>&1 | tail -1
ok "Build complete"

# ==============================================================================
# 8. Install the CLI globally
# ==============================================================================
step "Installing agentic-debugger CLI globally..."
npm link 2>&1 || npm install -g . 2>&1 || true
if has_cmd agentic-debugger; then
    ok "agentic-debugger CLI available globally"
else
    warn "Global install may require sudo. Trying with sudo..."
    sudo npm link 2>&1 || sudo npm install -g . 2>&1 || true
    if has_cmd agentic-debugger; then
        ok "agentic-debugger CLI available globally"
    else
        warn "CLI not found on PATH. You can run it via: npx agentic-debugger"
    fi
fi

# ==============================================================================
# 9. Verification
# ==============================================================================
step "Verifying installation..."

ALL_OK=true

verify() {
    local name="$1" cmd="$2"
    shift 2
    if has_cmd "$cmd"; then
        local ver
        ver="$($cmd "$@" 2>&1 | head -1)"
        ok "$name: $ver"
    else
        warn "$name: not found on PATH"
        ALL_OK=false
    fi
}

verify "agentic-debugger" agentic-debugger --version
verify "Node.js"          node            --version
verify "npm"              npm             --version

if has_cmd netcoredbg; then
    verify "netcoredbg" netcoredbg --version
elif [[ -f "$HOME/.local/netcoredbg/netcoredbg" ]]; then
    ver="$("$HOME/.local/netcoredbg/netcoredbg" --version 2>&1 | head -1)"
    ok "netcoredbg: $ver"
else
    warn "netcoredbg: not found"
    ALL_OK=false
fi

if [[ -n "${PYTHON_CMD:-}" ]] && has_cmd "$PYTHON_CMD"; then
    ok "Python: $($PYTHON_CMD --version 2>&1)"
    if $PYTHON_CMD -m debugpy --version &>/dev/null; then
        ok "debugpy: $($PYTHON_CMD -m debugpy --version 2>&1)"
    else
        warn "debugpy: not installed"
    fi
else
    warn "Python: not found"
fi

if has_cmd dotnet; then
    ok ".NET SDK: $(dotnet --version)"
else
    warn ".NET SDK: not found"
fi

# ==============================================================================
# Done
# ==============================================================================
echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════════════${NC}"
if $ALL_OK; then
    echo -e "  ${GREEN}✔ Setup complete! Run 'agentic-debugger --help' to get started.${NC}"
else
    echo -e "  ${YELLOW}⚠ Setup complete with warnings. Some adapters may not be available.${NC}"
    echo -e "  ${YELLOW}  Restart your terminal to pick up PATH changes, then re-run this script.${NC}"
fi
echo -e "${MAGENTA}═══════════════════════════════════════════════════════${NC}"
echo ""
