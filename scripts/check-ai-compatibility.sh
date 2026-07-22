#!/usr/bin/env bash
set -euo pipefail

case_name=${1:?"usage: check-ai-compatibility.sh ai6|chat-ai7"}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scratch_root=${JCODE_SCRATCH_DIR:-${RUNNER_TEMP:-/tmp}}
work=$(mktemp -d "$scratch_root/email-sdk-$case_name-XXXXXX")
trap 'rm -rf "$work"' EXIT

npm pack --silent --pack-destination "$work" "$root/packages/email-sdk" >/dev/null
tarball=$(find "$work" -maxdepth 1 -name '*.tgz' -print -quit)
mkdir "$work/app"
printf '{"private":true,"type":"module"}\n' > "$work/app/package.json"
cd "$work/app"

case "$case_name" in
  ai6)
    npm install --ignore-scripts --no-audit --no-fund "$tarball" ai@6.0.182 typescript@6.0.3 >/dev/null
    cat > probe.ts <<'EOF'
import { createEmailTools, emailToolApproval } from "@opencoredev/email-sdk/ai";
import type { SendEmailInput, SendEmailOutput } from "@opencoredev/email-sdk/ai";
import { streamText } from "ai";

const built = createEmailTools({ client: null as never, from: "sender@example.com" });
const input = null as unknown as SendEmailInput;
const output = null as unknown as SendEmailOutput;
void built;
void emailToolApproval;
void input;
void output;
void streamText;
EOF
    ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck probe.ts
    node -e 'import("@opencoredev/email-sdk/ai").then(({ createEmailTools }) => { if (typeof createEmailTools !== "function") process.exit(1) })'
    ;;
  chat-ai7)
    npm install --ignore-scripts --no-audit --no-fund "$tarball" chat@4.34.0 ai@7.0.32 zod@4.4.3 typescript@6.0.3 >/dev/null
    cat > probe.ts <<'EOF'
import { createEmailTools } from "@opencoredev/email-sdk/ai";
import { createChatTools } from "chat/ai";
import { streamText } from "ai";

const emailTools = createEmailTools({ client: null as never, from: "sender@example.com" });
const chatTools = createChatTools({ chat: null as never, preset: "messenger" });
streamText({
  model: null as never,
  prompt: "hello",
  tools: { ...chatTools, ...emailTools.tools },
  toolApproval: emailTools.toolApproval,
  experimental_toolApprovalSecret: "at-least-32-byte-secret-for-test-only",
});
EOF
    ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck probe.ts
    ;;
  *)
    echo "unknown compatibility case: $case_name" >&2
    exit 2
    ;;
esac
