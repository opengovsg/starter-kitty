#!/bin/bash

# ANSI colour codes
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Colour

# Function to print error messages
print_error() {
    echo -e "${RED}[ERROR  ] $1${NC}"
}

# Function to print success messages
print_success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

# Run initial commands
pnpm lint:fix || { print_error "pnpm lint:fix failed"; exit 1; }
pnpm lint || { print_error "pnpm lint failed"; exit 1; }
pnpm build || { print_error "pnpm build failed"; exit 1; }
pnpm format || { print_error "pnpm format failed"; exit 1; }
pnpm format:check || { print_error "pnpm format:check failed"; exit 1; }

# Change directory to packages
cd packages || exit 1

# Variable to track API Extractor failures
api_extractor_failure=0

# Loop through each folder that doesn't end with -config
for dir in */; do
    if [[ ! $dir == *-config/ ]]; then
        echo "Processing $dir"
        (
            cd "$dir" || exit 1
            pnpx @microsoft/api-extractor run --verbose
        )
        if [ $? -ne 0 ]; then
            print_error "api-extractor failed for $dir"
            api_extractor_failure=1
        fi
    fi
done

if [ $api_extractor_failure -eq 0 ]; then
    print_success "All API Extractor operations completed successfully"
else
    print_error "One or more API Extractor operations failed"
    exit 1
fi

echo "----------------------------------------"
echo "Checking package.json modifications:"
echo "----------------------------------------"

# Check if package.json has been modified in each relevant folder
package_json_modified=0
for dir in */; do
    if [[ ! $dir == *-config/ ]]; then
        if git diff --quiet HEAD -- "$dir/package.json"; then
            echo -e "${RED}package.json in $dir has NOT been modified${NC}"
        else
            echo -e "${GREEN}package.json in $dir has been modified${NC}"
            package_json_modified=1
        fi
    fi
done

if [ $package_json_modified -eq 0 ]; then
    print_error "No package.json was modified"
    exit 1
fi

# If we've made it this far, all checks have passed
echo "----------------------------------------"
print_success "Pre-commit checks all succeeded!"
echo "----------------------------------------"
exit 0