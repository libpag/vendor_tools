const fs = require('fs');
const path = require("path");
const os = require("os");
const Utils = require("./Utils");
const ToolVersion = "1.0.4"

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
            return new ApplePlatform(name, ["arm64", "arm64-simulator", "x64"], debug, verbose);
        }
        if (name === "mac") {
            return new ApplePlatform(name, ["arm64", "x64"], debug, verbose);
        }
        if (name === "web") {
            return new WebPlatform(debug, verbose);
        }
        if (name === "ohos") {
            return new OhosPlatform(debug, verbose);
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

    toolVersion() {
        return "Vendor Tools " + ToolVersion;
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

function findXCodeVersion() {
    let xcodeVersion = Utils.execSafe("xcodebuild -version").trim();
    if (!xcodeVersion) {
        return "";
    }
    let firstLine = xcodeVersion.split("\n")[0];
    let lines = firstLine.split(" ");
    if (lines.length < 2) {
        return "";
    }
    return lines[1].trim();
}

class ApplePlatform extends Platform {
    constructor(name, archs, debug, verbose) {
        super(name, archs, debug, verbose);
        this.xcodeVersion = findXCodeVersion();
        if (!this.xcodeVersion) {
            Utils.error("Could not find the Xcode command line tools!");
            process.exit(1);
        }
        this.xcodeMainVersion = this.xcodeVersion.split(".")[0];
    }

    toolVersion() {
        let info = super.toolVersion();
        return info + " Xcode " + this.xcodeMainVersion;
    }
}

class MSVC {
    constructor(path, version, vcvars32, vcvars64) {
        this.path = path;
        this.version = version;
        let lines = version.split(".");
        if (lines.length > 1) {
            lines = lines.slice(0, 2);
        }
        this.mainVersion = lines.join(".")
        ;this.vcvars32Path = vcvars32;
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
        return info + " MSVC " + this.msvc.mainVersion;
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
    let cmakeNDK = process.env["CMAKE_ANDROID_NDK"];
    if (cmakeNDK) {
        // Force to use the android ndk path set by cmake.
        let version = FindNDKVersion(cmakeNDK);
        return {path: cmakeNDK, version: version};
    }
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
        super("android", ["arm", "arm64", "x64"], debug, verbose);
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
        info += " Android NDK " + this.ndkVersion;
        if (this.msvc) {
            info += " MSVC " + this.msvc.mainVersion;
        }
        return info;
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
            Utils.error("Could not find the Emscripten SDK!");
            process.exit(1);
        }
        if (os.platform() === "win32") {
            this.msvc = findMSVC();
        }
    }

    toolVersion() {
        let info = super.toolVersion();
        info += " Emscripten SDK " + this.emccVersion;
        if (this.msvc) {
            info += " MSVC " + this.msvc.mainVersion;
        }
        return info;
    }

    getCommandPath(cmd, arch) {
        if (cmd !== "ninja") {
            cmd = "em" + cmd;
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

function FindOhosNDKVersion(ndkPath) {
    if (!ndkPath) {
        return "";
    }
    let versionFile = path.join(ndkPath, "oh-uni-package.json");
    if (!fs.existsSync(versionFile)) {
        return "";
    }
    let fileContent = fs.readFileSync(versionFile, 'utf-8');
    let jsonData = JSON.parse(fileContent);
    return jsonData.apiVersion;
}

function FindOhosNDK() {
    let OhosNDK = process.env["CMAKE_OHOS_NDK"];
    if (OhosNDK) {
        let version = FindOhosNDKVersion(OhosNDK);
        if (version) {
            return {path: OhosNDK, version: version};
        }
    }

    let p = os.platform();
    if (p === "darwin") {
        let devEcoPath = '/Applications/DevEco-Studio.app/Contents/sdk';
        let versionFilePaths = Utils.findFiles(devEcoPath, function (filePath) {
            return path.basename(filePath) === "oh-uni-package.json" && filePath.indexOf("native") >= 0;
        });
        for (let versionFilePath of versionFilePaths) {
            let NDK = path.dirname(versionFilePath);
            let version = FindOhosNDKVersion(NDK);
            if (version) {
                return {path: NDK, version: version};
            }
        }
    }

    let SDKPath = process.env["OHOS_SDK"];
    if (SDKPath) {
        let NDK = path.join(SDKPath, "native");
        let version = FindOhosNDKVersion(NDK);
        if (version) {
            return {path: NDK, version: version};
        }
    }
    return {path: "", version: ""};
}

// check if the cmake version >= 3.30
function CheckCMakeVersion() {
    let cmakeVersion = Utils.execSafe("cmake --version");
    if (!cmakeVersion) {
        return false;
    }
    let lines = cmakeVersion.split("\n");
    let versionLine = "";
    for (let line of lines) {
        if (line.indexOf("cmake") !== -1) {
            versionLine = line;
            break;
        }
    }
    if (!versionLine) {
        return false;
    }
    let version = versionLine.match(/\d+\.\d+\.\d+/);
    if (!version) {
        return false;
    }
    let versionArray = version[0].split(".");
    if (versionArray.length < 3) {
        return false;
    }
    let major = parseInt(versionArray[0]);
    let minor = parseInt(versionArray[1]);
    if (major < 3) {
        return false;
    }
    return !(major === 3 && minor < 30);
}

class OhosPlatform extends Platform {
    constructor(debug, verbose) {
        super("ohos", ["arm64", "x64"], debug, verbose);
        let ndk = FindOhosNDK();
        this.ndkHome = ndk.path;
        this.ndkVersion = ndk.version;
        if (!this.ndkHome) {
            Utils.error("Could not find the location of ohos NDK!");
            process.exit(1);
        }
        // If cmake version >= 3.30, it has the built-in support for ohos.
        this.useSystemCMake = CheckCMakeVersion();
    }

    toolVersion() {
        let info = super.toolVersion();
        info += " ohos NDK " + this.ndkVersion;
        return info;
    }

    getCommandPath(cmd, arch) {
        if (cmd === "cmake") {
            return this.useSystemCMake ? "cmake" : path.join(this.ndkHome, "build-tools/cmake/bin/cmake");
        }
        let binDir = path.resolve(this.ndkHome, "llvm/bin");
        let prefix = "llvm-";
        let cmdPath = path.join(binDir, prefix + cmd);
        cmdPath = getExistedCommandFile(cmdPath);
        if (cmdPath) {
            return Utils.escapeSpace(cmdPath);
        }
        cmdPath = super.getCommandPath(cmd, arch);
        if (cmdPath !== cmd) {
            return cmdPath;
        }
        return cmd;
    }
}


module.exports = Platform;