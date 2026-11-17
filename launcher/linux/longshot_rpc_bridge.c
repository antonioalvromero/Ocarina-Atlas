#define _GNU_SOURCE

#include <arpa/inet.h>
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define GUEST_WINDOW_BASE 0x100000000000ULL
#define GUEST_WINDOW_SIZE 0x8000000000ULL
#define GUEST_CODE_BASE 0x80000000ULL
#define LONGSHOT_HEAP_BASE 0x1000000000ULL
#define LONGSHOT_HEAP_END 0x2000000000ULL
#define STANDARD_HEAP_THRESHOLD 0x2000000000ULL

#define MAX_READ_MEMORY_SIZE 262144
#define SEARCH_CHUNK_SIZE 1048576
#define DEFAULT_MAX_HITS 64
#define MAX_ALLOWED_HITS 1024
#define DEFAULT_BRIDGE_PORT 6545
#define OOT_PROGRAM_ID "0400486024DEC000"

typedef struct {
    pid_t pid;
    uint64_t starttime;
    bool has_starttime;
    char emulator[32];
    char save_dir[PATH_MAX];
    bool has_save_dir;
    bool attached;
} target_state_t;

typedef struct {
    uint64_t start;
    uint64_t end;
} mem_region_t;

typedef struct {
    mem_region_t *items;
    size_t count;
    size_t capacity;
} region_list_t;

typedef struct {
    uint64_t *items;
    size_t count;
    size_t capacity;
} hit_list_t;

typedef struct client_node {
    int fd;
    pthread_t thread;
    bool finished;
    struct client_node *next;
} client_node_t;

static volatile sig_atomic_t g_stop = 0;
static pthread_mutex_t g_target_mutex = PTHREAD_MUTEX_INITIALIZER;
static target_state_t g_target = {0, 0, false, "longshot", "", false, false};
static pid_t g_forced_pid = 0;
static bool g_yama_warned = false;
static pthread_mutex_t g_diag_mutex = PTHREAD_MUTEX_INITIALIZER;
static bool g_once_mode = false;

static pthread_mutex_t g_clients_mutex = PTHREAD_MUTEX_INITIALIZER;
static client_node_t *g_clients_head = NULL;

static void on_signal(int sig) {
    (void)sig;
    g_stop = 1;
}

static uint64_t monotonic_ms(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        return 0;
    }
    return (uint64_t)ts.tv_sec * 1000ULL + (uint64_t)(ts.tv_nsec / 1000000L);
}

static const char *classify_target_name(const char *name) {
    if (!name || !*name) {
        return NULL;
    }
    if (strcasecmp(name, "hookshot") == 0 ||
        strcasecmp(name, "longshot") == 0 ||
        strcasecmp(name, "heylisten") == 0) {
        return "longshot";
    }
    if (strcasecmp(name, "relink-game") == 0 || strcasecmp(name, "relink") == 0) {
        return "relink";
    }
    if (strcasecmp(name, "triforce") == 0) {
        return "triforce";
    }
    return NULL;
}

static bool ends_with_ignore_case(const char *str, size_t len, const char *suffix) {
    size_t slen = strlen(suffix);
    if (len < slen) {
        return false;
    }
    return strcasecmp(str + (len - slen), suffix) == 0;
}

static const char *match_normalized_target(const char *raw_name, bool allow_truncated_comm) {
    if (!raw_name || !*raw_name) {
        return NULL;
    }

    const char *base = raw_name;
    for (const char *p = raw_name; *p; p++) {
        if (*p == '/' || *p == '\\') {
            base = p + 1;
        }
    }
    if (!*base) {
        return NULL;
    }

    size_t raw_len = strlen(base);
    char buf[256];
    if (raw_len >= sizeof(buf)) {
        raw_len = sizeof(buf) - 1;
    }
    memcpy(buf, base, raw_len);
    buf[raw_len] = '\0';

    size_t len = raw_len;
    bool stripped = true;
    while (stripped) {
        stripped = false;
        static const char *const suffixes[] = {".exe", ".appimage", ".x86_64"};
        for (size_t i = 0; i < sizeof(suffixes) / sizeof(suffixes[0]); i++) {
            if (ends_with_ignore_case(buf, len, suffixes[i])) {
                len -= strlen(suffixes[i]);
                buf[len] = '\0';
                stripped = true;
                break;
            }
        }
    }

    const char *emu = classify_target_name(buf);
    if (emu) {
        return emu;
    }

    /* Linux /proc/<pid>/comm is limited to 15 chars (TASK_COMM_LEN - 1), which can truncate
     * suffixes like ".AppImage" or ".x86_64" (e.g. "HeyListen.AppIm", "relink-game.x86"). */
    if (allow_truncated_comm && raw_len >= 15) {
        char *dot = strchr(buf, '.');
        if (dot && dot != buf) {
            *dot = '\0';
            emu = classify_target_name(buf);
            if (emu) {
                return emu;
            }
        }
    }

    return NULL;
}

static bool read_proc_stat_info(pid_t pid, char *out_state, uint64_t *out_starttime) {
    if (pid <= 0) {
        return false;
    }
    char stat_path[64];
    snprintf(stat_path, sizeof(stat_path), "/proc/%ld/stat", (long)pid);
    FILE *fp = fopen(stat_path, "r");
    if (!fp) {
        return false;
    }
    char buf[2048];
    size_t n = fread(buf, 1, sizeof(buf) - 1, fp);
    fclose(fp);
    if (n == 0) {
        return false;
    }
    buf[n] = '\0';

    const char *rparen = strrchr(buf, ')');
    if (!rparen) {
        return false;
    }
    const char *p = rparen + 1;
    while (*p == ' ') {
        p++;
    }
    if (!*p) {
        return false;
    }
    if (out_state) {
        *out_state = *p;
    }

    if (out_starttime) {
        /* Field 3 is state (token 0 after ')'); field 22 is starttime (token 19). */
        for (int tok = 0; tok < 19; tok++) {
            while (*p && *p != ' ') {
                p++;
            }
            while (*p == ' ') {
                p++;
            }
            if (!*p) {
                return false;
            }
        }
        char *endp = NULL;
        errno = 0;
        unsigned long long st = strtoull(p, &endp, 10);
        if (errno != 0 || endp == p) {
            return false;
        }
        *out_starttime = (uint64_t)st;
    }
    return true;
}

static bool is_pid_alive(pid_t pid, bool check_starttime, uint64_t expected_starttime) {
    if (pid <= 0) {
        return false;
    }
    if (kill(pid, 0) != 0 && errno == ESRCH) {
        return false;
    }
    char state = '\0';
    uint64_t starttime = 0;
    if (!read_proc_stat_info(pid, &state, check_starttime ? &starttime : NULL)) {
        return false;
    }
    if (state == 'Z' || state == 'X') {
        return false;
    }
    if (check_starttime && starttime != expected_starttime) {
        return false;
    }
    return true;
}

static void print_yama_diagnostic_once(pid_t pid) {
    pthread_mutex_lock(&g_diag_mutex);
    if (g_yama_warned) {
        pthread_mutex_unlock(&g_diag_mutex);
        return;
    }
    g_yama_warned = true;
    pthread_mutex_unlock(&g_diag_mutex);
    fprintf(stderr,
        "[longshot-rpc-bridge] Read-only memory access to PID %ld failed with EPERM (likely kernel.yama.ptrace_scope).\n"
        "  To allow read-only telemetry for external processes on Linux, use one of:\n"
        "    1) Temporarily: sudo sysctl -w kernel.yama.ptrace_scope=0\n"
        "    2) Binary cap : sudo setcap cap_sys_ptrace=eip <path-to-longshot-rpc-bridge>\n"
        "    3) Launch the game as a child of the OcarinaAtlas launcher.\n",
        (long)pid);
}

static bool read_remote_memory(pid_t pid, uint64_t remote_addr, void *buf, size_t size, int *out_errno) {
    if (out_errno) {
        *out_errno = 0;
    }
    if (pid <= 0 || !buf || size == 0) {
        if (out_errno) *out_errno = EINVAL;
        return false;
    }

    uint8_t *dst = (uint8_t *)buf;
    size_t total = 0;
    while (total < size) {
        struct iovec local_iov;
        struct iovec remote_iov;
        local_iov.iov_base = dst + total;
        local_iov.iov_len = size - total;
        remote_iov.iov_base = (void *)(uintptr_t)(remote_addr + total);
        remote_iov.iov_len = size - total;

        ssize_t n = process_vm_readv(pid, &local_iov, 1, &remote_iov, 1, 0);
        if (n > 0) {
            total += (size_t)n;
            continue;
        }
        if (n < 0 && errno == EINTR) {
            continue;
        }
        int err = errno;
        if (err != ENOSYS && err != EPERM) {
            if (out_errno) *out_errno = err;
            return false;
        }
        break;
    }
    if (total == size) {
        return true;
    }

    char mem_path[64];
    snprintf(mem_path, sizeof(mem_path), "/proc/%ld/mem", (long)pid);
    int fd = open(mem_path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        int err = errno;
        if (err == EPERM || err == EACCES) {
            print_yama_diagnostic_once(pid);
        }
        if (out_errno) *out_errno = err;
        return false;
    }

    total = 0;
    while (total < size) {
        uint64_t off_u = remote_addr + total;
        if (off_u > (uint64_t)INT64_MAX) {
            close(fd);
            if (out_errno) *out_errno = EINVAL;
            return false;
        }
        ssize_t n = pread(fd, dst + total, size - total, (off_t)off_u);
        if (n > 0) {
            total += (size_t)n;
            continue;
        }
        if (n < 0 && errno == EINTR) {
            continue;
        }
        int err = (n == 0) ? EFAULT : errno;
        if (err == EPERM || err == EACCES) {
            print_yama_diagnostic_once(pid);
        }
        close(fd);
        if (out_errno) *out_errno = err;
        return false;
    }

    close(fd);
    return true;
}

static bool parse_maps_line(const char *line, uint64_t *out_start, uint64_t *out_end, bool *out_readable) {
    char *endp = NULL;
    errno = 0;
    unsigned long long start = strtoull(line, &endp, 16);
    if (errno != 0 || endp == line || *endp != '-') {
        return false;
    }
    const char *p = endp + 1;
    errno = 0;
    unsigned long long end = strtoull(p, &endp, 16);
    if (errno != 0 || endp == p || (*endp != ' ' && *endp != '\t')) {
        return false;
    }
    p = endp;
    while (*p == ' ' || *p == '\t') {
        p++;
    }
    if (!p[0] || !p[1] || !p[2] || !p[3]) {
        return false;
    }
    *out_start = (uint64_t)start;
    *out_end = (uint64_t)end;
    *out_readable = (p[0] == 'r');
    return true;
}

static bool verify_guest_code_mapped(pid_t pid, int *out_err) {
    if (out_err) {
        *out_err = 0;
    }
    char maps_path[64];
    snprintf(maps_path, sizeof(maps_path), "/proc/%ld/maps", (long)pid);
    FILE *fp = fopen(maps_path, "r");
    if (!fp) {
        if (out_err) *out_err = errno;
        return false;
    }

    const uint64_t probe_addr = GUEST_WINDOW_BASE + GUEST_CODE_BASE;
    bool found_mapping = false;
    char line[4096];
    while (fgets(line, sizeof(line), fp) != NULL) {
        size_t len = strlen(line);
        if (len > 0 && line[len - 1] != '\n') {
            int ch;
            while ((ch = fgetc(fp)) != EOF && ch != '\n') {
            }
        }
        uint64_t start = 0;
        uint64_t end = 0;
        bool readable = false;
        if (!parse_maps_line(line, &start, &end, &readable)) {
            continue;
        }
        if (readable && start <= probe_addr && end >= probe_addr + 8ULL) {
            found_mapping = true;
            break;
        }
    }
    fclose(fp);

    if (!found_mapping) {
        return false;
    }

    uint8_t probe[8];
    int read_err = 0;
    if (!read_remote_memory(pid, probe_addr, probe, sizeof(probe), &read_err)) {
        if (out_err) *out_err = read_err;
        return false;
    }
    return true;
}

static bool format_user_dir_from_exe_path(const char *raw_exe_path, char *out_buf, size_t out_cap) {
    if (!raw_exe_path || !*raw_exe_path || !out_buf || out_cap == 0) {
        return false;
    }
    char exe_path[PATH_MAX];
    snprintf(exe_path, sizeof(exe_path), "%s", raw_exe_path);

    char *last_slash = strrchr(exe_path, '/');
    if (!last_slash || last_slash == exe_path) {
        return false;
    }
    *last_slash = '\0';

    size_t dir_len = strlen(exe_path);
    while (dir_len > 1 && exe_path[dir_len - 1] == '/') {
        exe_path[--dir_len] = '\0';
    }

    char *leaf = strrchr(exe_path, '/');
    const char *leaf_name = leaf ? (leaf + 1) : exe_path;
    if (strcasecmp(leaf_name, "bin") == 0 && leaf && leaf != exe_path) {
        *leaf = '\0';
    }

    int written = snprintf(out_buf, out_cap, "%s/user", exe_path);
    return written > 0 && (size_t)written < out_cap;
}

static bool resolve_user_save_dir(pid_t pid, char *out_buf, size_t out_cap) {
    if (!out_buf || out_cap == 0) {
        return false;
    }
    out_buf[0] = '\0';

    /* For Wine/Proton processes, argv[0] may be a Z:\... path pointing to the Linux filesystem. */
    char cmd_path[64];
    snprintf(cmd_path, sizeof(cmd_path), "/proc/%ld/cmdline", (long)pid);
    int fd = open(cmd_path, O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        char cmd[PATH_MAX];
        ssize_t cn = read(fd, cmd, sizeof(cmd) - 1);
        close(fd);
        if (cn > 0) {
            cmd[cn] = '\0';
            if ((cmd[0] == 'Z' || cmd[0] == 'z') && cmd[1] == ':' && (cmd[2] == '\\' || cmd[2] == '/')) {
                char unix_path[PATH_MAX];
                size_t j = 0;
                for (size_t i = 2; cmd[i] != '\0' && j + 1 < sizeof(unix_path); i++) {
                    unix_path[j++] = (cmd[i] == '\\') ? '/' : cmd[i];
                }
                unix_path[j] = '\0';
                if (format_user_dir_from_exe_path(unix_path, out_buf, out_cap) && access(out_buf, F_OK) == 0) {
                    return true;
                }
                out_buf[0] = '\0';
            }
        }
    }

    char exe_link[64];
    snprintf(exe_link, sizeof(exe_link), "/proc/%ld/exe", (long)pid);

    char exe_path[PATH_MAX];
    ssize_t n = readlink(exe_link, exe_path, sizeof(exe_path) - 1);
    if (n <= 0) {
        return false;
    }
    exe_path[n] = '\0';

    return format_user_dir_from_exe_path(exe_path, out_buf, out_cap);
}

static bool match_proc_name(pid_t pid, const char **out_emulator) {
    char comm_path[64];
    snprintf(comm_path, sizeof(comm_path), "/proc/%ld/comm", (long)pid);
    FILE *fp = fopen(comm_path, "r");
    if (fp) {
        char comm[128];
        if (fgets(comm, sizeof(comm), fp) != NULL) {
            size_t len = strlen(comm);
            while (len > 0 && (comm[len - 1] == '\n' || comm[len - 1] == '\r')) {
                comm[--len] = '\0';
            }
            const char *emu = match_normalized_target(comm, true);
            if (emu) {
                fclose(fp);
                *out_emulator = emu;
                return true;
            }
        }
        fclose(fp);
    }

    char cmd_path[64];
    snprintf(cmd_path, sizeof(cmd_path), "/proc/%ld/cmdline", (long)pid);
    int fd = open(cmd_path, O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        char cmd[PATH_MAX];
        ssize_t n = read(fd, cmd, sizeof(cmd) - 1);
        close(fd);
        if (n > 0) {
            cmd[n] = '\0';
            const char *emu = match_normalized_target(cmd, false);
            if (emu) {
                *out_emulator = emu;
                return true;
            }
        }
    }

    char exe_link[64];
    snprintf(exe_link, sizeof(exe_link), "/proc/%ld/exe", (long)pid);
    char exe_path[PATH_MAX];
    ssize_t en = readlink(exe_link, exe_path, sizeof(exe_path) - 1);
    if (en > 0) {
        exe_path[en] = '\0';
        const char *emu = match_normalized_target(exe_path, false);
        if (emu) {
            *out_emulator = emu;
            return true;
        }
    }

    return false;
}

static bool discover_target(target_state_t *out_state) {
    memset(out_state, 0, sizeof(*out_state));
    snprintf(out_state->emulator, sizeof(out_state->emulator), "longshot");

    if (g_forced_pid > 0) {
        if (!is_pid_alive(g_forced_pid, false, 0)) {
            return false;
        }
        int err = 0;
        if (!verify_guest_code_mapped(g_forced_pid, &err)) {
            return false;
        }
        const char *emu = "longshot";
        match_proc_name(g_forced_pid, &emu);
        out_state->pid = g_forced_pid;
        out_state->has_starttime = read_proc_stat_info(g_forced_pid, NULL, &out_state->starttime);
        snprintf(out_state->emulator, sizeof(out_state->emulator), "%s", emu);
        out_state->has_save_dir = resolve_user_save_dir(g_forced_pid, out_state->save_dir, sizeof(out_state->save_dir));
        out_state->attached = true;
        return true;
    }

    DIR *proc_dir = opendir("/proc");
    if (!proc_dir) {
        return false;
    }

    pid_t self_pid = getpid();
    struct dirent *ent;
    while ((ent = readdir(proc_dir)) != NULL) {
        const char *dname = ent->d_name;
        if (!isdigit((unsigned char)dname[0])) {
            continue;
        }
        bool all_digits = true;
        for (size_t i = 0; dname[i] != '\0'; i++) {
            if (!isdigit((unsigned char)dname[i])) {
                all_digits = false;
                break;
            }
        }
        if (!all_digits) {
            continue;
        }

        long pid_val = strtol(dname, NULL, 10);
        if (pid_val <= 0 || (pid_t)pid_val == self_pid) {
            continue;
        }
        pid_t pid = (pid_t)pid_val;

        const char *emu = NULL;
        if (!match_proc_name(pid, &emu)) {
            continue;
        }

        int verify_err = 0;
        if (!verify_guest_code_mapped(pid, &verify_err)) {
            continue;
        }

        out_state->pid = pid;
        out_state->has_starttime = read_proc_stat_info(pid, NULL, &out_state->starttime);
        snprintf(out_state->emulator, sizeof(out_state->emulator), "%s", emu);
        out_state->has_save_dir = resolve_user_save_dir(pid, out_state->save_dir, sizeof(out_state->save_dir));
        out_state->attached = true;
        closedir(proc_dir);
        return true;
    }

    closedir(proc_dir);
    return false;
}

static bool refresh_target_locked(bool allow_discover) {
    if (g_target.attached) {
        if (is_pid_alive(g_target.pid, g_target.has_starttime, g_target.starttime)) {
            return true;
        }
        fprintf(stderr, "[longshot-rpc-bridge] Target PID %ld exited.\n", (long)g_target.pid);
        g_target.attached = false;
        g_target.pid = 0;
        g_target.starttime = 0;
        g_target.has_starttime = false;
        g_target.save_dir[0] = '\0';
        g_target.has_save_dir = false;
        if (g_once_mode) {
            g_stop = 1;
            return false;
        }
    }

    if (!allow_discover || g_stop) {
        return false;
    }

    target_state_t found;
    if (discover_target(&found)) {
        g_target = found;
        fprintf(stderr,
            "[longshot-rpc-bridge] Attached read-only to PID %ld (%s, saves: %s).\n",
            (long)g_target.pid,
            g_target.emulator,
            g_target.has_save_dir ? g_target.save_dir : "none");
        return true;
    }
    return false;
}

static bool collect_readable_regions(pid_t pid, uint64_t range_start, uint64_t range_end, region_list_t *out_list) {
    out_list->items = NULL;
    out_list->count = 0;
    out_list->capacity = 0;

    if (range_end <= range_start) {
        return true;
    }

    char maps_path[64];
    snprintf(maps_path, sizeof(maps_path), "/proc/%ld/maps", (long)pid);
    FILE *fp = fopen(maps_path, "r");
    if (!fp) {
        return false;
    }

    char line[4096];
    while (fgets(line, sizeof(line), fp) != NULL) {
        size_t len = strlen(line);
        if (len > 0 && line[len - 1] != '\n') {
            int ch;
            while ((ch = fgetc(fp)) != EOF && ch != '\n') {
            }
        }
        uint64_t start = 0;
        uint64_t end = 0;
        bool readable = false;
        if (!parse_maps_line(line, &start, &end, &readable) || !readable) {
            continue;
        }
        if (end <= range_start || start >= range_end) {
            continue;
        }
        uint64_t clipped_start = start > range_start ? start : range_start;
        uint64_t clipped_end = end < range_end ? end : range_end;
        if (clipped_end <= clipped_start) {
            continue;
        }

        if (out_list->count > 0 && out_list->items[out_list->count - 1].end == clipped_start) {
            out_list->items[out_list->count - 1].end = clipped_end;
            continue;
        }

        if (out_list->count == out_list->capacity) {
            size_t next_cap = out_list->capacity == 0 ? 64 : out_list->capacity * 2;
            mem_region_t *grown = (mem_region_t *)realloc(out_list->items, next_cap * sizeof(mem_region_t));
            if (!grown) {
                free(out_list->items);
                out_list->items = NULL;
                out_list->count = 0;
                out_list->capacity = 0;
                fclose(fp);
                return false;
            }
            out_list->items = grown;
            out_list->capacity = next_cap;
        }

        out_list->items[out_list->count].start = clipped_start;
        out_list->items[out_list->count].end = clipped_end;
        out_list->count++;
    }

    fclose(fp);
    return true;
}

static bool add_hit(hit_list_t *hits, uint64_t guest_addr) {
    if (hits->count == hits->capacity) {
        size_t next_cap = hits->capacity == 0 ? 32 : hits->capacity * 2;
        uint64_t *grown = (uint64_t *)realloc(hits->items, next_cap * sizeof(uint64_t));
        if (!grown) {
            return false;
        }
        hits->items = grown;
        hits->capacity = next_cap;
    }
    hits->items[hits->count++] = guest_addr;
    return true;
}

static void match_buffer(
    const uint8_t *buf,
    size_t buf_len,
    uint64_t base_host_addr,
    const uint8_t *pattern_bytes,
    const uint8_t *pattern_mask,
    size_t pattern_len,
    ssize_t anchor_idx,
    size_t max_hits,
    hit_list_t *hits
) {
    if (buf_len < pattern_len || pattern_len == 0) {
        return;
    }
    size_t max_start = buf_len - pattern_len;

    if (anchor_idx < 0) {
        for (size_t i = 0; i <= max_start && hits->count < max_hits; i++) {
            uint64_t guest_addr = (base_host_addr + (uint64_t)i) - GUEST_WINDOW_BASE;
            if (!add_hit(hits, guest_addr)) {
                break;
            }
        }
        return;
    }

    uint8_t anchor_byte = pattern_bytes[anchor_idx];
    size_t search_pos = (size_t)anchor_idx;
    size_t search_end = max_start + (size_t)anchor_idx;

    while (search_pos <= search_end && hits->count < max_hits) {
        const uint8_t *found = (const uint8_t *)memchr(
            buf + search_pos,
            anchor_byte,
            (search_end - search_pos) + 1);
        if (!found) {
            break;
        }
        size_t found_idx = (size_t)(found - buf);
        size_t start = found_idx - (size_t)anchor_idx;

        bool matched = true;
        for (size_t k = 0; k < pattern_len; k++) {
            if (pattern_mask[k] && buf[start + k] != pattern_bytes[k]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            uint64_t guest_addr = (base_host_addr + (uint64_t)start) - GUEST_WINDOW_BASE;
            if (!add_hit(hits, guest_addr)) {
                break;
            }
        }

        search_pos = found_idx + 1;
    }
}

static void search_host_range(
    pid_t pid,
    uint64_t range_start_host,
    uint64_t range_end_host,
    const uint8_t *pattern_bytes,
    const uint8_t *pattern_mask,
    size_t pattern_len,
    ssize_t anchor_idx,
    size_t max_hits,
    hit_list_t *hits,
    uint64_t start_ms,
    int budget_ms,
    uint8_t *scan_buf,
    size_t scan_buf_len
) {
    region_list_t regions;
    if (!collect_readable_regions(pid, range_start_host, range_end_host, &regions)) {
        return;
    }

    size_t overlap = pattern_len - 1;
    for (size_t r = 0; r < regions.count && hits->count < max_hits && !g_stop; r++) {
        if (budget_ms > 0 && (monotonic_ms() - start_ms) >= (uint64_t)budget_ms) {
            break;
        }
        uint64_t scan_start = regions.items[r].start;
        uint64_t scan_end = regions.items[r].end;
        if (scan_end <= scan_start || (scan_end - scan_start) < pattern_len) {
            continue;
        }

        uint64_t cursor = scan_start;
        while (cursor < scan_end && hits->count < max_hits && !g_stop) {
            if (budget_ms > 0 && (monotonic_ms() - start_ms) >= (uint64_t)budget_ms) {
                break;
            }
            uint64_t remaining = scan_end - cursor;
            if (remaining < pattern_len) {
                break;
            }
            size_t to_read = remaining > (uint64_t)scan_buf_len
                ? scan_buf_len
                : (size_t)remaining;

            int read_err = 0;
            if (!read_remote_memory(pid, cursor, scan_buf, to_read, &read_err)) {
                break;
            }

            match_buffer(
                scan_buf,
                to_read,
                cursor,
                pattern_bytes,
                pattern_mask,
                pattern_len,
                anchor_idx,
                max_hits,
                hits);

            if (cursor + (uint64_t)to_read >= scan_end || to_read <= overlap) {
                break;
            }
            cursor += (uint64_t)(to_read - overlap);
        }
    }

    free(regions.items);
}

static bool hex_nibble(char c, uint8_t *out) {
    if (c >= '0' && c <= '9') { *out = (uint8_t)(c - '0'); return true; }
    if (c >= 'a' && c <= 'f') { *out = (uint8_t)(c - 'a' + 10); return true; }
    if (c >= 'A' && c <= 'F') { *out = (uint8_t)(c - 'A' + 10); return true; }
    return false;
}

static bool parse_hex_pattern(const char *pattern, uint8_t **out_bytes, uint8_t **out_mask, size_t *out_len) {
    if (!pattern || !*pattern) {
        return false;
    }

    size_t raw_len = strlen(pattern);
    char *clean = (char *)malloc(raw_len + 1);
    if (!clean) {
        return false;
    }

    size_t clean_len = 0;
    for (size_t i = 0; i < raw_len; i++) {
        if (!isspace((unsigned char)pattern[i])) {
            clean[clean_len++] = pattern[i];
        }
    }
    clean[clean_len] = '\0';

    if (clean_len < 2 || (clean_len % 2) != 0) {
        free(clean);
        return false;
    }

    size_t byte_len = clean_len / 2;
    uint8_t *bytes = (uint8_t *)malloc(byte_len);
    uint8_t *mask = (uint8_t *)malloc(byte_len);
    if (!bytes || !mask) {
        free(clean);
        free(bytes);
        free(mask);
        return false;
    }

    for (size_t i = 0; i < byte_len; i++) {
        char hi = clean[i * 2];
        char lo = clean[i * 2 + 1];
        if (hi == '?' && lo == '?') {
            bytes[i] = 0;
            mask[i] = 0;
        } else {
            uint8_t h = 0, l = 0;
            if (!hex_nibble(hi, &h) || !hex_nibble(lo, &l)) {
                free(clean);
                free(bytes);
                free(mask);
                return false;
            }
            bytes[i] = (uint8_t)((h << 4) | l);
            mask[i] = 1;
        }
    }

    free(clean);
    *out_bytes = bytes;
    *out_mask = mask;
    *out_len = byte_len;
    return true;
}

static bool parse_u64_str(const char *s, uint64_t *out) {
    if (!s) {
        return false;
    }
    while (*s && isspace((unsigned char)*s)) {
        s++;
    }
    if (!*s) {
        return false;
    }
    char *endp = NULL;
    errno = 0;
    unsigned long long v;
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        if (!isxdigit((unsigned char)s[2])) {
            return false;
        }
        v = strtoull(s + 2, &endp, 16);
    } else {
        if (!isdigit((unsigned char)s[0])) {
            return false;
        }
        v = strtoull(s, &endp, 10);
    }
    if (errno != 0 || endp == s) {
        return false;
    }
    while (*endp && isspace((unsigned char)*endp)) {
        endp++;
    }
    if (*endp != '\0') {
        return false;
    }
    *out = (uint64_t)v;
    return true;
}

/* Minimal, strict JSON helper for Lichii JSON-RPC request objects */
typedef struct {
    bool has_id;
    char id_json[256];
    bool has_method;
    char method[64];
    bool has_params;

    bool has_address;
    uint64_t address;
    bool has_size;
    int64_t size;

    bool has_pattern;
    char *pattern;
    bool has_regions;
    char regions[64];
    bool has_start;
    uint64_t start;
    bool has_end;
    uint64_t end;
    bool has_max_hits;
    int64_t max_hits;
    bool has_budget_ms;
    int64_t budget_ms;
} rpc_request_t;

static void rpc_request_free(rpc_request_t *req) {
    if (req->pattern) {
        free(req->pattern);
        req->pattern = NULL;
    }
}

static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') {
        p++;
    }
    return p;
}

static bool parse_json_string_alloc(const char **pp, char **out_str) {
    const char *p = *pp;
    if (*p != '"') {
        return false;
    }
    p++;

    size_t cap = 64;
    size_t len = 0;
    char *buf = (char *)malloc(cap);
    if (!buf) {
        return false;
    }

    while (*p != '\0' && *p != '"') {
        unsigned char c = (unsigned char)*p;
        if (c < 0x20) {
            free(buf);
            return false;
        }
        char ch;
        if (c == '\\') {
            p++;
            if (*p == '\0') {
                free(buf);
                return false;
            }
            switch (*p) {
                case '"': ch = '"'; break;
                case '\\': ch = '\\'; break;
                case '/': ch = '/'; break;
                case 'b': ch = '\b'; break;
                case 'f': ch = '\f'; break;
                case 'n': ch = '\n'; break;
                case 'r': ch = '\r'; break;
                case 't': ch = '\t'; break;
                case 'u': {
                    uint32_t cp = 0;
                    for (int i = 0; i < 4; i++) {
                        p++;
                        uint8_t nib = 0;
                        if (!hex_nibble(*p, &nib)) {
                            free(buf);
                            return false;
                        }
                        cp = (cp << 4) | nib;
                    }
                    ch = (cp < 0x80) ? (char)cp : '?';
                    break;
                }
                default:
                    free(buf);
                    return false;
            }
            p++;
        } else {
            ch = (char)*p;
            p++;
        }

        if (len + 2 > cap) {
            size_t next_cap = cap * 2;
            char *grown = (char *)realloc(buf, next_cap);
            if (!grown) {
                free(buf);
                return false;
            }
            buf = grown;
            cap = next_cap;
        }
        buf[len++] = ch;
    }

    if (*p != '"') {
        free(buf);
        return false;
    }
    p++;
    buf[len] = '\0';
    *pp = p;
    if (out_str) {
        *out_str = buf;
    } else {
        free(buf);
    }
    return true;
}

static bool skip_json_value(const char **pp);

static bool skip_json_container(const char **pp, char open_ch, char close_ch) {
    const char *p = *pp;
    if (*p != open_ch) {
        return false;
    }
    p = skip_ws(p + 1);
    if (*p == close_ch) {
        *pp = p + 1;
        return true;
    }
    for (;;) {
        if (open_ch == '{') {
            if (!parse_json_string_alloc(&p, NULL)) {
                return false;
            }
            p = skip_ws(p);
            if (*p != ':') {
                return false;
            }
            p = skip_ws(p + 1);
        }
        if (!skip_json_value(&p)) {
            return false;
        }
        p = skip_ws(p);
        if (*p == ',') {
            p = skip_ws(p + 1);
            continue;
        }
        if (*p == close_ch) {
            *pp = p + 1;
            return true;
        }
        return false;
    }
}

static bool skip_json_value(const char **pp) {
    const char *p = skip_ws(*pp);
    if (*p == '"') {
        *pp = p;
        return parse_json_string_alloc(pp, NULL);
    }
    if (*p == '{') {
        *pp = p;
        return skip_json_container(pp, '{', '}');
    }
    if (*p == '[') {
        *pp = p;
        return skip_json_container(pp, '[', ']');
    }
    if (strncmp(p, "true", 4) == 0) {
        *pp = p + 4;
        return true;
    }
    if (strncmp(p, "false", 5) == 0) {
        *pp = p + 5;
        return true;
    }
    if (strncmp(p, "null", 4) == 0) {
        *pp = p + 4;
        return true;
    }
    if (*p == '-' || isdigit((unsigned char)*p)) {
        char *endp = NULL;
        (void)strtod(p, &endp);
        if (endp == p) {
            return false;
        }
        *pp = endp;
        return true;
    }
    return false;
}

static bool parse_json_int_or_u64(const char **pp, bool *is_uint, uint64_t *uval, int64_t *ival) {
    const char *p = skip_ws(*pp);
    if (*p == '"') {
        char *s = NULL;
        if (!parse_json_string_alloc(&p, &s)) {
            return false;
        }
        bool ok = parse_u64_str(s, uval);
        free(s);
        if (!ok) {
            return false;
        }
        *is_uint = true;
        *ival = (*uval <= (uint64_t)INT64_MAX) ? (int64_t)*uval : INT64_MAX;
        *pp = p;
        return true;
    }

    if (*p == '-' || isdigit((unsigned char)*p)) {
        char *endp = NULL;
        if (*p == '-') {
            long long v = strtoll(p, &endp, 10);
            if (endp == p) {
                return false;
            }
            if (*endp == '.' || *endp == 'e' || *endp == 'E') {
                double dv = strtod(p, &endp);
                *ival = (int64_t)dv;
                *uval = dv >= 0.0 ? (uint64_t)dv : 0ULL;
            } else {
                *ival = (int64_t)v;
                *uval = v >= 0 ? (uint64_t)v : 0ULL;
            }
            *is_uint = false;
            *pp = endp;
            return true;
        }
        errno = 0;
        unsigned long long uv = strtoull(p, &endp, 10);
        if (endp == p) {
            return false;
        }
        if (*endp == '.' || *endp == 'e' || *endp == 'E') {
            double dv = strtod(p, &endp);
            if (dv < 0.0) {
                *is_uint = false;
                *uval = 0ULL;
                *ival = (int64_t)dv;
            } else {
                *is_uint = true;
                *uval = (uint64_t)dv;
                *ival = (*uval <= (uint64_t)INT64_MAX) ? (int64_t)*uval : INT64_MAX;
            }
            *pp = endp;
            return true;
        }
        if (errno != 0) {
            return false;
        }
        *is_uint = true;
        *uval = (uint64_t)uv;
        *ival = (*uval <= (uint64_t)INT64_MAX) ? (int64_t)*uval : INT64_MAX;
        *pp = endp;
        return true;
    }
    return false;
}

static bool parse_params_object(const char **pp, rpc_request_t *req) {
    const char *p = skip_ws(*pp);
    if (strncmp(p, "null", 4) == 0) {
        *pp = p + 4;
        return true;
    }
    if (*p != '{') {
        return false;
    }
    p = skip_ws(p + 1);
    if (*p == '}') {
        *pp = p + 1;
        req->has_params = true;
        return true;
    }

    req->has_params = true;
    for (;;) {
        char *key = NULL;
        if (!parse_json_string_alloc(&p, &key)) {
            return false;
        }
        p = skip_ws(p);
        if (*p != ':') {
            free(key);
            return false;
        }
        p = skip_ws(p + 1);

        if (strcmp(key, "address") == 0) {
            bool is_u = false;
            uint64_t u = 0;
            int64_t iv = 0;
            if (parse_json_int_or_u64(&p, &is_u, &u, &iv) && is_u) {
                req->has_address = true;
                req->address = u;
            } else {
                free(key);
                return false;
            }
        } else if (strcmp(key, "size") == 0) {
            bool is_u = false;
            uint64_t u = 0;
            int64_t iv = 0;
            if (!parse_json_int_or_u64(&p, &is_u, &u, &iv)) {
                free(key);
                return false;
            }
            req->has_size = true;
            req->size = iv;
        } else if (strcmp(key, "pattern") == 0) {
            char *pat = NULL;
            if (!parse_json_string_alloc(&p, &pat)) {
                free(key);
                return false;
            }
            free(req->pattern);
            req->pattern = pat;
            req->has_pattern = true;
        } else if (strcmp(key, "regions") == 0) {
            if (strncmp(p, "null", 4) == 0) {
                p += 4;
            } else {
                char *reg = NULL;
                if (!parse_json_string_alloc(&p, &reg)) {
                    free(key);
                    return false;
                }
                snprintf(req->regions, sizeof(req->regions), "%s", reg);
                free(reg);
                req->has_regions = true;
            }
        } else if (strcmp(key, "start") == 0) {
            if (strncmp(p, "null", 4) == 0) {
                p += 4;
            } else {
                bool is_u = false;
                uint64_t u = 0;
                int64_t iv = 0;
                if (!parse_json_int_or_u64(&p, &is_u, &u, &iv) || !is_u) {
                    free(key);
                    return false;
                }
                req->has_start = true;
                req->start = u;
            }
        } else if (strcmp(key, "end") == 0) {
            if (strncmp(p, "null", 4) == 0) {
                p += 4;
            } else {
                bool is_u = false;
                uint64_t u = 0;
                int64_t iv = 0;
                if (!parse_json_int_or_u64(&p, &is_u, &u, &iv) || !is_u) {
                    free(key);
                    return false;
                }
                req->has_end = true;
                req->end = u;
            }
        } else if (strcmp(key, "max_hits") == 0) {
            bool is_u = false;
            uint64_t u = 0;
            int64_t iv = 0;
            if (!parse_json_int_or_u64(&p, &is_u, &u, &iv)) {
                free(key);
                return false;
            }
            req->has_max_hits = true;
            req->max_hits = iv;
        } else if (strcmp(key, "budget_ms") == 0) {
            bool is_u = false;
            uint64_t u = 0;
            int64_t iv = 0;
            if (!parse_json_int_or_u64(&p, &is_u, &u, &iv)) {
                free(key);
                return false;
            }
            req->has_budget_ms = true;
            req->budget_ms = iv;
        } else {
            if (!skip_json_value(&p)) {
                free(key);
                return false;
            }
        }

        free(key);
        p = skip_ws(p);
        if (*p == ',') {
            p = skip_ws(p + 1);
            continue;
        }
        if (*p == '}') {
            *pp = p + 1;
            return true;
        }
        return false;
    }
}

static bool parse_rpc_request(const char *line, rpc_request_t *req) {
    memset(req, 0, sizeof(*req));
    snprintf(req->id_json, sizeof(req->id_json), "null");

    const char *p = skip_ws(line);
    if (*p != '{') {
        return false;
    }
    p = skip_ws(p + 1);
    if (*p == '}') {
        return true;
    }

    for (;;) {
        char *key = NULL;
        if (!parse_json_string_alloc(&p, &key)) {
            rpc_request_free(req);
            return false;
        }
        p = skip_ws(p);
        if (*p != ':') {
            free(key);
            rpc_request_free(req);
            return false;
        }
        p = skip_ws(p + 1);

        if (strcmp(key, "id") == 0) {
            const char *val_start = p;
            if (!skip_json_value(&p)) {
                free(key);
                rpc_request_free(req);
                return false;
            }
            size_t id_len = (size_t)(p - val_start);
            if (id_len > 0 && id_len < sizeof(req->id_json)) {
                memcpy(req->id_json, val_start, id_len);
                req->id_json[id_len] = '\0';
                req->has_id = true;
            }
        } else if (strcmp(key, "method") == 0) {
            char *m = NULL;
            if (!parse_json_string_alloc(&p, &m)) {
                free(key);
                rpc_request_free(req);
                return false;
            }
            snprintf(req->method, sizeof(req->method), "%s", m);
            free(m);
            req->has_method = true;
        } else if (strcmp(key, "params") == 0) {
            if (!parse_params_object(&p, req)) {
                free(key);
                rpc_request_free(req);
                return false;
            }
        } else {
            if (!skip_json_value(&p)) {
                free(key);
                rpc_request_free(req);
                return false;
            }
        }

        free(key);
        p = skip_ws(p);
        if (*p == ',') {
            p = skip_ws(p + 1);
            continue;
        }
        if (*p == '}') {
            p = skip_ws(p + 1);
            return *p == '\0';
        }
        rpc_request_free(req);
        return false;
    }
}

static bool send_all(int fd, const char *data, size_t len) {
    size_t sent = 0;
    while (sent < len && !g_stop) {
        ssize_t n = send(fd, data + sent, len - sent, MSG_NOSIGNAL);
        if (n > 0) {
            sent += (size_t)n;
            continue;
        }
        if (n < 0 && errno == EINTR) {
            continue;
        }
        return false;
    }
    return sent == len;
}

static void send_json_error(int fd, const char *id_json, int code, const char *message) {
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
        "{\"id\":%s,\"error\":{\"code\":%d,\"message\":\"%s\"}}\n",
        id_json ? id_json : "null",
        code,
        message ? message : "Error");
    if (n > 0 && (size_t)n < sizeof(buf)) {
        (void)send_all(fd, buf, (size_t)n);
    }
}

static void handle_rpc_line(int fd, const char *line) {
    rpc_request_t req;
    if (!parse_rpc_request(line, &req)) {
        send_json_error(fd, "null", -32700, "Parse error");
        return;
    }

    if (!req.has_method || req.method[0] == '\0') {
        send_json_error(fd, req.id_json, -32600, "Missing method");
        rpc_request_free(&req);
        return;
    }

    if (strcmp(req.method, "status") == 0) {
        pthread_mutex_lock(&g_target_mutex);
        bool alive = refresh_target_locked(true);
        char emu[32];
        snprintf(emu, sizeof(emu), "%s", g_target.emulator);
        pthread_mutex_unlock(&g_target_mutex);

        char resp[512];
        int n;
        if (alive) {
            n = snprintf(resp, sizeof(resp),
                "{\"id\":%s,\"result\":{\"powered_on\":true,\"program_id\":\"%s\",\"emulator\":\"%s\"}}\n",
                req.id_json, OOT_PROGRAM_ID, emu);
        } else {
            n = snprintf(resp, sizeof(resp),
                "{\"id\":%s,\"result\":{\"powered_on\":false,\"program_id\":\"\",\"emulator\":\"%s\"}}\n",
                req.id_json, emu);
        }
        if (n > 0 && (size_t)n < sizeof(resp)) {
            (void)send_all(fd, resp, (size_t)n);
        }
        rpc_request_free(&req);
        return;
    }

    if (strcmp(req.method, "read_memory") == 0) {
        if (!req.has_params || !req.has_address || !req.has_size ||
            req.size < 1 || req.size > MAX_READ_MEMORY_SIZE) {
            send_json_error(fd, req.id_json, -32602, "Invalid read_memory params");
            rpc_request_free(&req);
            return;
        }
        if (req.address >= GUEST_WINDOW_SIZE || (uint64_t)req.size > GUEST_WINDOW_SIZE - req.address) {
            send_json_error(fd, req.id_json, -32602, "Address out of guest window");
            rpc_request_free(&req);
            return;
        }

        size_t sz = (size_t)req.size;
        uint8_t *raw = (uint8_t *)malloc(sz);
        if (!raw) {
            send_json_error(fd, req.id_json, -32000, "Out of memory");
            rpc_request_free(&req);
            return;
        }

        pthread_mutex_lock(&g_target_mutex);
        bool alive = refresh_target_locked(true);
        pid_t pid = alive ? g_target.pid : 0;
        pthread_mutex_unlock(&g_target_mutex);

        int read_err = 0;
        if (pid <= 0 || !read_remote_memory(pid, GUEST_WINDOW_BASE + req.address, raw, sz, &read_err)) {
            free(raw);
            send_json_error(fd, req.id_json, -32000, "read_memory failed");
            rpc_request_free(&req);
            return;
        }

        size_t id_len = strlen(req.id_json);
        size_t resp_cap = id_len + (sz * 2) + 64;
        char *resp = (char *)malloc(resp_cap);
        if (!resp) {
            free(raw);
            send_json_error(fd, req.id_json, -32000, "Out of memory");
            rpc_request_free(&req);
            return;
        }

        int prefix = snprintf(resp, resp_cap, "{\"id\":%s,\"result\":{\"hex\":\"", req.id_json);
        static const char hex_chars[] = "0123456789abcdef";
        char *out = resp + prefix;
        for (size_t i = 0; i < sz; i++) {
            out[i * 2] = hex_chars[raw[i] >> 4];
            out[i * 2 + 1] = hex_chars[raw[i] & 0x0F];
        }
        memcpy(out + (sz * 2), "\"}}\n", 5);
        (void)send_all(fd, resp, (size_t)prefix + (sz * 2) + 4);

        free(resp);
        free(raw);
        rpc_request_free(&req);
        return;
    }

    if (strcmp(req.method, "search_memory") == 0) {
        uint8_t *pat_bytes = NULL;
        uint8_t *pat_mask = NULL;
        size_t pat_len = 0;
        if (!req.has_params || !req.has_pattern ||
            !parse_hex_pattern(req.pattern, &pat_bytes, &pat_mask, &pat_len)) {
            send_json_error(fd, req.id_json, -32602, "Invalid search_memory pattern");
            rpc_request_free(&req);
            return;
        }

        bool is_heap = req.has_regions && strcasecmp(req.regions, "heap") == 0;
        uint64_t guest_start = req.has_start ? req.start : (is_heap ? STANDARD_HEAP_THRESHOLD : 0ULL);
        uint64_t guest_end = req.has_end ? req.end : GUEST_WINDOW_SIZE;
        if (guest_start > GUEST_WINDOW_SIZE) guest_start = GUEST_WINDOW_SIZE;
        if (guest_end > GUEST_WINDOW_SIZE) guest_end = GUEST_WINDOW_SIZE;

        size_t max_hits = DEFAULT_MAX_HITS;
        if (req.has_max_hits) {
            if (req.max_hits < 1) max_hits = 1;
            else if (req.max_hits > MAX_ALLOWED_HITS) max_hits = MAX_ALLOWED_HITS;
            else max_hits = (size_t)req.max_hits;
        }

        int budget_ms = 0;
        if (req.has_budget_ms && req.budget_ms >= 50 && req.budget_ms <= 10000) {
            budget_ms = (int)req.budget_ms;
        }

        ssize_t anchor_idx = -1;
        for (size_t i = 0; i < pat_len; i++) {
            if (pat_mask[i] && pat_bytes[i] != 0x00 && pat_bytes[i] != 0xFF) {
                anchor_idx = (ssize_t)i;
                break;
            }
        }
        if (anchor_idx < 0) {
            for (size_t i = 0; i < pat_len; i++) {
                if (pat_mask[i]) {
                    anchor_idx = (ssize_t)i;
                    break;
                }
            }
        }

        size_t scan_buf_len = pat_len > SEARCH_CHUNK_SIZE ? pat_len : SEARCH_CHUNK_SIZE;
        uint8_t *scan_buf = (uint8_t *)malloc(scan_buf_len);
        if (!scan_buf) {
            free(pat_bytes);
            free(pat_mask);
            send_json_error(fd, req.id_json, -32000, "Out of memory");
            rpc_request_free(&req);
            return;
        }

        pthread_mutex_lock(&g_target_mutex);
        bool alive = refresh_target_locked(true);
        pid_t pid = alive ? g_target.pid : 0;
        pthread_mutex_unlock(&g_target_mutex);

        hit_list_t hits = {NULL, 0, 0};
        if (pid > 0) {
            uint64_t t0 = monotonic_ms();
            if (guest_end > guest_start) {
                search_host_range(
                    pid,
                    GUEST_WINDOW_BASE + guest_start,
                    GUEST_WINDOW_BASE + guest_end,
                    pat_bytes,
                    pat_mask,
                    pat_len,
                    anchor_idx,
                    max_hits,
                    &hits,
                    t0,
                    budget_ms,
                    scan_buf,
                    scan_buf_len);
            }
            if (hits.count == 0 && (is_heap || guest_start >= STANDARD_HEAP_THRESHOLD)) {
                bool already_covered = guest_start <= LONGSHOT_HEAP_BASE && guest_end >= LONGSHOT_HEAP_END;
                if (!already_covered) {
                    search_host_range(
                        pid,
                        GUEST_WINDOW_BASE + LONGSHOT_HEAP_BASE,
                        GUEST_WINDOW_BASE + LONGSHOT_HEAP_END,
                        pat_bytes,
                        pat_mask,
                        pat_len,
                        anchor_idx,
                        max_hits,
                        &hits,
                        t0,
                        budget_ms,
                        scan_buf,
                        scan_buf_len);
                }
            }
        }

        size_t resp_cap = strlen(req.id_json) + 64 + (hits.count * 24);
        char *resp = (char *)malloc(resp_cap);
        if (resp) {
            int pos = snprintf(resp, resp_cap, "{\"id\":%s,\"result\":{\"hits\":[", req.id_json);
            for (size_t i = 0; i < hits.count; i++) {
                int w = snprintf(resp + pos, resp_cap - (size_t)pos, "%s\"0x%llx\"",
                    i > 0 ? "," : "", (unsigned long long)hits.items[i]);
                if (w > 0) {
                    pos += w;
                }
            }
            int tail = snprintf(resp + pos, resp_cap - (size_t)pos, "]}}\n");
            if (tail > 0) {
                pos += tail;
            }
            (void)send_all(fd, resp, (size_t)pos);
            free(resp);
        }

        free(hits.items);
        free(scan_buf);
        free(pat_bytes);
        free(pat_mask);
        rpc_request_free(&req);
        return;
    }

    send_json_error(fd, req.id_json, -32601, "Method not found");
    rpc_request_free(&req);
}

static void *client_thread_main(void *arg) {
    client_node_t *node = (client_node_t *)arg;
    int fd = node->fd;

    size_t cap = 4096;
    size_t len = 0;
    char *buf = (char *)malloc(cap);
    if (!buf) {
        return NULL;
    }

    while (!g_stop) {
        struct pollfd pfd;
        pfd.fd = fd;
        pfd.events = POLLIN;
        pfd.revents = 0;

        int pr = poll(&pfd, 1, 250);
        if (pr < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (pr == 0) {
            continue;
        }
        if ((pfd.revents & (POLLERR | POLLHUP | POLLNVAL)) != 0 && (pfd.revents & POLLIN) == 0) {
            break;
        }

        char chunk[4096];
        ssize_t n = recv(fd, chunk, sizeof(chunk), 0);
        if (n <= 0) {
            if (n < 0 && errno == EINTR) {
                continue;
            }
            break;
        }

        if (len + (size_t)n + 1 > cap) {
            size_t next_cap = cap * 2;
            while (next_cap < len + (size_t)n + 1) {
                next_cap *= 2;
            }
            if (next_cap > 1024 * 1024) {
                break;
            }
            char *grown = (char *)realloc(buf, next_cap);
            if (!grown) {
                break;
            }
            buf = grown;
            cap = next_cap;
        }

        memcpy(buf + len, chunk, (size_t)n);
        len += (size_t)n;
        buf[len] = '\0';

        char *start = buf;
        for (;;) {
            char *nl = (char *)memchr(start, '\n', len - (size_t)(start - buf));
            if (!nl) {
                break;
            }
            *nl = '\0';
            if (nl > start && *(nl - 1) == '\r') {
                *(nl - 1) = '\0';
            }
            const char *trimmed = skip_ws(start);
            if (*trimmed != '\0') {
                handle_rpc_line(fd, trimmed);
            }
            start = nl + 1;
        }

        size_t rem = len - (size_t)(start - buf);
        if (rem > 0 && start != buf) {
            memmove(buf, start, rem);
        }
        len = rem;
        buf[len] = '\0';
    }

    free(buf);
    shutdown(fd, SHUT_RDWR);
    pthread_mutex_lock(&g_clients_mutex);
    node->finished = true;
    pthread_mutex_unlock(&g_clients_mutex);
    return NULL;
}

static void register_client(client_node_t *node) {
    pthread_mutex_lock(&g_clients_mutex);
    node->next = g_clients_head;
    g_clients_head = node;
    pthread_mutex_unlock(&g_clients_mutex);
}

static void reap_finished_clients(void) {
    client_node_t *reap_list = NULL;

    pthread_mutex_lock(&g_clients_mutex);
    client_node_t **pp = &g_clients_head;
    while (*pp) {
        client_node_t *cur = *pp;
        if (cur->finished) {
            *pp = cur->next;
            cur->next = reap_list;
            reap_list = cur;
        } else {
            pp = &cur->next;
        }
    }
    pthread_mutex_unlock(&g_clients_mutex);

    while (reap_list) {
        client_node_t *next = reap_list->next;
        pthread_join(reap_list->thread, NULL);
        if (reap_list->fd >= 0) {
            close(reap_list->fd);
            reap_list->fd = -1;
        }
        free(reap_list);
        reap_list = next;
    }
}

static void cleanup_clients(void) {
    pthread_mutex_lock(&g_clients_mutex);
    client_node_t *cur = g_clients_head;
    g_clients_head = NULL;
    pthread_mutex_unlock(&g_clients_mutex);

    while (cur) {
        client_node_t *next = cur->next;
        if (cur->fd >= 0) {
            shutdown(cur->fd, SHUT_RDWR);
        }
        pthread_join(cur->thread, NULL);
        if (cur->fd >= 0) {
            close(cur->fd);
            cur->fd = -1;
        }
        free(cur);
        cur = next;
    }
}

static int run_self_test(void) {
    rpc_request_t req;
    const char *sample = "{\"id\":42,\"method\":\"read_memory\",\"params\":{\"address\":\"0x80000000\",\"size\":8,\"as\":\"hex\"}}";
    if (!parse_rpc_request(sample, &req)) {
        fprintf(stderr, "self-test failed: parse_rpc_request\n");
        return 1;
    }
    bool ok = strcmp(req.id_json, "42") == 0 &&
              strcmp(req.method, "read_memory") == 0 &&
              req.has_address && req.address == 0x80000000ULL &&
              req.has_size && req.size == 8;
    rpc_request_free(&req);
    if (!ok) {
        fprintf(stderr, "self-test failed: read_memory field validation\n");
        return 1;
    }

    uint8_t *bytes = NULL;
    uint8_t *mask = NULL;
    size_t len = 0;
    if (!parse_hex_pattern("4d 4f ?? 30", &bytes, &mask, &len) || len != 4 ||
        bytes[0] != 0x4D || mask[0] != 1 || mask[2] != 0 || bytes[3] != 0x30) {
        free(bytes);
        free(mask);
        fprintf(stderr, "self-test failed: parse_hex_pattern\n");
        return 1;
    }
    free(bytes);
    free(mask);

    region_list_t regions;
    if (!collect_readable_regions(getpid(), 0ULL, UINT64_MAX, &regions) || regions.count == 0) {
        free(regions.items);
        fprintf(stderr, "self-test failed: /proc/self/maps parsing\n");
        return 1;
    }
    free(regions.items);

    target_state_t found;
    if (discover_target(&found)) {
        printf("SELF_TEST_OK target_pid=%ld emulator=%s save_dir=%s\n",
            (long)found.pid,
            found.emulator,
            found.has_save_dir ? found.save_dir : "");
    } else {
        printf("SELF_TEST_OK target_pid=none\n");
    }
    return 0;
}

static void print_usage(const char *prog) {
    printf(
        "Usage: %s [options]\n"
        "Strictly read-only Linux memory JSON-RPC bridge for Longshot / Project ReLink / Triforce.\n\n"
        "Options:\n"
        "  --port <port>       Listen port on 127.0.0.1 (default: %d)\n"
        "  --pid <pid>         Attach to a specific target PID directly\n"
        "  --watch             Stay running and attach/re-attach as processes start/stop (default)\n"
        "  --once              Require a running target at startup and exit when it exits\n"
        "  --print-save-dir    Resolve <game_root>/user from running target and print it\n"
        "  --detect            Print detected target PID, emulator, and save dir\n"
        "  --self-test         Run built-in parser and /proc self-checks and exit\n"
        "  --help              Show this help message\n",
        prog, DEFAULT_BRIDGE_PORT);
}

int main(int argc, char **argv) {
    int port = DEFAULT_BRIDGE_PORT;
    bool print_save_dir = false;
    bool detect_only = false;
    bool self_test = false;

    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            print_usage(argv[0]);
            return 0;
        } else if (strcmp(arg, "--port") == 0 && i + 1 < argc) {
            long p = strtol(argv[++i], NULL, 10);
            if (p < 1 || p > 65535) {
                fprintf(stderr, "Invalid port: %s\n", argv[i]);
                return 2;
            }
            port = (int)p;
        } else if (strcmp(arg, "--pid") == 0 && i + 1 < argc) {
            long p = strtol(argv[++i], NULL, 10);
            if (p <= 0) {
                fprintf(stderr, "Invalid pid: %s\n", argv[i]);
                return 2;
            }
            g_forced_pid = (pid_t)p;
        } else if (strcmp(arg, "--watch") == 0) {
            g_once_mode = false;
        } else if (strcmp(arg, "--once") == 0) {
            g_once_mode = true;
        } else if (strcmp(arg, "--print-save-dir") == 0) {
            print_save_dir = true;
        } else if (strcmp(arg, "--detect") == 0) {
            detect_only = true;
        } else if (strcmp(arg, "--self-test") == 0) {
            self_test = true;
        } else {
            fprintf(stderr, "Unknown argument: %s\n", arg);
            print_usage(argv[0]);
            return 2;
        }
    }

    if (self_test) {
        return run_self_test();
    }

    if (print_save_dir || detect_only) {
        target_state_t found;
        if (!discover_target(&found)) {
            return 1;
        }
        if (print_save_dir) {
            if (!found.has_save_dir) {
                return 1;
            }
            printf("%s\n", found.save_dir);
        } else {
            printf("PID=%ld\nEMULATOR=%s\nSAVE_DIR=%s\n",
                (long)found.pid,
                found.emulator,
                found.has_save_dir ? found.save_dir : "");
        }
        return 0;
    }

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = on_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    if (g_once_mode) {
        pthread_mutex_lock(&g_target_mutex);
        bool ok = refresh_target_locked(true);
        pthread_mutex_unlock(&g_target_mutex);
        if (!ok) {
            fprintf(stderr, "[longshot-rpc-bridge] No running Longshot/ReLink/Triforce process with 0x100080000000 mapping found.\n");
            return 2;
        }
    } else {
        pthread_mutex_lock(&g_target_mutex);
        (void)refresh_target_locked(true);
        pthread_mutex_unlock(&g_target_mutex);
    }

    int listen_fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (listen_fd < 0) {
        perror("socket");
        return 1;
    }

    int opt_one = 1;
    (void)setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &opt_one, sizeof(opt_one));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    if (bind(listen_fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        perror("bind 127.0.0.1");
        close(listen_fd);
        return 1;
    }

    if (listen(listen_fd, 16) != 0) {
        perror("listen");
        close(listen_fd);
        return 1;
    }

    printf("BRIDGE_READY 127.0.0.1:%d\n", port);
    fflush(stdout);

    uint64_t last_target_check = monotonic_ms();
    while (!g_stop) {
        struct pollfd pfd;
        pfd.fd = listen_fd;
        pfd.events = POLLIN;
        pfd.revents = 0;

        int pr = poll(&pfd, 1, 250);
        if (pr < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }

        uint64_t now = monotonic_ms();
        if (now - last_target_check >= 1000ULL) {
            last_target_check = now;
            reap_finished_clients();
            pthread_mutex_lock(&g_target_mutex);
            (void)refresh_target_locked(false);
            pthread_mutex_unlock(&g_target_mutex);
            if (g_stop) {
                break;
            }
        }

        if (pr == 0 || (pfd.revents & POLLIN) == 0) {
            continue;
        }

        int client_fd = accept(listen_fd, NULL, NULL);
        if (client_fd < 0) {
            if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
                continue;
            }
            break;
        }

        int nodelay = 1;
        (void)setsockopt(client_fd, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof(nodelay));

        client_node_t *node = (client_node_t *)calloc(1, sizeof(client_node_t));
        if (!node) {
            close(client_fd);
            continue;
        }
        node->fd = client_fd;

        if (pthread_create(&node->thread, NULL, client_thread_main, node) != 0) {
            close(client_fd);
            free(node);
            continue;
        }
        register_client(node);
    }

    close(listen_fd);
    cleanup_clients();
    return 0;
}
