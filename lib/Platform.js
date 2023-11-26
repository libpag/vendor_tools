const fs = require('fs');
const path = require("path");
const os = require("os");
const Utils = require("./Utils");
const ToolVersion = "1.0.3"

function getExistedCommandFile(cmdPath) {
    if (os.platform() === "win32") {
        if (fs.existsSync(cmdPath + ".exe")) {
            return cmdPath + ".exe";
        }
        if (fs.existsSync(cmdPath + ".cmd")) {
            return cmdPath + ".cmd";
        }
    }
    if (fs.existsSync(cmdPath)) {
        return cmdPath;
    }
    return "";
}

class Platform {
    static Create(name, debug, verbose) {
        if (name === "android") {
            return new AndroidPlatform(debug, verbose);
        }
        if (name === "win") {
            return new WinPlatform(debug, verbose);
        }
        if (name === "ios") {
            return new Platform(name, ["arm64", "arm64-simulator", "x64"], debug, verbose);
        }
        if (name === "mac") {
            return new Platform(name, ["arm64", "x64"], debug, verbose);
        }
        if (name === "web") {
            return new WebPlatform(debug, verbose);
        }
        return new Platform(name, ["x64"], debug, verbose);
    }

    constructor(name, archs, debug, verbose) {
        this.name = name;
        this.archs = archs;
        this.debug = !!debug;
        this.verbose = !!verbose;
        let p = os.platform();
        if (p === "darwin") {
            this.hostToolPath = path.resolve(__dirname, "../mac");
        } else if (p === "win32") {
            this.hostToolPath = path.resolve(__dirname, "../win");
        } else if (p === "linux") {
            this.hostToolPath = path.resolve(__dirname, "../linux");
        }
    }

    toString() {
        return this.name;
    }

    buildType() {
        return this.debug ? "Debug" : "Release";
    }

    toolVersion() {
        return ToolVersion;
    }

    setArch(arch) {
        if (arch) {
            arch = arch.toLowerCase();
        }
        if (this.archs.indexOf(arch) === -1) {
            Utils.error("Unsupported arch: " + arch);
            process.exit(1);
        }
        this.archs = [arch];
    }

    getCommandPath(cmd, arch) {
        let cmdPath = path.join(this.hostToolPath, cmd);
        cmdPath = getExistedCommandFile(cmdPath);
        if (cmdPath) {
            return Utils.escapeSpace(cmdPath);
        }
        return cmd;
    }
}


class MSVC {
    constructor(path, version, vcvars32, vcvars64) {
        this.path = path;
        this.version = version;
        this.mainVersion = version.split(".")[0];
        this.vcvars32Path = vcvars32;
        this.vcvars64Path = vcvars64;
    }

    prependVCVars(cmd, arch) {
        cmd = Utils.escapeSpace(cmd);
        let env = process.env;
        if (env["DevEnvDir"] !== undefined && env["Platform"] === arch) {
            return cmd;
        }
        let vcVarsPath = arch === "x86" ? this.vcvars32Path : this.vcvars64Path;
        if (!vcVarsPath) {
            return cmd;
        }
        return Utils.escapeSpace(vcVarsPath) + "&" + cmd;
    }
}

function findMSVC() {
    let vswhere = path.resolve(__dirname, "../win/vswhere.exe");
    let vsPath = Utils.execSafe(vswhere + " -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath").trim();
    if (!fs.existsSync(vsPath)) {
        return null;
    }
    let vsVersion = Utils.execSafe(vswhere + " -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion").trim();
    let vcvars32Path = path.join(vsPath, "VC/Auxiliary/Build/vcvars32.bat");
    let vcvars64Path = path.join(vsPath, "VC/Auxiliary/Build/vcvars64.bat");
    if (!fs.existsSync(vcvars64Path) || !fs.existsSync(vcvars32Path)) {
        return null;
    }
    return new MSVC(vsPath, vsVersion, vcvars32Path, vcvars64Path);
}


class WinPlatform extends Platform {
    constructor(debug, verbose) {
        super("win", ["x64", "x86"], debug, verbose);
        this.msvc = findMSVC();
        if (!this.msvc) {
            Utils.error("Could not find the installation path of MSVC!");
            process.exit(1);
        }
    }

    toolVersion() {
        let info = super.toolVersion();
        return info + " (MSVC: " + this.msvc.mainVersion + ")";
    }

    getCommandPath(cmd, arch) {
        let cmdPath = super.getCommandPath(cmd, arch);
        if (cmdPath !== cmd) {
            return cmdPath;
        }
        if (this.msvc) {
            return this.msvc.prependVCVars(cmd, arch);
        }
        return cmd;
    }
}

function FindNDKVersion(ndkPath) {
    if (!ndkPath) {
        return "";
    }
    let ndkBuild = path.join(ndkPath, "ndk-build");
    if (!getExistedCommandFile(ndkBuild)) {
        return "";
    }
    let versionFile = path.join(ndkPath, "source.properties");
    if (!fs.existsSync(versionFile)) {
        return "";
    }
    let lines = Utils.readFile(versionFile).split("\n");
    for (let line of lines) {
        if (line.indexOf("Pkg.Revision") === -1) {
            continue;
        }
        let list = line.split("=");
        if (list.length < 2) {
            continue;
        }
        return list[1].trim();
    }
    return "";
}

function FindAndroidHome() {
    const SDK_ENVS = ["ANDROID_SDK_HOME", "ANDROID_SDK_ROOT", "ANDROID_HOME", "ANDROID_SDK"];
    for (let env of SDK_ENVS) {
        let sdkPath = process.env[env];
        if (fs.existsSync(sdkPath)) {
            return sdkPath;
        }
    }
    if (os.platform() === "win32") {
        let home = process.env["LOCALAPPDATA"];
        let sdkPath = path.join(home, "Android/Sdk");
        if (fs.existsSync(sdkPath)) {
            return sdkPath;
        }
    }
    let home = process.env["HOME"];
    let sdkPath = path.join(home, "Library/Android/sdk");
    if (fs.existsSync(sdkPath)) {
        return sdkPath;
    }
    return "";
}

const MIN_NDK_VERSION = 19;

function FindNDK() {
    let ndkVersions = [];
    const NDK_ENVS = ["ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK", "NDK_HOME", "NDK_ROOT", "NDK_PATH"];
    for (let env of NDK_ENVS) {
        let NDK = process.env[env];
        let version = FindNDKVersion(NDK);
        if (version) {
            ndkVersions.push({path: NDK, version: version});
        }
    }
    let ANDROID_HOME = FindAndroidHome();
    let NDK_HOME = path.join(ANDROID_HOME, "ndk-bundle");
    let version = FindNDKVersion(NDK_HOME);
    if (version) {
        ndkVersions.push({path: NDK_HOME, version: version});
    }
    let NDK_ROOT = path.join(ANDROID_HOME, "ndk");
    if (fs.existsSync(NDK_ROOT)) {
        let files = fs.readdirSync(NDK_ROOT);
        for (let fileName of files) {
            let NDK_HOME = path.join(NDK_ROOT, fileName)
            let version = FindNDKVersion(NDK_HOME);
            if (version) {
                ndkVersions.push({path: NDK_HOME, version: version});
            }
        }
    }
    for (let ndk of ndkVersions) {
        ndk.mainVersion = parseInt(ndk.version.split(".")[0]);
    }
    ndkVersions.sort((a, b) => {
        return a.mainVersion - b.mainVersion;
    });
    for (let ndk of ndkVersions) {
        if (ndk.mainVersion >= MIN_NDK_VERSION) {
            return {path: ndk.path, version: ndk.version};
        }
    }
    if (ndkVersions.length > 0) {
        let ndk = ndkVersions[0];
        Utils.error("The minimum required Android NDK version of 19 or higher could not be located! Use the version '" +
            ndk.version + "' in ‘" + ndk.path + "' instead, which may have compile errors!");
        return ndk;
    }
    return {path: "", version: ""};
}

class AndroidPlatform extends Platform {
    constructor(debug, verbose) {
        super("android", ["arm", "arm64"], debug, verbose);
        let ndk = FindNDK();
        this.ndkHome = ndk.path;
        this.ndkVersion = ndk.version;
        if (!this.ndkHome) {
            Utils.error("Could not find the location of Android NDK!");
            process.exit(1);
        }
        if (os.platform() === "win32") {
            this.msvc = findMSVC();
        }
    }


    toolVersion() {
        let info = super.toolVersion();
        return info + " (NDK: " + this.ndkVersion + ")";
    }

    getCommandPath(cmd, arch) {
        let platform = os.platform() === "win32" ? "windows" : os.platform();
        let binDir = path.resolve(this.ndkHome, "toolchains/llvm/prebuilt", platform + "-x86_64", "bin");
        let prefixes = [];
        switch (arch) {
            case "arm":
                prefixes.push("arm-linux-androideabi-");
                prefixes.push("armv7a-linux-androideabi");
                break;
            case "arm64":
                prefixes.push("aarch64-linux-android-");
                break;
            case "x64":
                prefixes.push("x86_64-linux-android-");
                break;
            case "x86":
                prefixes.push("i686-linux-android-");
                break;
        }
        prefixes.push("llvm-");
        prefixes.push("");
        for (let prefix of prefixes) {
            let cmdPath = path.join(binDir, prefix + cmd);
            cmdPath = getExistedCommandFile(cmdPath);
            if (cmdPath) {
                return Utils.escapeSpace(cmdPath);
            }
        }
        let cmdPath = super.getCommandPath(cmd, arch);
        if (cmdPath !== cmd) {
            return cmdPath;
        }
        if (this.msvc) {
            return this.msvc.prependVCVars(cmd, arch);
        }
        return cmd;
    }
}

function findEmscriptenVersion() {
    let emcc = Utils.execSafe("emcc --version");
    if (!emcc) {
        return "";
    }
    let lines = emcc.split("\n");
    let versionLine = "";
    for (let line of lines) {
        if (line.indexOf("emcc") !== -1) {
            versionLine = line;
            break;
        }
    }
    if (!versionLine) {
        return "";
    }
    let version = versionLine.match(/\d+\.\d+\.\d+/);
    if (!version) {
        return "";
    }
    return version[0].trim();
}

class WebPlatform extends Platform {
    constructor(debug, verbose) {
        super("web", ["wasm"], debug, verbose);
        this.emccVersion = findEmscriptenVersion();
        if (!this.emccVersion) {
            Utils.error("Could not find working Emscripten SDK!");
            process.exit(1);
        }
    }

    toolVersion() {
        let info = super.toolVersion();
        return info + " (Emscripten: " + this.emccVersion + ")";
    }

    getCommandPath(cmd, arch) {
        if (cmd === "ninja") {
            return super.getCommandPath(cmd, arch);
        }
        return super.getCommandPath("em" + cmd, arch);
    }
}

module.exports = Platform;
