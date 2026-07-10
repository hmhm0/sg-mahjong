#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"
exec npm run deploy:vm
