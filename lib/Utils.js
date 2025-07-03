const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");

function createDirectory(filePath, mode) {
    if (mode === undefined) {
        mode = 511 & (~process.umask());
    }
    filePath = path.resolve(filePath);
    try {
        fs.mkdirSync(filePath, mode);
    } catch (err0) {
        switch (err0.code) {
            case 'ENOENT':
                createDirectory(path.dirname(filePath), mode);
                createDirectory(filePath, mode);
                break;
            default:
                let stat = void 0;
                try {
                    stat = fs.statSync(filePath);
                } catch (err1) {
                    throw err0;
                }
                if (!stat.isDirectory()) {
                    throw err0;
                }
                break;
        }
    }
}

function deletePath(filePath, excludes) {
    if (!excludes) {
        try {
            fs.rmSync(filePath, {recursive: true, force: true});
        } catch (e) {
        }
        return;
    }
    try {
        let fileNames = fs.readdirSync(filePath);
        for (let name of fileNames) {
            let childPath = path.resolve(filePath, name);
            let keep = false;
            for (let exclude of excludes) {
                if (childPath.indexOf(exclude) === 0) {
                    keep = true;
                    break;
                }
            }
            if (!keep) {
                deletePath(childPath);
            } else if (childPath.length !== exclude.length) {
                deletePath(childPath, excludes);
            }
        }
    } catch (e) {
    }
}

function deleteEmptyDir(path) {
    try {
        if (!fs.lstatSync(path).isDirectory()) {
            return;
        }
        let files = fs.readdirSync(path);
        if (files.length === 0) {
            fs.rmdirSync(path);
        }
    } catch (e) {
    }
}

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch (e) {
        return "";
    }
}

function getModifyTime(filePath) {
    try {
        return fs.statSync(filePath).mtime.toString();
    } catch (e) {
        return "";
    }
}

function writeFile(filePath, content) {
    if (fs.existsSync(filePath)) {
        deletePath(filePath);
    }
    let folder = path.dirname(filePath);
    if (!fs.existsSync(folder)) {
        createDirectory(folder);
    }
    let fd;
    try {
        fd = fs.openSync(filePath, 'w', 438);
    } catch (e) {
        fs.chmodSync(filePath, 438);
        fd = fs.openSync(filePath, 'w', 438);
    }
    if (fd) {
        if (typeof content == "string") {
            fs.writeSync(fd, content, 0, 'utf8');
        } else {
            fs.writeSync(fd, content, 0, content.length, 0);
        }
        fs.closeSync(fd);
    }
    fs.chmodSync(filePath, 438);
    return true;
}

function copyPath(source, target) {
    let stat = null;
    try {
        stat = fs.statSync(source);
    } catch (err1) {
        return;
    }
    if (stat.isDirectory()) {
        let files = fs.readdirSync(source);
        for (let fileName of files) {
            let filePath = path.join(source, fileName);
            let targetPath = path.join(target, fileName);
            copyPath(filePath, targetPath);
        }
    } else {
        let folder = path.dirname(target);
        if (!fs.existsSync(folder)) {
            createDirectory(folder);
        }
        deletePath(target);
        fs.copyFileSync(source, target);
    }
}

function movePath(srcPath, dstPath) {
    srcPath = path.resolve(srcPath);
    dstPath = path.resolve(dstPath);
    if (!fs.existsSync(srcPath)) {
        return;
    }
    try {
        createDirectory(path.dirname(dstPath));
        fs.renameSync(srcPath, dstPath);
    } catch (e) {
    }
}

function findFiles(filePath, filter) {
    let list = [];
    let stat = null;
    try {
        stat = fs.statSync(filePath);
    } catch (err1) {
        return list;
    }
    if (stat.isDirectory()) {
        let files = fs.readdirSync(filePath);
        for (let file of files) {
            if (file === ".DS_Store") {
                continue;
            }
            let curPath = path.join(filePath, file);
            list = list.concat(findFiles(curPath, filter));
        }
    } else if (!filter || filter(filePath)) {
        list.push(filePath);
    }
    return list;
}

function formatString(format) {
    let objects = new Array(arguments.length);
    for (let index = 0; index < arguments.length; index++) {
        objects[index] = arguments[index];
    }
    return objects.join(' ');
}

function log(message) {
    let text = formatString.apply(this, arguments);
    if (text) {
        text += "\n";
    }
    process.stdout.write(text);
}

function formatTime(timeMs) {
    if (timeMs < 100) {
        return timeMs + "ms";
    }
    if (timeMs < 60000) {
        let time = Math.round(timeMs / 100) / 10;
        return time + "s";
    }
    let seconds = Math.round(timeMs / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    seconds = seconds % 60;
    minutes = minutes % 60;
    let text = "";
    if (hours > 0) {
        text += hours + "h ";
    }
    if (minutes > 0) {
        text += minutes + "m ";
    }
    if (seconds > 0) {
        text += seconds + "s";
    }
    return text;
}

function error(message) {
    let text = formatString.apply(this, arguments);
    if (text) {
        text += "\n";
    }
    process.stderr.write(text);
}

function getHash(content) {
    let hash = crypto.createHash('md5')
    hash.update(content)
    return hash.digest('hex')
}

function exec(cmd, dir, verbose, printCmd) {
    if (!dir) {
        dir = process.cwd();
    } else {
        dir = path.resolve(dir);
    }
    if (typeof verbose === "undefined") {
        verbose = true;
    }
    if (typeof printCmd === "undefined") {
        printCmd = true;
    }
    let options = {
        // only cmd.exe can run .bat file and support using && to run multiple commands.
        shell: os.platform() === "win32" ? "cmd.exe" : true,
        cwd: dir,
        env: process.env
    }

    if (verbose) {
        options.stdio = "inherit";
    }
    
    // Enhanced logging for debugging
    const startTime = Date.now();
    if (printCmd) {
        log(`[EXEC] Starting command: ${cmd}`);
        log(`[EXEC] Working directory: ${dir}`);
        log(`[EXEC] Process ID: ${process.pid}`);
        log(`[EXEC] Environment variables count: ${Object.keys(process.env).length}`);
    }
    
    let result;
    try {
        result = childProcess.spawnSync(cmd, options);
    } catch (error) {
        const executionTime = Date.now() - startTime;
        error(`[EXEC] Command execution failed with exception after ${executionTime}ms:`);
        error(`[EXEC] Command: ${cmd}`);
        error(`[EXEC] Working directory: ${dir}`);
        error(`[EXEC] Exception: ${error.message}`);
        error(`[EXEC] Stack trace: ${error.stack}`);
        process.exit(1);
    }
    
    const executionTime = Date.now() - startTime;
    
    if (result.status !== 0) {
        error(`[EXEC] Command failed with exit code ${result.status} after ${executionTime}ms:`);
        error(`[EXEC] Command: ${cmd}`);
        error(`[EXEC] Working directory: ${dir}`);
        error(`[EXEC] Process ID: ${process.pid}`);
        
        // Enhanced error diagnostics
        if (result.signal) {
            error(`[EXEC] Process was killed by signal: ${result.signal}`);
        }
        
        // Check for common error patterns
        const stderrOutput = result.stderr ? result.stderr.toString() : '';
        const stdoutOutput = result.stdout ? result.stdout.toString() : '';
        
        if (stderrOutput.includes('No space left on device')) {
            error(`[EXEC] DIAGNOSTIC: Disk space issue detected`);
        } else if (stderrOutput.includes('Cannot allocate memory')) {
            error(`[EXEC] DIAGNOSTIC: Memory allocation issue detected`);
        } else if (stderrOutput.includes('Resource temporarily unavailable')) {
            error(`[EXEC] DIAGNOSTIC: Resource exhaustion detected`);
        } else if (stderrOutput.includes('Permission denied')) {
            error(`[EXEC] DIAGNOSTIC: Permission issue detected`);
        } else if (stderrOutput.includes('ninja: build stopped')) {
            error(`[EXEC] DIAGNOSTIC: Ninja build was stopped, likely due to compilation error`);
        } else if (cmd.includes('make') && stderrOutput.includes('Error 2')) {
            error(`[EXEC] DIAGNOSTIC: Make build error detected, likely compilation failure`);
        }
        
        // Log system resource information
        try {
            const memUsage = process.memoryUsage();
            error(`[EXEC] Memory usage - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
            
            const loadAvg = os.loadavg();
            error(`[EXEC] System load average: ${loadAvg.map(l => l.toFixed(2)).join(', ')}`);
            
            // Check disk space if possible
            try {
                const stats = fs.statSync(dir);
                error(`[EXEC] Working directory exists and is accessible`);
            } catch (statsErr) {
                error(`[EXEC] Working directory issue: ${statsErr.message}`);
            }
        } catch (sysErr) {
            error(`[EXEC] Could not gather system diagnostics: ${sysErr.message}`);
        }
        
        // Enhanced output logging
        if (!verbose) {
            if (stdoutOutput) {
                log(`[EXEC] stdout:`);
                log(stdoutOutput);
            }
            if (stderrOutput) {
                error(`[EXEC] stderr:`);
                error(stderrOutput);
            }
        }
        
        error(`[EXEC] Command execution failed. See above for details.`);
        process.exit(1);
    } else if (printCmd) {
        log(`[EXEC] Command completed successfully in ${executionTime}ms`);
    }
}

function execSafe(cmd, dir) {
    if (!dir) {
        dir = process.cwd();
    } else {
        dir = path.resolve(dir);
    }
    let options = {
        shell: os.platform() === "win32" ? "cmd.exe" : true,
        stdio: 'pipe',
        encoding: 'utf-8',
        cwd: dir,
        env: process.env
    }
    try {
        let result = childProcess.spawnSync(cmd, options);
        let text = "";
        if (result.stdout) {
            text += result.stdout.toString();
        }
        if (result.stderr) {
            text += result.stderr.toString();
        }
        return text;
    } catch (e) {
        return "";
    }
}

function escapeSpace(cmd) {
    if (!cmd || cmd.indexOf(" ") === -1 || cmd.charAt(0) === "\"" || cmd.charAt(0) === "\'") {
        return cmd;
    }
    return "\"" + cmd + "\"";
}

function sleepSync(ms) {
    // Synchronous sleep function with multiple fallback strategies
    try {
        // Try Atomics.wait first (most efficient)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch (e) {
        // Fallback: Use blocking approach without early break
        const start = Date.now();
        while (Date.now() - start < ms) {
            // Empty loop - this is intentionally blocking
            // No early break to ensure full sleep duration
        }
    }
}

function waitForLockRelease(lockFile, timeoutMs, startTime) {
    // Implement exponential backoff with jitter for more efficient waiting
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
        throw new Error('Timeout waiting for lock: ' + lockFile);
    }

    // Calculate backoff time with exponential growth and jitter
    const attempt = Math.floor(elapsed / 1000); // roughly attempt number
    const baseDelay = Math.min(100 * Math.pow(1.5, Math.min(attempt, 10)), 5000); // max 5s
    const jitter = Math.random() * 0.3 * baseDelay; // 30% jitter
    const delay = Math.floor(baseDelay + jitter);

    // Optional: Check if lock file still exists before sleeping
    if (!fs.existsSync(lockFile)) {
        return; // Lock might have been released, retry immediately
    }

    // Log waiting message for long waits
    if (delay > 1000) {
        log(`Waiting for build lock (${Math.floor(elapsed / 1000)}s): ${lockFile}`);
    }

    sleepSync(delay);
}

// ------------------------------
// Build lock related constants
// ------------------------------

// How long before a lock is considered stale
const STALE_LOCK_THRESHOLD_MS = 15 * 60 * 1000;

// Maximum time to wait for a lock before bailing out.
// Can be overridden via the env variable `VENDOR_LOCK_TIMEOUT_MS`.
const LOCK_WAIT_TIMEOUT_MS = process.env.VENDOR_LOCK_TIMEOUT_MS
    ? parseInt(process.env.VENDOR_LOCK_TIMEOUT_MS, 10) || (STALE_LOCK_THRESHOLD_MS + 5 * 60 * 1000)
    : STALE_LOCK_THRESHOLD_MS + 5 * 60 * 1000;

function acquireLock(lockFile) {
    // Acquire an exclusive lock file with intelligent waiting strategy.
    // Uses exponential backoff with jitter to reduce resource consumption and contention.
    // The function returns the file descriptor so that callers can later release it safely.

    // Ensure the directory for the lock file exists
    const lockDir = path.dirname(lockFile);
    if (!fs.existsSync(lockDir)) {
        createDirectory(lockDir);
    }

    const startTime = Date.now();
    let isFirstAttempt = true;

    while (true) {
        try {
            // "wx" – Like "w" but fails if path exists.
            const fd = fs.openSync(lockFile, 'wx');
            fs.writeSync(fd, JSON.stringify({
                pid: process.pid,
                timestamp: Date.now(),
                hostname: os.hostname()
            }));

            if (!isFirstAttempt) {
                const waitTime = Math.floor((Date.now() - startTime) / 1000);
                log(`Build lock acquired after ${waitTime}s: ${lockFile}`);
            }

            return fd;
        } catch (err) {
            if (err.code === 'EEXIST') {
                // Check if lock file contains stale lock (from dead process)
                try {
                    const lockContent = fs.readFileSync(lockFile, 'utf8');
                    const lockInfo = JSON.parse(lockContent);

                    const lockAge = Date.now() - lockInfo.timestamp;

                    // Consider the lock stale if it has lived longer than the threshold **OR**
                    // (same host AND owning process has already exited).
                    let isStale = lockAge > STALE_LOCK_THRESHOLD_MS;

                    if (!isStale && lockInfo.hostname === os.hostname() && typeof lockInfo.pid === 'number') {
                        try {
                            // `kill(pid, 0)` throws if the process does not exist or no permission.
                            process.kill(lockInfo.pid, 0);
                        } catch (_) {
                            isStale = true;
                        }
                    }

                    if (isStale) {
                        log(`Removing stale lock file (${Math.floor(lockAge / 60000)}min old): ${lockFile}`);
                        try {
                            fs.unlinkSync(lockFile);
                            continue; // Try to acquire lock again immediately
                        } catch (unlinkErr) {
                            // If we can't remove it, another process might have cleaned it up
                        }
                    }
                } catch (readErr) {
                    // Lock file might be in old format or corrupted, continue with normal waiting
                }

                // Wait with intelligent backoff strategy
                waitForLockRelease(lockFile, LOCK_WAIT_TIMEOUT_MS, startTime);
                isFirstAttempt = false;

            } else if (err.code === 'ENOENT') {
                // Directory might have been deleted by another process, recreate it
                try {
                    createDirectory(lockDir);
                } catch (dirErr) {
                    // If directory creation fails, wait a bit and retry
                    sleepSync(100);
                }

                if (Date.now() - startTime > LOCK_WAIT_TIMEOUT_MS) {
                    throw new Error('Timeout waiting for lock: ' + lockFile);
                }
            } else {
                throw err;
            }
        }
    }
}

function releaseLock(lockFile, fd) {
    // Close the file descriptor first
    try {
        if (typeof fd === 'number') {
            fs.closeSync(fd);
        }
    } catch (e) {
        // Ignore close errors, file might already be closed
    }

    // Remove the lock file with ownership verification
    try {
        if (fs.existsSync(lockFile)) {
            // Verify ownership before removing
            let shouldRemove = false;
            try {
                const content = fs.readFileSync(lockFile, 'utf8');

                // Try to parse as JSON (new format)
                try {
                    const lockInfo = JSON.parse(content);
                    shouldRemove = (lockInfo.pid === process.pid);
                } catch (jsonErr) {
                    // Fallback to old format (plain PID string)
                    shouldRemove = (content.trim() === process.pid.toString());
                }
            } catch (readErr) {
                // If we can't read the file, assume it's ours to remove
                // This handles cases where the file was created by this process but is corrupted
                shouldRemove = true;
            }

            if (shouldRemove) {
                fs.unlinkSync(lockFile);
            }
        }
    } catch (e) {
        // Lock file might have been removed by another process or system cleanup
        // This is acceptable and not an error condition
    }
}

function withBuildLock(outputDir, action) {
    // Shared wrapper for build locking to reduce code duplication
    const lockFilePath = path.join(outputDir, '.build.lock');
    let lockFd = null;
    
    log(`[LOCK] Attempting to acquire build lock: ${lockFilePath}`);
    const lockStartTime = Date.now();
    
    try {
        lockFd = acquireLock(lockFilePath);
        const lockWaitTime = Date.now() - lockStartTime;
        if (lockWaitTime > 1000) {
            log(`[LOCK] Build lock acquired after ${Math.floor(lockWaitTime / 1000)}s: ${lockFilePath}`);
        } else {
            log(`[LOCK] Build lock acquired immediately: ${lockFilePath}`);
        }
        
        const actionStartTime = Date.now();
        const result = action();
        const actionDuration = Date.now() - actionStartTime;
        
        log(`[LOCK] Build action completed in ${Math.floor(actionDuration / 1000)}s`);
        return result;
    } catch (lockError) {
        error(`[LOCK] Build lock operation failed: ${lockError.message}`);
        error(`[LOCK] Lock file path: ${lockFilePath}`);
        error(`[LOCK] Output directory: ${outputDir}`);
        
        // Provide diagnostic information
        try {
            if (fs.existsSync(lockFilePath)) {
                const lockContent = fs.readFileSync(lockFilePath, 'utf8');
                error(`[LOCK] Lock file content: ${lockContent}`);
                
                try {
                    const lockInfo = JSON.parse(lockContent);
                    error(`[LOCK] Lock owned by PID: ${lockInfo.pid}, Host: ${lockInfo.hostname}, Time: ${new Date(lockInfo.timestamp)}`);
                } catch (parseErr) {
                    error(`[LOCK] Lock file format is invalid or legacy`);
                }
            } else {
                error(`[LOCK] Lock file does not exist`);
            }
        } catch (diagErr) {
            error(`[LOCK] Could not read lock file for diagnostics: ${diagErr.message}`);
        }
        
        throw lockError;
    } finally {
        if (lockFd !== null) {
            log(`[LOCK] Releasing build lock: ${lockFilePath}`);
            try {
                releaseLock(lockFilePath, lockFd);
                log(`[LOCK] Build lock released successfully`);
            } catch (releaseErr) {
                error(`[LOCK] Failed to release build lock: ${releaseErr.message}`);
                // Don't re-throw as the main action may have succeeded
            }
        }
    }
}

function execWithRetry(cmd, dir, verbose, printCmd, maxRetries = 3) {
    if (!dir) {
        dir = process.cwd();
    } else {
        dir = path.resolve(dir);
    }
    if (typeof verbose === "undefined") {
        verbose = true;
    }
    if (typeof printCmd === "undefined") {
        printCmd = true;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                log(`[RETRY] Attempt ${attempt}/${maxRetries} for command: ${cmd}`);
                // Add a small delay between retries to allow system to recover
                sleepSync(Math.min(1000 * attempt, 5000));
            }
            
            exec(cmd, dir, verbose, printCmd);
            return; // Success, exit retry loop
        } catch (execError) {
            if (attempt === maxRetries) {
                error(`[RETRY] All ${maxRetries} attempts failed for command: ${cmd}`);
                throw execError; // Re-throw the last error
            }
            
            // Check if this is a retryable error
            const errorOutput = execError.message || '';
            const isRetryable = 
                errorOutput.includes('Resource temporarily unavailable') ||
                errorOutput.includes('Device or resource busy') ||
                errorOutput.includes('Cannot allocate memory') ||
                errorOutput.includes('No space left on device') ||
                errorOutput.includes('ninja: build stopped') ||
                (cmd.includes('make') && errorOutput.includes('Error 2'));
            
            if (!isRetryable) {
                error(`[RETRY] Non-retryable error detected, aborting retries`);
                throw execError;
            }
            
            log(`[RETRY] Attempt ${attempt}/${maxRetries} failed, will retry. Error: ${execError.message}`);
            
            // Perform cleanup actions before retry
            if (attempt < maxRetries) {
                try {
                    // Try to clean up any partial build artifacts
                    if (fs.existsSync(dir)) {
                        const buildFiles = fs.readdirSync(dir).filter(file => 
                            file.endsWith('.o') || file.endsWith('.obj') || file === 'CMakeCache.txt'
                        );
                        for (const file of buildFiles.slice(0, 10)) { // Clean up first 10 files
                            try {
                                const filePath = path.join(dir, file);
                                fs.unlinkSync(filePath);
                                log(`[RETRY] Cleaned up: ${file}`);
                            } catch (cleanErr) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                } catch (cleanupErr) {
                    log(`[RETRY] Cleanup failed, continuing anyway: ${cleanupErr.message}`);
                }
            }
        }
    }
}

exports.createDirectory = createDirectory;
exports.deletePath = deletePath;
exports.deleteEmptyDir = deleteEmptyDir;
exports.getModifyTime = getModifyTime;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.copyPath = copyPath;
exports.movePath = movePath;
exports.findFiles = findFiles;
exports.getHash = getHash;
exports.exec = exec;
exports.execSafe = execSafe;
exports.log = log;
exports.error = error;
exports.formatTime = formatTime;
exports.escapeSpace = escapeSpace;
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.withBuildLock = withBuildLock;
exports.sleepSync = sleepSync;
exports.execWithRetry = execWithRetry;
