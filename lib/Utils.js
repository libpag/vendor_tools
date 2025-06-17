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
    if (printCmd) {
        log(cmd);
    }
    let result = childProcess.spawnSync(cmd, options);
    if (result.status !== 0) {
        if (!verbose) {
            log(result.stdout);
            error(result.stderr);
        }
        process.exit(1);
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

function acquireLock(lockFile) {
    // Busy-wait to get an exclusive lock file. The lock is considered held as long as the file exists.
    // The function returns the file descriptor so that callers can later release it safely.
    const start = Date.now();
    const timeoutMs = 10 * 60 * 1000; // 10 minutes safety net
    while (true) {
        try {
            // "wx" – Like "w" but fails if path exists.
            const fd = fs.openSync(lockFile, 'wx');
            fs.writeSync(fd, process.pid.toString());
            return fd;
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
            // Another process owns the lock – wait a bit and retry.
            if (Date.now() - start > timeoutMs) {
                throw new Error('Timeout waiting for lock: ' + lockFile);
            }
            // Sleep ~100ms. Use a synchronous sleep implemented via Atomics if available, otherwise spin.
            try {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
            } catch (e) {
                // Fallback for Node versions without Atomics.wait
                const waitUntil = Date.now() + 100;
                while (Date.now() < waitUntil) {}
            }
        }
    }
}

function releaseLock(lockFile, fd) {
    try {
        if (typeof fd === 'number') {
            fs.closeSync(fd);
        }
    } catch (e) {
        // ignore
    }
    try {
        fs.unlinkSync(lockFile);
    } catch (e) {
        // ignore
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
