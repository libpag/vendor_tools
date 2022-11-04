const fs = require('fs');
const path = require("path");
const Utils = require("./Utils");
const LibraryTool = require("./LibraryTool");

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

function transformCMakeLists(configFile, platform) {
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
        return new CMake(platform);
    }

    constructor(platform) {
        this.platform = platform;
    }

    build(sourcePath, outPath, options) {
        outPath = path.join(outPath, this.platform.name);
        let buildPath = path.join(outPath, "build");
        if (!options.incremental) {
            Utils.deletePath(buildPath);
        }
        if (!fs.existsSync(buildPath)) {
            Utils.createDirectory(buildPath);
        }
        let cmakeConfigFile = path.resolve(sourcePath, "CMakeLists.txt");
        let oldCMakeConfig = transformCMakeLists(cmakeConfigFile, this.platform.name);
        let libraries = {};
        let archs = this.platform.archs;
        for (let arch of archs) {
            let cmakeArgs = this.getCMakeArgs(options.arguments, options.deps, sourcePath, arch);
            let archBuildPath = path.join(buildPath, arch);
            libraries[arch] = this.buildArch(sourcePath, archBuildPath, arch, options.targets, cmakeArgs);
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

    buildArch(sourcePath, buildPath, arch, targets, cmakeArgs) {
        let buildType = this.platform.buildType;
        Utils.log("Building the '" + arch + "' arch of [" + targets.join(", ") + "]:");
        if (!fs.existsSync(buildPath)) {
            Utils.createDirectory(buildPath);
        }
        Utils.log("cd " + buildPath);
        let verbose = this.platform.verbose;
        let verboseArg = verbose ? " -DCMAKE_VERBOSE_MAKEFILE=ON" : "";
        let cmake = this.getCMake(arch);
        let cmd = cmake + " -G Ninja -DCMAKE_BUILD_TYPE=" + buildType + verboseArg + " " +
            cmakeArgs.join(" ") + " " + Utils.escapeSpace(sourcePath);
        Utils.log(cmd);
        Utils.exec(cmd, buildPath, !verbose);
        let ninja = this.getNinja(arch);
        let libraries = [];
        for (let target of targets) {
            cmd = ninja + " " + target;
            Utils.log(cmd);
            Utils.exec(cmd, buildPath, !verbose);
            let found = this.findLibrary(target, buildPath, libraries);
            if (!found) {
                Utils.error("Could not find the library file matches '" + target + "'!");
                process.exit(1);
            }
        }
        return libraries;
    }

    getCMake(arch) {
        let cmake = this.platform.getCommandPath("cmake");
        return Utils.escapeSpace(cmake);
    }

    getNinja(arch) {
        let ninja = this.platform.getCommandPath("ninja");
        return Utils.escapeSpace(ninja);
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
                libraries = LibraryTool.findLibraries(libraryPath);
            } else {
                libraries = LibraryTool.findLibraries(path.join(depVendor.out, this.platform.name));
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

    findLibrary(target, dir, result) {
        let libraries = LibraryTool.findLibraries(dir);
        let found = false;
        for (let library of libraries) {
            let fileName = path.parse(library).name;
            if (fileName.endsWith(target) && result.indexOf(library) === -1) {
                result.push(library);
                found = true;
                // windows 平台若编译动态库，会产生两个新文件。
                if (this.platform.name !== "win") {
                    return true;
                }
            }
        }
        if (found) {
            return true;
        }
        // 可能是配置里设置了重命名，如果没匹配到，默认返回第一个发现的库文件。
        for (let library of libraries) {
            if (result.indexOf(library) === -1) {
                result.push(library);
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
        let abi = arch === "arm" ? "armeabi-v7a" : "arm64-v8a";
        return [
            "-DCMAKE_TOOLCHAIN_FILE=" + path.join(ndkHome, "build/cmake/android.toolchain.cmake"),
            "-DANDROID_PLATFORM=android-18",
            "-DANDROID_NDK=" + ndkHome,
            "-DANDROID_ABI=" + abi
        ];
    }
}

class IOSCMake extends CMake {
    constructor(platform) {
        super(platform);
        this.toolchain = path.resolve(__dirname, "ios.toolchain.cmake");
    }

    getPlatformArgs(arch) {
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + this.toolchain,
            "-DDEPLOYMENT_TARGET=9.0",
            "-DENABLE_ARC=FALSE"
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

class WinCMake extends CMake {
    getCMake(arch) {
        let cmake = super.getCMake(arch);
        return this.platform.prependVCVars(Utils.escapeSpace(cmake), arch);
    }

    getNinja(arch) {
        let ninja = super.getNinja(arch);
        return this.platform.prependVCVars(Utils.escapeSpace(ninja), arch);
    }

    getPlatformArgs(arch) {
        return [
            "-DCMAKE_C_FLAGS_RELEASE=/Zc:inline",
            "-DCMAKE_PROJECT_INCLUDE=" + path.resolve(__dirname, "win.msvc.cmake"),
            "-DCMAKE_PROJECT_skcms_INCLUDE_BEFORE=" + path.resolve(__dirname, "skcms.clang.cmake")
        ];
    }
}

class MacCMake extends CMake {
    constructor(platform) {
        super(platform);
        this.toolchain = path.resolve(__dirname, "ios.toolchain.cmake");
    }

    getPlatformArgs(arch) {
        let args = [
            "-DCMAKE_TOOLCHAIN_FILE=" + this.toolchain,
            "-DCMAKE_OSX_DEPLOYMENT_TARGET=10.13",
            "-DENABLE_BITCODE=FALSE",
            "-DENABLE_VISIBILITY=TRUE",
            "-DENABLE_ARC=FALSE"
        ];
        if (arch === "x64") {
            args.push("-DPLATFORM=MAC");
        } else if (arch === "arm64") {
            args.push("-DPLATFORM=MAC_ARM64");
        }
        return args;
    }
}

class WebCMake extends CMake {
    getCMake(arch) {
        let cmake = super.getCMake(arch);
        return cmake + " cmake";
    }
}

module.exports = CMake;
