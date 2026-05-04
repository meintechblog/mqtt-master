#!/bin/bash
# Quick deploy to VM for live preview
# Usage: ./scripts/deploy-vm.sh

VM_HOST="root@mqtt-master.local"
VM_PATH="/opt/mqtt-master"

echo "🚀 Deploying to mqtt-master.local..."

rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.planning' \
  --exclude='.claude' \
  --exclude='tests' \
  --exclude='.gitignore' \
  --exclude='config.json' \
  /Users/hulki/codex/mqtt-master/ ${VM_HOST}:${VM_PATH}/

echo "📦 Installing dependencies..."
ssh ${VM_HOST} "cd ${VM_PATH} && npm install --production --quiet 2>&1 | tail -3"

echo "🔄 Restarting service..."
ssh ${VM_HOST} "systemctl restart mqtt-master"

sleep 1
STATUS=$(ssh ${VM_HOST} "systemctl is-active mqtt-master")
if [ "$STATUS" = "active" ]; then
  echo "✅ Deployed! Live at http://mqtt-master.local"
else
  echo "❌ Service failed to start!"
  ssh ${VM_HOST} "journalctl -u mqtt-master --no-pager -n 20"
fi
