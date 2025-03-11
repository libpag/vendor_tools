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
                    index = configText.indexOf(")", index);
                    break;
                }
            }
            if (index !== -1) {
                let tailText = configText.substring(index+1);
                configText = configText.substring(0, index+1);
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

function FindSameNameTargets(targetFile, extentions, results) {
    let fileName = path.parse(targetFile).name;
    let dir = path.dirname(targetFile);
    for (let ext of extentions) {
        let file = path.join(dir, fileName + ext);
        if (results.indexOf(file) === -1 && fs.existsSync(file)) {
            results.push(file);
        }
    }
}

function EscapeFrameworkPath(filePath) {
    let index = filePath.indexOf(".framework");
    if (index !== -1) {
        let frameworkPath = filePath.substring(0, index + 10);
        let library = path.join(frameworkPath, path.parse(frameworkPath).name);
        if (fs.existsSync(library)) {
            return frameworkPath;
        }
    }
    return filePath;
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
        if (platform.name === "ohos") {
            return new OhosCMake(platform);
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
        let buildType = "";
        if (this.platform.debug) {
            buildType = "Debug";
            options.symbols = true;
        } else if (options.symbols) {
            buildType = "RelWithDebInfo";
        } else {
            buildType = "Release";
        }

        let cmakeConfigFile = path.resolve(sourcePath, "CMakeLists.txt");
        let oldCMakeConfig = TransformCMakeLists(cmakeConfigFile, this.platform.name);
        let libraryMap = {};
        for (let arch of archs) {
            let cmakeArgs = this.getCMakeArgs(options.arguments, options.deps, sourcePath, arch);
            let archBuildPath = path.join(buildPath, arch);
            let libraries = this.buildArch(sourcePath, archBuildPath, buildType, arch, options.targets, cmakeArgs, options.native);
            libraryMap[arch] = this.copyLibraries(libraries, outPath, arch, options.symbols);
        }
        if (oldCMakeConfig) {
            Utils.writeFile(cmakeConfigFile, oldCMakeConfig);
        }
        if (options.includes) {
            let archBuildPath = path.join(buildPath, archs[0]);
            CopyIncludes(sourcePath, archBuildPath, outPath, options.includes);
        }
        if (!options.incremental) {
            Utils.deletePath(buildPath);
        }
        return libraryMap;
    }

    buildArch(sourcePath, buildPath, buildType, arch, targets, cmakeArgs, useNativeGenerator) {
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
            if (useNativeGenerator) {
                cmd = this.getNativeBuildCommand(target, arch, buildType);
            } else {
                let ninja = this.platform.getCommandPath("ninja", arch);
                cmd = ninja + " " + target;
            }
            Utils.exec(cmd, buildPath, verbose);
            let targetFile = "";
            if (useNativeGenerator) {
                targetFile = this.findNativeTargetFile(target, buildPath, arch, buildType);
            } else {
                targetFile = this.findNinjaTargetFile(target, buildPath, arch, buildType);
            }
            if (!targetFile) {
                targetFile = this.findTargetFileFallback(target, buildPath);
            }
            if (!targetFile) {
                Utils.error("Could not find the library file matches '" + target + "'!");
                process.exit(1);
            }
            libraries.push(targetFile);
            if (this.platform.name === "win") {
                FindSameNameTargets(targetFile, [".lib", ".dll", ".pdb"], libraries);
            } else if (path.extname(targetFile) === ".js" || path.extname(targetFile) === ".wasm") {
                FindSameNameTargets(targetFile, [".wasm", ".js"], libraries);
            }
        }
        return libraries;
    }

    copyLibraries(libraries, outPath, arch, keepSymbols) {
        let outputs = [];
        for (let libraryFile of libraries) {
            let libraryName = path.basename(libraryFile);
            let output = path.join(outPath, arch, libraryName);
            outputs.push(output);
            Utils.copyPath(libraryFile, output);
        }
        return outputs;
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
            cmakeArgs = this.mergeCMakeFlags(cmakeArgs);
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

    mergeCMakeFlags(cmakeArgs) {
        if (!cmakeArgs || cmakeArgs.length === 0) {
            return cmakeArgs;
        }
        let cFlags = cmakeArgs.filter(item => item.includes('-DCMAKE_C_FLAGS='));
        let cxxFlags = cmakeArgs.filter(item => item.includes('-DCMAKE_CXX_FLAGS='));
        if (cFlags.length <= 1 && cxxFlags.length <= 1) {
            return cmakeArgs;
        }
        let mergedCFlags = [...new Set(cFlags.map(flag => flag.match(/-DCMAKE_C_FLAGS="([^"]*)"/)[1].split(' ')).flat())].join(' ');
        let mergedCxxFlags = [...new Set(cxxFlags.map(flag => flag.match(/-DCMAKE_CXX_FLAGS="([^"]*)"/)[1].split(' ')).flat())].join(' ');
        let mergedData = cmakeArgs.filter(item => !item.includes('-DCMAKE_C_FLAGS=') && !item.includes('-DCMAKE_CXX_FLAGS='));
        if (mergedCFlags) {
            mergedData.push(`-DCMAKE_C_FLAGS="${mergedCFlags}"`);
        }
        if (mergedCxxFlags) {
            mergedData.push(`-DCMAKE_CXX_FLAGS="${mergedCxxFlags}"`);
        }
        return mergedData;
    }

    getPlatformArgs(arch) {
        return [];
    }

    findNinjaTargetFile(target, buildDir, arch, buildType) {
        let ninja = this.platform.getCommandPath("ninja", arch);
        let cmd = ninja + " -t query " + target;
        let output = Utils.execSafe(cmd, buildDir);
        if (output.indexOf("ninja: error:") === -1) {
            let lines = output.split("\n");
            let file = "";
            for (let line of lines) {
                file = path.join(buildDir, line.trim());
                if (fs.existsSync(file)) {
                    return EscapeFrameworkPath(file);
                }
            }
        }
        return "";
    }

    findNativeTargetFile(target, buildDir, arch, buildType) {
        return "";
    }

    findTargetFileFallback(target, buildDir) {
        let targetFiles = LibraryTool.FindLibraries(buildDir);
        let frameworks = LibraryTool.FindFrameworks(buildDir);
        targetFiles = targetFiles.concat(frameworks);
        for (let targetFile of targetFiles) {
            let fileName = path.parse(targetFile).name;
            if (fileName.endsWith(target)) {
                return targetFile;
            }
        }
        let targetFile = FindExactTarget(buildDir, target);
        if (targetFile) {
            return targetFile;
        }
        // Maybe the target is renamed in the config file. If not found, return the first found library file.
        if (targetFiles.length > 0) {
            Utils.log("Could not find the library file matches '" + target + "'! Return the first found library file.");
            return targetFiles[0];
        }
        return "";
    }
}

class AndroidCMake extends CMake {
    constructor(platform) {
        super(platform);
        this.libraryTool = LibraryTool.Create(platform);
    }

    getPlatformArgs(arch) {
        let ndkHome = this.platform.ndkHome;
        let toolChainFile = path.join(ndkHome, "build/cmake/android.toolchain.cmake");
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(toolChainFile),
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

    copyLibraries(libraries, outPath, arch, keepSymbols) {
        let outputs = [];
        for (let libraryFile of libraries) {
            if (!keepSymbols) {
                // some platforms generate debug symbols by default, strip them.
                this.libraryTool.stripDebugSymbols(libraryFile, arch);
            }
            let libraryName = path.basename(libraryFile);
            let output = path.join(outPath, arch, libraryName);
            outputs.push(output);
            Utils.copyPath(libraryFile, output);
        }
        return outputs;
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
        if (buildType !== "Debug") {
            xcodeArgs.push("BUILD_LIBRARY_FOR_DISTRIBUTION=YES");
        }
        return "xcodebuild -target " + target + " -configuration " + buildType + " " +
            xcodeArgs.join(" ") + " -jobs " + GetNumberOfJobs();
    }

    findNativeTargetFile(target, buildDir, arch, buildType) {
        let sdk = "";
        if (this.platform.name === "ios") {
            if (arch === "x64" || arch === "arm64-simulator") {
                sdk = "iphonesimulator";
            } else {
                sdk = "iphoneos";
            }
        } else {
            sdk = "macosx";
        }
        let cmd = "xcodebuild -target " + target + " -sdk " + sdk + " -configuration " + buildType + " -showBuildSettings";
        cmd += " | grep -m 1 \"CODESIGNING_FOLDER_PATH\" | awk '{print $3}'";
        let targetFile = Utils.execSafe(cmd, buildDir).trim();
        if (fs.existsSync(targetFile)) {
            return EscapeFrameworkPath(targetFile);
        }
        return "";
    }
}

class IOSCMake extends AppleCMake {
    constructor(platform) {
        super(platform);
        this.toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    }

    getPlatformArgs(arch) {
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(this.toolchain)
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
            "-DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(this.toolchain)
        ];
        if (arch === "x64") {
            args.push("-DPLATFORM=MAC");
        } else if (arch === "arm64") {
            args.push("-DPLATFORM=MAC_ARM64");
        } else if (arch === "universal") {
            args.push("-DPLATFORM=MAC");
            args.push("-DARCHS=\"x86_64;arm64\"");
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

    getPlatformArgs(arch) {
        if (arch === "wasm-mt") {
            return [
                '-DEMSCRIPTEN_PTHREADS=ON',
                '-DCMAKE_C_FLAGS="-fPIC -pthread -fno-rtti"',
                '-DCMAKE_CXX_FLAGS="-fPIC -pthread -fno-rtti"'
            ];
        }
        return [
            '-DCMAKE_C_FLAGS="-fno-rtti"',
            '-DCMAKE_CXX_FLAGS="-fno-rtti"'
        ];
    }
}

class LinuxCMake extends CMake {
    getPlatformArgs(arch) {
        return [
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"
        ];
    }
}

class OhosCMake extends CMake {
    constructor(platform) {
        super(platform);
        this.libraryTool = LibraryTool.Create(platform);
    }

    getPlatformArgs(arch) {
        let ndkHome = this.platform.ndkHome;
        let toolChainFile = path.join(ndkHome, "build/cmake/ohos.toolchain.cmake");
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(toolChainFile),
            "-DOHOS_PLATFORM=OHOS",
        ];
        switch (arch) {
            case "arm64":
                args.push("-DOHOS_ARCH=arm64-v8a");
                break;
            case "x64":
                args.push("-DOHOS_ARCH=x86_64");
                break;
            case "arm":
                args.push("-DOHOS_ARCH=armeabi-v7a");
                break;    
        }
        return args;
    }

    copyLibraries(libraries, outPath, arch, keepSymbols) {
        let outputs = [];
        for (let libraryFile of libraries) {
            if (!keepSymbols) {
                // some platforms generate debug symbols by default, strip them.
                this.libraryTool.stripDebugSymbols(libraryFile, arch);
            }
            let libraryName = path.basename(libraryFile);
            let output = path.join(outPath, arch, libraryName);
            outputs.push(output);
            Utils.copyPath(libraryFile, output);
        }
        return outputs;
    }
}

module.exports = CMake;
