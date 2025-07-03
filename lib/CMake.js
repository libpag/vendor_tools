const fs = require('fs');
const path = require("path");
const os = require("os");
const {performance} = require('perf_hooks');
const Utils = require("./Utils");
const LibraryTool = require("./LibraryTool");
const SystemCheck = require("./SystemCheck");

function GetNumberOfJobs() {
    // Allow override via environment variable for debugging
    if (process.env.VENDOR_BUILD_JOBS) {
        const jobs = parseInt(process.env.VENDOR_BUILD_JOBS, 10);
        if (jobs > 0) {
            Utils.log(`[BUILD] Using custom job count from VENDOR_BUILD_JOBS: ${jobs}`);
            return jobs;
        }
    }
    
    const cpuCount = os.cpus().length;
    const memoryGB = os.totalmem() / (1024 * 1024 * 1024);
    
    let jobs;
    
    // More conservative job calculation
    if (cpuCount <= 2) {
        jobs = 1; // Single job for low-end systems
    } else if (cpuCount <= 4) {
        jobs = Math.max(1, cpuCount - 1); // Leave one core free
    } else if (memoryGB < 8) {
        jobs = Math.max(2, Math.floor(cpuCount * 0.5)); // Use half cores if low memory
    } else {
        jobs = Math.max(2, Math.min(cpuCount, Math.floor(cpuCount * 0.75))); // Use 75% of cores max
    }
    
    // Cap at reasonable maximum to avoid resource exhaustion
    jobs = Math.min(jobs, 16);
    
    Utils.log(`[BUILD] Auto-detected build jobs: ${jobs} (CPUs: ${cpuCount}, Memory: ${memoryGB.toFixed(1)}GB)`);
    return jobs;
}

function EscapePath(filePath) {
    return Utils.escapeSpace(filePath.split("\\").join("/"));
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
    if (configText.indexOf("install(") !== -1 || configText.indexOf("INSTALL(") !== -1
        || configText.indexOf("export(") !== -1 || configText.indexOf("EXPORT(") !== -1) {
        // disable all install()
        const macro = "macro (install)\nendmacro ()\n macro (export)\nendmacro ()\n";
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
                let tailText = configText.substring(index + 1);
                configText = configText.substring(0, index + 1);
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

function CreateFindMoudles(deps, platform, arch, modulePath) {
    let keys = Object.keys(deps);
    for (let key of keys) {
        let depVendor = deps[key];
        let moduleText = "set(" + key + "_FOUND TRUE)";
        let includeDir = path.join(depVendor.out, platform, "include");
        if (!fs.existsSync(includeDir)) {
            includeDir = depVendor.source;
        }
        moduleText += "\nset(" + key + "_INCLUDE_DIRS " + EscapePath(includeDir) + ")";
        moduleText += "\nset(" + key + "_INCLUDE_DIR \"${" + key + "_INCLUDE_DIRS}\")";
        let libraryPath = path.join(depVendor.out, platform, arch);
        let libraries = [];
        if (fs.existsSync(libraryPath)) {
            libraries = LibraryTool.FindLibraries(libraryPath);
        } else {
            libraries = LibraryTool.FindLibraries(path.join(depVendor.out, platform));
        }
        if (libraries.length > 0) {
            moduleText += "\nset(" + key + "_LIBRARIES " + EscapePath(libraries.join(";")) + ")";
            moduleText += "\nset(" + key + "_LIBRARY \"${" + key + "_LIBRARIES}\")";
        }
        let targetName = key + "::" + key;
        moduleText += "\nadd_library(" + targetName + " INTERFACE IMPORTED)";
        moduleText += "\nset_target_properties(" + targetName + " PROPERTIES INTERFACE_INCLUDE_DIRECTORIES \"${" + key + "_INCLUDE_DIRS}\")";
        moduleText += "\nset_target_properties(" + targetName + " PROPERTIES IMPORTED_LOCATION \"${" + key + "_LIBRARY}\")";
        let moduleFile = path.join(modulePath, "Find" + key + ".cmake");
        Utils.writeFile(moduleFile, moduleText);
    }
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
        
        // Run system checks before building
        try {
            SystemCheck.checkBuildEnvironment(buildPath, this.platform);
        } catch (checkError) {
            Utils.error(`[BUILD] System check failed: ${checkError.message}`);
            Utils.error(`[BUILD] Please resolve the issues above before building`);
            process.exit(1);
        }
        
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
            let archBuildPath = path.join(buildPath, arch);
            let cmakeArgs = this.getCMakeArgs(options.arguments, options.deps, archBuildPath, arch);
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
        const buildStartTime = performance.now();
        Utils.log("Building the '" + arch + "' arch of [" + targets.join(", ") + "]:");
        Utils.log(`[BUILD] Build type: ${buildType}`);
        Utils.log(`[BUILD] Source path: ${sourcePath}`);
        Utils.log(`[BUILD] Build path: ${buildPath}`);
        Utils.log(`[BUILD] Using native generator: ${useNativeGenerator}`);
        Utils.log(`[BUILD] CMake args: ${cmakeArgs.join(" ")}`);
        
        if (!fs.existsSync(buildPath)) {
            Utils.log(`[BUILD] Creating build directory: ${buildPath}`);
            Utils.createDirectory(buildPath);
        } else {
            Utils.log(`[BUILD] Build directory already exists: ${buildPath}`);
        }
        
        Utils.log("cd " + buildPath);
        let verbose = this.platform.verbose;
        let verboseArg = verbose ? " -DCMAKE_VERBOSE_MAKEFILE=ON" : "";
        let cmake = this.getCMake(arch);
        let generator = !useNativeGenerator ? "-G Ninja" : this.getNativeGenerator();
        
        // CMake configuration phase
        let cmd = cmake + " " + generator + " -DCMAKE_BUILD_TYPE=" + buildType + verboseArg + " " +
            cmakeArgs.join(" ") + " " + EscapePath(sourcePath);
        
        Utils.log(`[BUILD] Starting CMake configuration phase`);
        const configStartTime = performance.now();
        Utils.exec(cmd, buildPath, verbose);
        const configDuration = performance.now() - configStartTime;
        Utils.log(`[BUILD] CMake configuration completed in ${Utils.formatTime(configDuration)}`);
        
        let libraries = [];
        for (let target of targets) {
            const targetStartTime = performance.now();
            Utils.log(`[BUILD] Starting build for target: ${target}`);
            
            let cmd = "";
            if (useNativeGenerator) {
                cmd = this.getNativeBuildCommand(target, arch, buildType);
            } else {
                let ninja = this.platform.getCommandPath("ninja", arch);
                cmd = ninja + " " + target;
            }
            
            Utils.log(`[BUILD] Build command: ${cmd}`);
            
            // Check available disk space before building
            try {
                const stats = fs.statSync(buildPath);
                Utils.log(`[BUILD] Build directory is accessible`);
            } catch (err) {
                Utils.error(`[BUILD] Build directory issue: ${err.message}`);
                throw err;
            }
            
            // Use retry mechanism for build commands as they are prone to transient failures
            try {
                Utils.execWithRetry(cmd, buildPath, verbose, true, 3);
            } catch (buildError) {
                Utils.error(`[BUILD] Build failed for target ${target} after retries`);
                Utils.error(`[BUILD] Consider reducing parallel jobs by setting VENDOR_BUILD_JOBS=1`);
                throw buildError;
            }
            
            const targetDuration = performance.now() - targetStartTime;
            Utils.log(`[BUILD] Target ${target} built successfully in ${Utils.formatTime(targetDuration)}`);
            
            // Find target file phase
            Utils.log(`[BUILD] Searching for target file: ${target}`);
            let targetFile = "";
            if (useNativeGenerator) {
                targetFile = this.findNativeTargetFile(target, buildPath, arch, buildType);
                Utils.log(`[BUILD] Using native generator, searched for: ${target}`);
            } else {
                targetFile = this.findNinjaTargetFile(target, buildPath, arch, buildType);
                Utils.log(`[BUILD] Using Ninja generator, searched for: ${target}`);
            }
            
            if (!targetFile) {
                Utils.log(`[BUILD] Primary search failed, trying fallback method`);
                targetFile = this.findTargetFileFallback(target, buildPath);
            }
            
            if (!targetFile) {
                Utils.error(`[BUILD] Could not find the library file matches '${target}'!`);
                Utils.error(`[BUILD] Searched in build path: ${buildPath}`);
                Utils.error(`[BUILD] Architecture: ${arch}`);
                Utils.error(`[BUILD] Build type: ${buildType}`);
                
                // List files in build directory for debugging
                try {
                    const files = Utils.findFiles(buildPath);
                    Utils.error(`[BUILD] Files found in build directory (first 20):`);
                    files.slice(0, 20).forEach(file => {
                        Utils.error(`[BUILD]   ${path.relative(buildPath, file)}`);
                    });
                    if (files.length > 20) {
                        Utils.error(`[BUILD]   ... and ${files.length - 20} more files`);
                    }
                } catch (listErr) {
                    Utils.error(`[BUILD] Could not list build directory: ${listErr.message}`);
                }
                
                process.exit(1);
            }
            
            Utils.log(`[BUILD] Found target file: ${targetFile}`);
            libraries.push(targetFile);
            
            // Handle additional files (Windows .lib/.dll/.pdb, Web .wasm/.js)
            if (this.platform.name === "win") {
                const additionalFiles = [];
                FindSameNameTargets(targetFile, [".lib", ".dll", ".pdb"], additionalFiles);
                if (additionalFiles.length > 0) {
                    Utils.log(`[BUILD] Found additional Windows files: ${additionalFiles.length}`);
                    libraries = libraries.concat(additionalFiles);
                }
            } else if (path.extname(targetFile) === ".js" || path.extname(targetFile) === ".wasm") {
                const additionalFiles = [];
                FindSameNameTargets(targetFile, [".wasm", ".js"], additionalFiles);
                if (additionalFiles.length > 0) {
                    Utils.log(`[BUILD] Found additional Web files: ${additionalFiles.length}`);
                    libraries = libraries.concat(additionalFiles);
                }
            }
        }
        
        const totalBuildDuration = performance.now() - buildStartTime;
        Utils.log(`[BUILD] All targets completed successfully in ${Utils.formatTime(totalBuildDuration)}`);
        Utils.log(`[BUILD] Generated ${libraries.length} library files`);
        
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

    getCMakeArgs(args, deps, buildPath, arch) {
        let cmakeArgs = this.getPlatformArgs(arch);
        if (args) {
            cmakeArgs = cmakeArgs.concat(args);
            cmakeArgs = this.mergeCMakeFlags(cmakeArgs);
        }
        if (deps) {
            let modulePath = path.resolve(buildPath, "cmake/Modules");
            modulePath = modulePath.split("\\").join("/");
            CreateFindMoudles(deps, this.platform.name, arch, modulePath);
            cmakeArgs.push("-DCMAKE_MODULE_PATH=" + EscapePath(modulePath));
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
            "-DCMAKE_TOOLCHAIN_FILE=" + EscapePath(toolChainFile),
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
            "-DCMAKE_TOOLCHAIN_FILE=" + EscapePath(this.toolchain)
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
            "-DCMAKE_TOOLCHAIN_FILE=" + EscapePath(this.toolchain)
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
            "-DCMAKE_TOOLCHAIN_FILE=" + EscapePath(toolChainFile),
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
