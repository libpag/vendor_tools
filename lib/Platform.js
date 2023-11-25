const fs = require('fs');
const path = require("path");
const os = require("os");
const Utils = require("./Utils");
const DefaultVersion = "1.0.3"

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
            this.hostToolPath = path.join(__dirname, "mac");
        } else if (p === "win32") {
            this.hostToolPath = path.join(__dirname, "win");
        } else if (p === "linux") {
            this.hostToolPath = path.join(__dirname, "linux");
        }
    }

    toString() {
        return this.name;
    }

    buildType() {
        return this.debug ? "Debug" : "Release";
    }

    toolVersion() {
        return DefaultVersion;
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
        if (this.name === "win" && path.extname(cmd) === "") {
            cmdPath += ".exe";
        }
        if (fs.existsSync(cmdPath)) {
            return cmdPath;
        }
        return cmd;
    }
}

const PreferredNDKVersions = ["19.2.5345600", "20.1.5948944", "21.0.6113669"];

function FindNDKVersion(ndkPath) {
    if (!ndkPath) {
        return "";
    }
    if (!fs.existsSync(path.join(ndkPath, "ndk-build"))) {
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

function FindNDK() {
    let ndkPaths = [];
    let ndkVersions = [];
    const NDK_ENVS = ["NDK_HOME", "NDK_PATH", "ANDROID_NDK_HOME", "ANDROID_NDK"];
    for (let env of NDK_ENVS) {
        let NDK = process.env[env];
        let ndkVersion = FindNDKVersion(NDK);
        if (ndkVersion) {
            ndkPaths.push(NDK);
            ndkVersions.push(ndkVersion);
        }
    }
    let HOME = process.env["HOME"];
    let ANDROID_HOME = path.join(HOME, "Library/Android/sdk");
    let NDK_HOME = path.join(ANDROID_HOME, "ndk-bundle");
    let ndkVersion = FindNDKVersion(NDK_HOME);
    if (ndkVersion) {
        ndkPaths.push(NDK_HOME);
        ndkVersions.push(ndkVersion);
    }
    let NDK_ROOT = path.join(ANDROID_HOME, "ndk");
    if (fs.existsSync(NDK_ROOT)) {
        let files = fs.readdirSync(NDK_ROOT);
        for (let fileName of files) {
            NDK_HOME = path.join(NDK_ROOT, fileName)
            let ndkVersion = FindNDKVersion(NDK_HOME);
            if (ndkVersion) {
                ndkPaths.push(NDK_HOME);
                ndkVersions.push(ndkVersion);
            }
        }
    }
    for (let version of PreferredNDKVersions) {
        let index = ndkVersions.indexOf(version);
        if (index !== -1) {
            return {path: ndkPaths[index], version: ndkVersions[index]};
        }
    }
    if (ndkPaths.length > 0) {
        return {path: ndkPaths[0], version: ndkVersions[0]};
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
            Utils.error("Could not find NDK_HOME!");
            process.exit(1);
        } else {
            Utils.log("Found working NDK version '" + this.ndkVersion + "' in '" + this.ndkHome + "'");
        }
    }


    toolVersion() {
        let info = super.toolVersion();
        return info + " (NDK: " + this.ndkVersion + ")";
    }

    getCommandPath(cmd, arch) {
        let prefix = arch === "arm64" ? "aarch64-linux-android-" : "arm-linux-androideabi-";
        let cmdPath = path.join(this.ndkHome, "toolchains/llvm/prebuilt/" + os.platform() + "-x86_64/bin/" + prefix + cmd);
        if (fs.existsSync(cmdPath)) {
            return cmdPath;
        }
        return super.getCommandPath(cmd, arch);
    }
}

function findMSVC() {
    let vswhere = path.resolve(__dirname, "../win/vswhere.exe");
    let result = Utils.execSafe(vswhere + " -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath");
    if (!result) {
        return {path: "", version: ""};
    }
    let lines = result.trim().split("\r\n");
    let vsPath = lines[lines.length - 1].trim();
    if (!fs.existsSync(vsPath)) {
        return {path: "", version: ""};
    }
    let vsVersion = Utils.execSafe(vswhere + " -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion");
    lines = vsVersion.trim().split("\r\n");
    vsVersion = lines[lines.length - 1].trim();
    return {path: vsPath, version: vsVersion};
}

class WinPlatform extends Platform {
    constructor(debug, verbose) {
        super("win", ["x64", "x86"], debug, verbose);
        let msvc = findMSVC();
        this.msvcPath = msvc.path;
        this.msvcVersion = msvc.version;
        let vcvars64Path = path.join(this.msvcPath, "VC/Auxiliary/Build/vcvars64.bat");
        if (fs.existsSync(vcvars64Path)) {
            this.vcvars64Path = vcvars64Path;
        }
        let vcvars32Path = path.join(this.msvcPath, "VC/Auxiliary/Build/vcvars32.bat");
        if (fs.existsSync(vcvars32Path)) {
            this.vcvars32Path = vcvars32Path;
        }
        if (this.vcvars32Path && this.vcvars64Path) {
            Utils.log("Found working MSVC version '" + this.msvcVersion + "' in '" + this.msvcPath + "'");
        } else {
            Utils.error("Could not find MSVC!");
            process.exit(1);
        }
    }

    toolVersion() {
        let info = super.toolVersion();
        return info + " (MSVC: " + this.msvcVersion + ")";
    }

    prependVCVars(cmd, arch) {
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
            Utils.error("Could not find Emscripten!");
            process.exit(1);
        } else {
            Utils.log("Found working Emscripten version '" + this.emccVersion + "'");
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
