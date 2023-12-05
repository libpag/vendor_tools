const fs = require('fs');
const path = require("path");
const os = require("os");
const Utils = require("./Utils");
const LibraryTool = require("./LibraryTool");

function GetNumberOfJobs() {
    return os.cpus().length + 2;
}

function CopyIncludes(sourcePath, buildPath, outPath, includes) {
    const SourceKey = "${SOURCE_DIR}";
    const BuildKey = "${BUILD_DIR}";
    for (let filePath of includes) {
        let inSource = true;
        if (filePath.indexOf(SourceKey) === 0) {
            filePath = filePath.substring(SourceKey.length);
        } else if (filePath.indexOf(BuildKey) === 0) {
            filePath = filePath.substring(BuildKey.length);
            inSource = false;
        }
        let includeFile;
        if (inSource) {
            includeFile = path.join(sourcePath, filePath);
        } else {
            includeFile = path.join(buildPath, filePath);
        }
        let includeDir = path.dirname(includeFile);
        let files = Utils.findFiles(includeFile);
        for (let file of files) {
            if (path.extname(file).toLowerCase() !== ".h") {
                continue;
            }
            let relativePath = path.relative(includeDir, file);
            Utils.copyPath(file, path.join(outPath, "include", relativePath));
        }
    }
}

function TransformCMakeLists(configFile, platform) {
    let configText = Utils.readFile(configFile);
    let oldConfigText = configText;
    if (configText.indexOf("install(") !== -1 || configText.indexOf("INSTALL(") !== -1) {
        // disable all install()
        const macro = "macro (install)\nendmacro ()\n";
        if (configText.indexOf(macro) === 0) {
            oldConfigText = configText.substring(macro.length);
        } else {
            configText = macro + configText;
        }
    }
    if (platform === "web") {
        const share = "# Disable error for the web platform.\nSET_PROPERTY(GLOBAL PROPERTY TARGET_SUPPORTS_SHARED_LIBS true)\n";
        let index = oldConfigText.indexOf(share);
        if (index !== -1) {
            oldConfigText = oldConfigText.substring(0, index) + oldConfigText.substring(index + share.length);
        } else {
            let keys = ["project(", "project (", "PROJECT(", "PROJECT ("];
            for (const key of keys) {
                index = configText.indexOf(key);
                if (index !== -1) {
                    break;
                }
            }
            if (index !== -1) {
                let tailText = configText.substring(index);
                configText = configText.substring(0, index);
                index = tailText.indexOf("\n");
                configText += tailText.substring(0, index + 1) + share + tailText.substring(index + 1);
            }
        }
    }
    if (configText === oldConfigText) {
        return "";
    }
    Utils.writeFile(configFile, configText);
    return oldConfigText;
}

function FindExactTarget(dir, target) {
    let list = [];
    let files = fs.readdirSync(dir);
    for (let fileName of files) {
        let filePath = path.join(dir, fileName);
        if (fs.statSync(filePath).isDirectory()) {
            let result = FindExactTarget(filePath, target);
            if (result) {
                return result;
            }
        } else if (fileName === target) {
            return filePath;
        }
    }
    return "";
}

class CMake {
    static Create(platform) {
        if (platform.name === "ios") {
            return new IOSCMake(platform);
        }
        if (platform.name === "android") {
            return new AndroidCMake(platform);
        }
        if (platform.name === "win") {
            return new WinCMake(platform);
        }
        if (platform.name === "mac") {
            return new MacCMake(platform);
        }
        if (platform.name === "web") {
            return new WebCMake(platform);
        }
        if (platform.name === "linux") {
            return new LinuxCMake(platform);
        }
        return new CMake(platform);
    }

    constructor(platform) {
        this.platform = platform;
    }

    build(sourcePath, outPath, options, archs) {
        Utils.log("[Toolchains] " + this.platform.toolVersion());
        let buildPath = path.join(outPath, "build-" + options.targets.join("-"));
        if (!options.incremental) {
            Utils.deletePath(buildPath);
        }
        if (!fs.existsSync(buildPath)) {
            Utils.createDirectory(buildPath);
        }
        let cmakeConfigFile = path.resolve(sourcePath, "CMakeLists.txt");
        let oldCMakeConfig = TransformCMakeLists(cmakeConfigFile, this.platform.name);
        let libraries = {};
        for (let arch of archs) {
            let cmakeArgs = this.getCMakeArgs(options.arguments, options.deps, sourcePath, arch);
            let archBuildPath = path.join(buildPath, arch);
            libraries[arch] = this.buildArch(sourcePath, archBuildPath, arch, options.targets, cmakeArgs, options.native);
        }
        if (oldCMakeConfig) {
            Utils.writeFile(cmakeConfigFile, oldCMakeConfig);
        }
        let libraryTool = LibraryTool.Create(this.platform);
        libraryTool.copyLibraries(libraries, outPath);
        if (options.includes) {
            let archBuildPath = path.join(buildPath, archs[0]);
            CopyIncludes(sourcePath, archBuildPath, outPath, options.includes);
        }
        if (!options.incremental) {
            Utils.deletePath(buildPath);
        }
    }

    buildArch(sourcePath, buildPath, arch, targets, cmakeArgs, useNativeGenerator) {
        let buildType = this.platform.buildType();
        Utils.log("Building the '" + arch + "' arch of [" + targets.join(", ") + "]:");
        if (!fs.existsSync(buildPath)) {
            Utils.createDirectory(buildPath);
        }
        Utils.log("cd " + buildPath);
        let verbose = this.platform.verbose;
        let verboseArg = verbose ? " -DCMAKE_VERBOSE_MAKEFILE=ON" : "";
        let cmake = this.getCMake(arch);
        let generator = !useNativeGenerator ? "-G Ninja" : this.getNativeGenerator();
        let cmd = cmake + " " + generator + " -DCMAKE_BUILD_TYPE=" + buildType + verboseArg + " " +
            cmakeArgs.join(" ") + " " + Utils.escapeSpace(sourcePath);
        Utils.exec(cmd, buildPath, verbose);
        let libraries = [];
        for (let target of targets) {
            let cmd = "";
            if (!useNativeGenerator) {
                let ninja = this.platform.getCommandPath("ninja", arch);
                cmd = ninja + " " + target;
            } else {
                cmd = this.getNativeBuildCommand(target, arch, buildType);
            }
            Utils.exec(cmd, buildPath, verbose);
            let found = this.findTargetFile(target, buildPath, libraries);
            if (!found) {
                Utils.error("Could not find the library file matches '" + target + "'!");
                process.exit(1);
            }
        }
        return libraries;
    }

    getNativeGenerator() {
        return "";
    }

    getNativeBuildCommand(target, arch, buildType) {
        let cmake = this.getCMake(arch);
        return cmake + " --build . --config " + buildType + " --target " + target + " -j " + GetNumberOfJobs();
    }

    getCMake(arch) {
        return this.platform.getCommandPath("cmake", arch);
    }

    getCMakeArgs(args, deps, sourcePath, arch) {
        let cmakeArgs = this.getPlatformArgs(arch);
        if (args) {
            cmakeArgs = cmakeArgs.concat(args);
        }
        if (!deps) {
            return cmakeArgs;
        }
        let keys = Object.keys(deps);
        for (let key of keys) {
            let depVendor = deps[key];
            cmakeArgs.push("-DCMAKE_DISABLE_FIND_PACKAGE_" + key + "=TRUE");
            cmakeArgs.push("-D" + key + "_FOUND=TRUE");
            let includeDir = path.join(depVendor.out, this.platform.name, "include");
            if (!fs.existsSync(includeDir)) {
                includeDir = depVendor.source;
            }
            cmakeArgs.push("-D" + key + "_INCLUDE_DIR=\"" + includeDir + "\"");
            cmakeArgs.push("-D" + key + "_INCLUDE_DIRS=\"" + includeDir + "\"");
            let libraryPath = path.join(depVendor.out, this.platform.name, arch);
            let libraries = [];
            if (fs.existsSync(libraryPath)) {
                libraries = LibraryTool.FindLibraries(libraryPath);
            } else {
                libraries = LibraryTool.FindLibraries(path.join(depVendor.out, this.platform.name));
            }
            if (libraries.length > 0) {
                cmakeArgs.push("-D" + key + "_LIBRARY=\"" + libraries.join(";") + "\"");
                cmakeArgs.push("-D" + key + "_LIBRARIES=\"" + libraries.join(";") + "\"");
            }
        }
        return cmakeArgs;
    }

    getPlatformArgs(arch) {
        return [];
    }

    findTargetFile(target, dir, result) {
        let targetFiles = LibraryTool.FindLibraries(dir);
        let frameworks = LibraryTool.FindFrameworks(dir);
        targetFiles = targetFiles.concat(frameworks);
        let found = false;
        for (let targetFile of targetFiles) {
            let fileName = path.parse(targetFile).name;
            if (fileName.endsWith(target) && result.indexOf(targetFile) === -1) {
                result.push(targetFile);
                found = true;
                if (path.extname(targetFile) === ".wasm") {
                    let jsFile = targetFile.substring(0, targetFile.length - 5) + ".js";
                    if (fs.existsSync(jsFile)) {
                        result.push(jsFile);
                    }
                }
                // windows 平台若编译动态库，会产生两个新文件。
                if (this.platform.name !== "win") {
                    return true;
                }
            }
        }
        if (found) {
            return true;
        }
        let targetFile = FindExactTarget(dir, target);
        if (targetFile) {
            result.push(targetFile);
            return true;
        }
        // 可能是配置里设置了重命名，如果没匹配到，默认返回第一个发现的库文件。
        for (let targetFile of targetFiles) {
            if (result.indexOf(targetFile) === -1) {
                result.push(targetFile);
                found = true;
                break;
            }
        }
        return found;
    }
}

class AndroidCMake extends CMake {
    getPlatformArgs(arch) {
        let ndkHome = this.platform.ndkHome;
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + path.join(ndkHome, "build/cmake/android.toolchain.cmake"),
            "-DANDROID_PLATFORM=android-19",
            "-DANDROID_NDK=" + ndkHome,
        ];
        switch (arch) {
            case "arm":
                args.push("-DANDROID_ABI=armeabi-v7a");
                args.push("-DANDROID_ARM_NEON=ON");
                break;
            case "arm64":
                args.push("-DANDROID_ABI=arm64-v8a");
                break;
            case "x64":
                args.push("-DANDROID_ABI=x86_64");
                break;
            case "x86":
                args.push("-DANDROID_ABI=x86");
                break;
        }
        return args;
    }
}

class AppleCMake extends CMake {
    getNativeGenerator() {
        return "-G Xcode";
    }

    getNativeBuildCommand(target, arch, buildType) {
        let sdkName = ""
        let archName = "";
        if (this.platform.name === "ios") {
            switch (arch) {
                case "arm":
                case "arm64":
                    sdkName = "iphoneos";
                    break;
                case "x64":
                case "arm64_simulator":
                    sdkName = "iphonesimulator";
                    break;
            }
        } else {
            sdkName = "macosx";
        }
        switch (arch) {
            case "arm64":
            case "arm64_simulator":
                archName = "arm64";
                break;
            case "x64":
                archName = "x86_64";
                break;
            case "arm":
                archName = "armv7";
                break;
        }
        let xcodeArgs = [];
        if (sdkName) {
            xcodeArgs.push("-sdk " + sdkName);
        }
        if (archName) {
            xcodeArgs.push("-arch " + archName);
        }
        if (buildType === "Release") {
            xcodeArgs.push("BUILD_LIBRARY_FOR_DISTRIBUTION=YES");
        }
        return "xcodebuild -target " + target + " -configuration " + buildType + " " +
            xcodeArgs.join(" ") + " -jobs " + GetNumberOfJobs();
    }
}

class IOSCMake extends AppleCMake {
    constructor(platform) {
        super(platform);
        this.toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    }

    getPlatformArgs(arch) {
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + this.toolchain
        ];
        if (arch === "x64") {
            args.push("-DPLATFORM=SIMULATOR64");
        } else if (arch === "arm64-simulator") {
            args.push("-DPLATFORM=SIMULATORARM64");
        } else if (arch === "arm") {
            args.push("-DPLATFORM=OS");
            args.push("-DARCHS=armv7");
        } else {
            args.push("-DPLATFORM=OS64");
        }
        return args;
    }
}

class MacCMake extends AppleCMake {
    constructor(platform) {
        super(platform);
        this.toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    }

    getPlatformArgs(arch) {
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + this.toolchain
        ];
        if (arch === "x64") {
            args.push("-DPLATFORM=MAC");
        } else if (arch === "arm64") {
            args.push("-DPLATFORM=MAC_ARM64");
        }
        return args;
    }
}

class WinCMake extends CMake {
    getPlatformArgs(arch) {
        return [
            "-DCMAKE_C_FLAGS_RELEASE=/Zc:inline",
            "-DCMAKE_PROJECT_INCLUDE=" + path.resolve(__dirname, "../win.msvc.cmake")
        ];
    }
}

class WebCMake extends CMake {
    getCMake(arch) {
        let cmake = super.getCMake(arch);
        return cmake + " cmake";
    }
}

class LinuxCMake extends CMake {
    getPlatformArgs(arch) {
        return [
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"
        ];
    }
}

module.exports = CMake;
