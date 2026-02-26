#!/bin/bash
#
# Toggle between local and npm versions of @da-tools/da-parser
#
# SETUP (one-time):
#   cd /path/to/da-tools/da-parser
#   npm link
#
# USAGE:
#   ./scripts/toggle-local-parser.sh local   # Use local da-parser
#   ./scripts/toggle-local-parser.sh npm     # Use npm published version
#   ./scripts/toggle-local-parser.sh status  # Check current state
#

set -e

PACKAGE="@da-tools/da-parser"

check_global_link() {
  # Check if da-parser is globally linked (setup step completed)
  if npm ls -g "$PACKAGE" --depth=0 2>/dev/null | grep -q "$PACKAGE"; then
    return 0
  else
    return 1
  fi
}

check_status() {
  if [ -L "node_modules/@da-tools/da-parser" ]; then
    target=$(readlink "node_modules/@da-tools/da-parser")
    echo "LOCAL: node_modules/@da-tools/da-parser -> $target"
  else
    echo "NPM: using published package"
  fi
}

case "$1" in
  local)
    if ! check_global_link; then
      echo "ERROR: Global link not found for $PACKAGE"
      echo ""
      echo "Run the one-time setup first:"
      echo "  cd /path/to/da-tools/da-parser"
      echo "  npm link"
      exit 1
    fi
    npm link "$PACKAGE"
    echo "Switched to LOCAL da-parser"
    check_status

    # Symlink yjs from da-collab to da-tools to prevent duplicate Yjs warning
    # This ensures the bundler can resolve yjs while using the same instance
    # Resolve the symlink to get the absolute path to da-parser, then go up to da-tools
    LINK_TARGET=$(readlink "node_modules/@da-tools/da-parser")
    if [ -n "$LINK_TARGET" ]; then
      # Resolve relative path to absolute path
      DA_PARSER_DIR=$(cd "$(dirname "node_modules/@da-tools/da-parser")" && cd "$LINK_TARGET" && pwd)
      DA_TOOLS_DIR=$(dirname "$DA_PARSER_DIR")
      DA_TOOLS_YJS="$DA_TOOLS_DIR/node_modules/yjs"
      DA_COLLAB_YJS="$(pwd)/node_modules/yjs"
      
      if [ -d "$DA_COLLAB_YJS" ]; then
        if [ -L "$DA_TOOLS_YJS" ]; then
          # Already symlinked, check if it points to the right place
          CURRENT_TARGET=$(readlink "$DA_TOOLS_YJS")
          if [ "$CURRENT_TARGET" != "$DA_COLLAB_YJS" ]; then
            echo ""
            echo "Updating yjs symlink in da-tools..."
            rm "$DA_TOOLS_YJS"
            ln -s "$DA_COLLAB_YJS" "$DA_TOOLS_YJS"
            echo "Done! da-parser will use da-collab's yjs."
          fi
        elif [ -d "$DA_TOOLS_YJS" ]; then
          # Remove the directory and create a symlink instead
          echo ""
          echo "Replacing $DA_TOOLS_YJS with symlink to da-collab's yjs..."
          rm -rf "$DA_TOOLS_YJS"
          ln -s "$DA_COLLAB_YJS" "$DA_TOOLS_YJS"
          echo "Done! da-parser will use da-collab's yjs."
        elif [ ! -e "$DA_TOOLS_YJS" ]; then
          # Doesn't exist, create symlink
          echo ""
          echo "Creating symlink from da-tools to da-collab's yjs..."
          mkdir -p "$(dirname "$DA_TOOLS_YJS")"
          ln -s "$DA_COLLAB_YJS" "$DA_TOOLS_YJS"
          echo "Done! da-parser will use da-collab's yjs."
        fi
      else
        echo ""
        echo "WARNING: da-collab's yjs not found at $DA_COLLAB_YJS"
        echo "         Make sure 'npm install' has been run in da-collab."
      fi
    fi
    ;;
  npm)
    # Remove symlink manually instead of npm unlink (which can modify package.json in npm 7+)
    rm -rf "node_modules/@da-tools/da-parser"
    npm install
    echo "Switched to NPM da-parser"
    check_status
    echo ""
    echo "NOTE: If you were using local mode, you may have a yjs symlink in da-tools."
    echo "      Run 'npm install' in da-tools to restore the real yjs package if needed."
    ;;
  status)
    check_status
    ;;
  *)
    echo "Usage: $0 [local|npm|status]"
    echo ""
    echo "  local   - Use local da-parser (requires npm link setup in da-parser)"
    echo "  npm     - Use npm published version"
    echo "  status  - Check which version is currently in use"
    exit 1
    ;;
esac
