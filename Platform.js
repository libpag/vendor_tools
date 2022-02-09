const fs = require('fs');
const path = require("path");
const os = require("os");
const childProcess = require("child_process");
const Utils = require("./Utils");

class Platform {
    static Create(name, debug, verbose) {
        if (name === "android") {
            return new AndroidPlatform(debug, verbose);
        }
        if (name === "win") {
            return new WinPlatform(debug, verbose);
        }
        if (name === "ios") {
            return new Platform(name, ["arm", "arm64", "x64", "arm64-simulator"], debug, verbose);
        }
        if (name === "mac") {
            return new Platform(name, ["arm64", "x64"], debug, verbose);
        }
        if (name === "web") {
            return new WebPlatform(name, ["wasm"], debug, verbose);
        }
        return new Platform(name, ["x64"], debug, verbose);
    }

    constructor(name, archs, debug, verbose) {
        this.name = name;
        this.archs = archs;
        this.debug = debug;
        this.verbose = verbose;
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

    get buildType() {
        return this.debug ? "Debug" : "Release";
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

function FindNDK() {
    const NDK_ENVS = ["NDK_HOME", "NDK_PATH", "ANDROID_NDK_HOME", "ANDROID_NDK"];
    for (let env of NDK_ENVS) {
        let NDK = process.env[env];
        if (NDK && fs.existsSync(path.join(NDK, "ndk-build"))) {
            return NDK;
        }
    }
    let HOME = process.env["HOME"];
    let ANDROID_HOME = path.join(HOME, "Library/Android/sdk");
    let NDK_HOME = path.join(ANDROID_HOME, "ndk-bundle");
    if (fs.existsSync(path.join(NDK_HOME, "ndk-build"))) {
        return NDK_HOME;
    }
    let NDK_ROOT = path.join(NDK_HOME, "ndk");
    if (fs.existsSync(NDK_ROOT)) {
        let files = fs.readdirSync(NDK_ROOT);
        for (let fileName of files) {
            NDK_HOME = path.join(NDK_ROOT, fileName)
            if (fs.existsSync(path.join(NDK_HOME, "ndk-build"))) {
                return NDK_HOME;
            }
        }
    }
    return "";
}

class AndroidPlatform extends Platform {
    constructor(debug, verbose) {
        super("android", ["arm", "arm64"], debug, verbose);
        this.ndkHome = FindNDK();
        if (!this.ndkHome) {
            Utils.error("Could not find NDK_HOME!");
            process.exit(1);
        }
    }

    getCommandPath(cmd, arch) {
        let prefix = arch === "arm64" ? "aarch64-linux-android-" : "arm-linux-androideabi-";
        let cmdPath = path.join(this.ndkHome, "toolchains/llvm/prebuilt/darwin-x86_64/bin/" + prefix + cmd);
        if (fs.existsSync(cmdPath)) {
            return cmdPath;
        }
        return super.getCommandPath(cmd, arch);
    }
}

function findMSVCNativeToolCommand() {
    let programDataPath = childProcess.execSync("echo %ProgramData%").toString();
    programDataPath = programDataPath.substring(0, programDataPath.length - 2);
    let startMenuPath = path.join(programDataPath, "Microsoft/Windows/Start Menu/Programs");
    if (!fs.existsSync(startMenuPath)) {
        return "";
    }
    let files = fs.readdirSync(startMenuPath);
    for (let fileName of files) {
        if (fileName.indexOf("Visual Studio") === -1) {
            continue;
        }
        let vsPath = path.join(startMenuPath, fileName);
        let vsFiles = Utils.findFiles(vsPath);
        for (let vsFile of vsFiles) {
            if (vsFile.indexOf("x64 Native Tools Command Prompt for VS") !== -1) {
                return vsFile;
            }
        }
    }
    return "";

}

class WinPlatform extends Platform {
    constructor(debug, verbose) {
        super("win", ["x86", "x64"], debug, verbose);
        let msvcTool = findMSVCNativeToolCommand();
        let buildToolPath = childProcess.execSync("\"" + msvcTool + "\"").toString();
        let lines = buildToolPath.split("\r\n");
        buildToolPath = lines[lines.length - 1];
        this.buildToolPath = buildToolPath.substring(0, buildToolPath.length - 1);
        let vcvars64Path = path.join(this.buildToolPath, "VC/Auxiliary/Build/vcvars64.bat");
        if (fs.existsSync(vcvars64Path)) {
            this.vcvars64Path = vcvars64Path;
        }
        let vcvars32Path = path.join(this.buildToolPath, "VC/Auxiliary/Build/vcvars32.bat");
        if (fs.existsSync(vcvars32Path)) {
            this.vcvars32Path = vcvars32Path;
        }
    }

    getCommandPath(cmd, arch) {
        let cmdPath = super.getCommandPath(cmd, arch);
        if (cmdPath !== cmd) {
            return cmdPath;
        }
        let vcVarsPath = arch === "x86" ? this.vcvars32Path : this.vcvars64Path;
        if (!vcVarsPath) {
            return cmd;
        }
        let result = childProcess.execSync("\"" + vcVarsPath + "\"&where " + cmd).toString();
        let lines = result.split("\r\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            let line = lines[i];
            if (line.indexOf(cmd) !== -1) {
                return line;
            }
        }
        return cmd;
    }

    prependVCVars(cmd, arch) {
        let vcVarsPath = arch === "x86" ? this.vcvars32Path : this.vcvars64Path;
        if (!vcVarsPath) {
            return cmd;
        }
        return Utils.escapeSpace(vcVarsPath) + "&" + cmd;
    }
}

class WebPlatform extends Platform {
    getCommandPath(cmd, arch) {
        if (cmd === "ninja") {
            return super.getCommandPath(cmd, arch);
        }
        return super.getCommandPath("em" + cmd, arch);
    }
}

module.exports = Platform;
