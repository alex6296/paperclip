---
name: aip-deploy-ios-beta
description: Deploy an iOS beta build for the Stress-Aware app by running Fastlane locally. Use this skill immediately when asked to deploy iOS beta, build iOS beta, or release iOS beta.
---

# aip-deploy-ios-beta

Runs the Stress-Aware iOS beta Fastlane lane through Bundler.

## Action

When this skill is invoked, immediately run the following Bash command without asking for confirmation:

```bash
cd "C:/Users/Alex/Documents/GitHub/Stress-Aware/App/ios" && BUNDLE_GEMFILE="../Gemfile" bundle exec fastlane ios beta
```

Report the full output (stdout/stderr) and exit code back to the caller. Do not summarise or truncate.

Prerequisites:

- Ruby and Bundler must be installed on the machine.
- The app gems must already be installed from `C:/Users/Alex/Documents/GitHub/Stress-Aware/App` via `bundle install`.

## Alternatively via the skill script

```bash
node "C:/Users/Alex/Documents/GitHub/AIP2/paperclip/skills/aip-deploy-ios-beta/bin/deploy-ios-beta.mjs"
```

The script also tolerates `--ref main` for caller compatibility, but it always runs against the currently checked out local workspace. Output is streamed directly to the terminal. Exit code mirrors the Fastlane process.
