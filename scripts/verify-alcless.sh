#!/bin/bash
# scripts/verify-alcless.sh

echo "--- Alcless Baseline Verification ---"

# 1. Check if alclessctl is in PATH
if ! command -v alclessctl &> /dev/null; then
    echo "Error: alclessctl is not installed or not in PATH."
    echo "Please install it by running:"
    echo "  git clone https://github.com/AkihiroSuda/alcless"
    echo "  cd alcless && make && sudo make install"
    exit 1
fi

echo "Success: alclessctl is installed."

# 2. Check alcless version
VERSION=$(alclessctl --version)
echo "Alcless Version: $VERSION"

# 3. Check if 'default' sandbox exists
echo "Checking for 'default' sandbox..."
if alclessctl ls | grep -q "default"; then
    echo "Success: 'default' sandbox exists."
else
    echo "Warning: 'default' sandbox not found."
    echo "Please create it by running: alclessctl create default"
    exit 1
fi

# 4. Try to run whoami in the sandbox
echo "Testing sandbox execution (requires sudo access)..."
SANDBOX_USER=$(alclessctl shell default -- whoami 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "Success: Sandbox user is $SANDBOX_USER"
else
    echo "Error: Could not execute command in sandbox."
    echo "Ensure your user has NOPASSWD sudo access for alcless commands as per README."
    exit 1
fi

echo "--- Verification Complete ---"
