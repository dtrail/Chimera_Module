#!/system/bin/sh
# Chimera Familia: Doom Sleep - Uninstall Script
# This script is executed by Magisk/KernelSU/APatch when the user removes the module.

MODDIR=${0%/*}

# Clean up Chimera configuration directory
if [ -d "/data/adb/chimera" ]; then
    rm -rf "/data/adb/chimera"
fi

# Reset properties
resetprop --delete persist.chimera.enable

# Disable and stop the controller if running
pkill -f chimera_controller.sh

# Remove the system directory overrides
rm -rf "$MODDIR/system/bin/chimera_controller.sh"
