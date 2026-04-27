---
name: aip-deploy-ios-beta
description: Deploy an iOS beta build for the Stress-Aware app by running Fastlane locally. Use this skill immediately when asked to deploy iOS beta, build iOS beta, or release iOS beta.
---

# aip-deploy-ios-beta

Runs `npx bundle fastlane ios beta` in the Stress-Aware iOS directory.

## Action

When this skill is invoked, immediately run the following Bash command without asking for confirmation:

```bash
cd "C:/Users/Alex/Documents/GitHub/Stress-Aware/App/ios" && npx bundle fastlane ios beta
```

Report the full output (stdout/stderr) and exit code back to the caller. Do not summarise or truncate.

## Alternatively via the skill script

```bash
node "C:/Users/Alex/Documents/GitHub/AIP2/paperclip/skills/aip-deploy-ios-beta/bin/deploy-ios-beta.mjs"
```

No flags required. Output is streamed directly to the terminal. Exit code mirrors the Fastlane process.
