#!/usr/bin/env bash
set -euo pipefail

APPIMAGE_PATH="release/OcarinaAtlas-Linux-x64.AppImage"
PORT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --appimage)
      APPIMAGE_PATH="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--appimage <path>] [--port <port>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$APPIMAGE_PATH" ]; then
  echo "ERROR: Missing Linux AppImage: $APPIMAGE_PATH" >&2
  exit 1
fi

chmod +x "$APPIMAGE_PATH"
ABS_APPIMAGE_PATH="$(cd "$(dirname "$APPIMAGE_PATH")" && pwd)/$(basename "$APPIMAGE_PATH")"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ocarina-atlas-linux-smoke.XXXXXX")"

LAUNCHER_PID=""
BRIDGE_PID=""
DUMMY_PID=""

cleanup() {
  for pid_var in "$BRIDGE_PID" "$DUMMY_PID" "$LAUNCHER_PID"; do
    if [ -n "$pid_var" ] && kill -0 "$pid_var" 2>/dev/null; then
      kill -TERM "$pid_var" 2>/dev/null || true
      wait "$pid_var" 2>/dev/null || true
    fi
  done
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node is required on PATH to run smoke test checks." >&2
  exit 1
fi

echo "Extracting $ABS_APPIMAGE_PATH into $WORK_DIR to inspect bundled resources ..."
(cd "$WORK_DIR" && "$ABS_APPIMAGE_PATH" --appimage-extract >/dev/null)

RESOURCES_DIR="$WORK_DIR/squashfs-root/resources"
for req_file in \
  "$RESOURCES_DIR/app/standalone-server.mjs" \
  "$RESOURCES_DIR/app/dist/server/server.js" \
  "$RESOURCES_DIR/bin/longshot-rpc-bridge"; do
  if [ ! -f "$req_file" ]; then
    echo "ERROR: Missing expected file in AppImage resources: $req_file" >&2
    exit 1
  fi
done

if [ ! -d "$RESOURCES_DIR/app/dist/client" ]; then
  echo "ERROR: Missing expected directory in AppImage resources: $RESOURCES_DIR/app/dist/client" >&2
  exit 1
fi

BRIDGE_BIN="$RESOURCES_DIR/bin/longshot-rpc-bridge"
if [ ! -x "$BRIDGE_BIN" ]; then
  echo "ERROR: Expected executable permission on: $BRIDGE_BIN" >&2
  exit 1
fi

pick_free_port() {
  "$NODE_BIN" -e "
    const net = require('node:net');
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      console.log(addr.port);
      srv.close();
    });
  "
}

if [ -z "$PORT" ]; then
  PORT="$(pick_free_port)"
fi

echo "Starting $ABS_APPIMAGE_PATH --appimage-extract-and-run --port $PORT --no-browser ..."
if command -v setsid >/dev/null 2>&1; then
  setsid "$ABS_APPIMAGE_PATH" --appimage-extract-and-run --no-sandbox --port "$PORT" --no-browser >"$WORK_DIR/launcher.log" 2>&1 &
else
  "$ABS_APPIMAGE_PATH" --appimage-extract-and-run --no-sandbox --port "$PORT" --no-browser >"$WORK_DIR/launcher.log" 2>&1 &
fi
LAUNCHER_PID=$!

if ! "$NODE_BIN" - "$PORT" "$LAUNCHER_PID" <<'EOF'
const port = Number(process.argv[2]);
const pid = Number(process.argv[3]);
const deadline = Date.now() + 30000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      throw new Error(`OcarinaAtlas AppImage (PID ${pid}) exited prematurely`);
    }
    try {
      const [rootRes, apiRes] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/`),
        fetch(`http://127.0.0.1:${port}/api/lichii/state`),
      ]);
      if (rootRes.status === 200 && apiRes.status === 200) {
        const data = await apiRes.json();
        for (const key of ['connected', 'emulatorRunning', 'source']) {
          if (!(key in data)) {
            throw new Error(`Missing telemetry key '${key}' in ${JSON.stringify(data)}`);
          }
        }
        console.log(`HTTP 200 OK; telemetry source=${data.source} connected=${data.connected}`);
        return;
      }
      lastErr = new Error(`Unexpected status codes: / -> ${rootRes.status}, api -> ${apiRes.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for HTTP server on port ${port}: ${lastErr}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
EOF
then
  cat "$WORK_DIR/launcher.log" >&2 || true
  exit 1
fi

echo "Sending SIGTERM to OcarinaAtlas AppImage (PID $LAUNCHER_PID) ..."
kill -TERM -"$LAUNCHER_PID" 2>/dev/null || kill -TERM "$LAUNCHER_PID" 2>/dev/null || true
wait "$LAUNCHER_PID" 2>/dev/null || true
LAUNCHER_PID=""

# Verify port closed cleanly (no orphan node server)
"$NODE_BIN" - "$PORT" <<'EOF'
const net = require('node:net');
const port = Number(process.argv[2]);

function isOpen() {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(200);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.connect(port, '127.0.0.1');
  });
}

(async () => {
  for (let i = 0; i < 20; i++) {
    if (!(await isOpen())) {
      console.log(`Port ${port} closed cleanly after SIGTERM.`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`ERROR: Port ${port} remained open after SIGTERM (orphan process).`);
  process.exit(1);
})();
EOF

echo "Running longshot-rpc-bridge --self-test ..."
"$BRIDGE_BIN" --self-test

if command -v gcc >/dev/null 2>&1; then
  cat >"$WORK_DIR/dummy_guest.c" <<'CEOF'
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <unistd.h>

#ifndef MAP_FIXED_NOREPLACE
#define MAP_FIXED_NOREPLACE 0x100000
#endif
#ifndef PR_SET_PTRACER
#define PR_SET_PTRACER 0x59616d61
#endif
#ifndef PR_SET_PTRACER_ANY
#define PR_SET_PTRACER_ANY ((unsigned long)-1)
#endif

int main(void) {
    (void)prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0);
    void *p = mmap((void *)0x100080000000ULL, 4096, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE, -1, 0);
    if (p == MAP_FAILED) {
        fprintf(stderr, "SKIP_MMAP\n");
        return 0;
    }
    const char *msg = "OOT_LINUX_BRIDGE_OK";
    memcpy((char *)p + 0x10, msg, strlen(msg));
    printf("READY\n");
    fflush(stdout);
    for (;;) {
        sleep(1);
    }
    return 0;
}
CEOF
  gcc -O2 -Wall -Wextra -Werror "$WORK_DIR/dummy_guest.c" -o "$WORK_DIR/dummy_guest"
  "$WORK_DIR/dummy_guest" >"$WORK_DIR/dummy.out" 2>"$WORK_DIR/dummy.err" &
  DUMMY_PID=$!

  for _ in $(seq 1 20); do
    if grep -q "READY" "$WORK_DIR/dummy.out" 2>/dev/null; then
      break
    fi
    if ! kill -0 "$DUMMY_PID" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  if grep -q "READY" "$WORK_DIR/dummy.out" 2>/dev/null; then
    BRIDGE_PORT="$(pick_free_port)"
    echo "Testing longshot-rpc-bridge against dummy guest PID $DUMMY_PID on port $BRIDGE_PORT ..."
    "$BRIDGE_BIN" --pid "$DUMMY_PID" --port "$BRIDGE_PORT" --once >"$WORK_DIR/bridge.log" 2>&1 &
    BRIDGE_PID=$!

    "$NODE_BIN" - "$BRIDGE_PORT" <<'EOF'
const net = require('node:net');
const port = Number(process.argv[2]);

function rpcCall(socket, id, method, params) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        socket.off('data', onData);
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.write(JSON.stringify({ id, method, params }) + '\n');
  });
}

(async () => {
  let socket = null;
  for (let i = 0; i < 20; i++) {
    try {
      socket = await new Promise((resolve, reject) => {
        const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s));
        s.once('error', reject);
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (!socket) throw new Error('Could not connect to longshot-rpc-bridge');

  const st = await rpcCall(socket, 1, 'status', { fps_window_ms: 0 });
  if (!st.result || st.result.powered_on !== true || st.result.program_id !== '0400486024DEC000') {
    throw new Error('Unexpected status: ' + JSON.stringify(st));
  }

  const expectedHex = Buffer.from('OOT_LINUX_BRIDGE_OK', 'utf8').toString('hex');
  const rm = await rpcCall(socket, 2, 'read_memory', { address: '0x80000010', size: 19, as: 'hex' });
  if (!rm.result || rm.result.hex !== expectedHex) {
    throw new Error('Unexpected read_memory: ' + JSON.stringify(rm));
  }

  const sm = await rpcCall(socket, 3, 'search_memory', {
    pattern: expectedHex,
    start: '0x80000000',
    end: '0x80001000',
    max_hits: 4,
  });
  if (!sm.result || !Array.isArray(sm.result.hits) || !sm.result.hits.includes('0x80000010')) {
    throw new Error('Unexpected search_memory: ' + JSON.stringify(sm));
  }

  socket.destroy();
  console.log('longshot-rpc-bridge dummy guest RPC check PASSED.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
EOF

    kill -TERM "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
    BRIDGE_PID=""
  else
    echo "Skipping dummy guest mmap test (0x100080000000 unavailable on this host)."
  fi

  if [ -n "$DUMMY_PID" ] && kill -0 "$DUMMY_PID" 2>/dev/null; then
    kill -TERM "$DUMMY_PID" 2>/dev/null || true
    wait "$DUMMY_PID" 2>/dev/null || true
    DUMMY_PID=""
  fi
fi

echo "Linux smoke test completed successfully."
