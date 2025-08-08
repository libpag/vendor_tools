const fs = require("fs");
const os = require("os");
const path = require("path");
const Utils = require("./Utils");

const STATIC_EXTENSIONS = [".a", ".lib"];
const SHARED_EXTENSIONS = [".so", ".dylib", ".dll", ".wasm"];
const LIBRARY_EXTENSIONS = STATIC_EXTENSIONS.concat(SHARED_EXTENSIONS);

function findFiles(dir, extensions) {
    let list = [];
    let files = fs.readdirSync(dir);
    for (let fileName of files) {
        let filePath = path.join(dir, fileName);
        if (fs.statSync(filePath).isDirectory()) {
            list = list.concat(findFiles(filePath, extensions));
        } else {
            let ext = path.extname(fileName);
            if (extensions.indexOf(ext) !== -1) {
                list.push(filePath);
            }
        }
    }
    return list;
}

class LibraryTool {
    static Create(platform) {
        if (platform.name === "ios") {
            return new IOSLibraryTool(platform);
        }
        if (platform.name === "mac") {
            return new MacLibraryTool(platform);
        }
        if (platform.name === "android") {
            return new AndroidLibraryTool(platform);
        }
        if (platform.name === "win") {
            return new WinLibraryTool(platform);
        }
        if (platform.name === "web") {
            return new WebLibraryTool(platform);
        }
        if (platform.name === "linux") {
            return new ARMergeLibraryTool(platform);
        }
        if (platform.name === "ohos") {
            return new OhosLibraryTool(platform);
        }
        return new LibraryTool(platform);
    }

    constructor(platform) {
        this.platform = platform;
    }

    static FindLibraries(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return findFiles(dir, LIBRARY_EXTENSIONS);
    }

    static FindFrameworks(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        let list = [];
        let files = fs.readdirSync(dir);
        for (let fileName of files) {
            let filePath = path.join(dir, fileName);
            if (!fs.statSync(filePath).isDirectory()) {
                continue;
            }
            if (fileName.toLowerCase().endsWith(".framework")) {
                let libraryName = path.parse(fileName).name;
                if (fs.existsSync(path.join(filePath, libraryName))) {
                    list.push(filePath);
                }
            } else {
                list = list.concat(LibraryTool.FindFrameworks(filePath));
            }
        }
        return list;
    }

    static IsStaticLibrary(libraryFile) {
        let ext = path.extname(libraryFile);
        return STATIC_EXTENSIONS.indexOf(ext) !== -1;
    }

    static FindStaticLibraries(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return findFiles(dir, STATIC_EXTENSIONS);
    }

    static FindSharedLibraries(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return findFiles(dir, SHARED_EXTENSIONS);
    }

    stripDebugSymbols(library, arch) {
    }

    mergeLibraries(libraries, output, arch) {
    }

    createXCFramework(libraryPath, headerPath, outPath, removeOrigins, filter) {
        return false;
    }
}

class ARMergeLibraryTool extends LibraryTool {
    extractStaticLibrary(ar, dir, library, verbose) {
        let libraryName = path.parse(library).name;
        let libraryDir = path.join(dir, libraryName);
        Utils.createDirectory(libraryDir);
        if (verbose) {
            Utils.log("cd " + libraryDir);
        }
        // Extracts all object files
        let cmd = ar + " x " + Utils.escapeSpace(library);
        Utils.exec(cmd, libraryDir, verbose);
        // Does have duplicate object file
        let listFileName = "_objectFileList";
        cmd = ar + " t " + Utils.escapeSpace(library) + " > " + listFileName;
        Utils.exec(cmd, libraryDir, verbose);
        let objectFileList = Utils.readFile(path.join(libraryDir, listFileName)).split("\n");
        objectFileList = objectFileList.filter(file => file !== "");
        let objectFileSet = [...new Set(objectFileList)];
        if (objectFileSet.length === objectFileList.length) {
            return;
        }
        let counter = {};
        for (let objectFile of objectFileList) {
            objectFile = objectFile.trim();
            if (objectFile in counter) {
                counter[objectFile] = counter[objectFile] + 1;
            } else {
                counter[objectFile] = 1;
            }
        }
        // Extracts duplicate object files and rename
        for (let objectFile in counter) {
            let count = counter[objectFile];
            if (count === 1) {
                continue;
            }
            Utils.deletePath(path.join(libraryDir, objectFile));
            for (let i = 1; i < count + 1; i++) {
                cmd = ar + " xN " + i + " " + Utils.escapeSpace(library) + " " + objectFile;
                Utils.exec(cmd, libraryDir, verbose);
                fs.renameSync(path.join(libraryDir, objectFile), path.join(libraryDir, i + "." + objectFile));
            }
        }
    }

    mergeLibraries(libraries, output, arch) {
        let tempDir = path.dirname(output);
        tempDir = path.join(tempDir, "temp");
        Utils.createDirectory(tempDir);
        let verbose = this.platform.verbose;
        if (verbose) {
            Utils.log("cd " + tempDir);
        }
        let ar = this.platform.getCommandPath("ar", arch);
        if (os.platform() !== "win32") {
            for (let library of libraries) {
                this.extractStaticLibrary(ar, tempDir, library, verbose);
            }
            Utils.deletePath(output);
            let cmd = ar + " rc " + Utils.escapeSpace(output) + " */*.o";
            Utils.exec(cmd, tempDir, verbose);
            Utils.deletePath(tempDir);
            return;
        }
        let tempOutput = path.join(tempDir, path.basename(output));
        for (let library of libraries) {
            this.extractStaticLibrary(ar, tempDir, library, verbose);
            let libraryDir = path.join(tempDir, path.parse(library).name);
            let files = Utils.findFiles(libraryDir);
            let objects = [];
            for (let file of files) {
                let ext = path.extname(file);
                if (ext !== ".o") {
                    continue;
                }
                objects.push(file.substring(libraryDir.length + 1));
            }
            if (objects.length > 0) {
                let cmd = ar + " rc " + Utils.escapeSpace(tempOutput) + " " + objects.join(" ");
                Utils.exec(cmd, libraryDir, verbose);
            }
        }
        Utils.deletePath(output);
        fs.renameSync(tempOutput, output);
        Utils.deletePath(tempDir);
    }
}

class AppleLibraryTool extends LibraryTool {
    mergeLibraries(libraries, output, arch) {
        let list = [];
        for (let library of libraries) {
            list.push(Utils.escapeSpace(library));
        }
        let cmd = "libtool -static " + list.join(" ") + " -o " + Utils.escapeSpace(output);
        Utils.exec(cmd, process.cwd(), this.platform.verbose);
    }

    stripDebugSymbols(library, arch) {
        if (!fs.existsSync(library)) {
            return;
        }
        if (fs.statSync(library).isDirectory() && library.toLowerCase().endsWith(".framework")) {
            let libraryName = path.parse(library).name;
            library = path.join(library, libraryName);
        }
        let cmd = "strip -S " + Utils.escapeSpace(library);
        Utils.exec(cmd, process.cwd(), this.platform.verbose);
    }

    stripAndGenerateSymbolFile(library, arch) {
        if (!fs.existsSync(library) || LibraryTool.IsStaticLibrary(library)) {
            return false;
        }
        let isFramework = fs.statSync(library).isDirectory() && library.toLowerCase().endsWith(".framework");
        let symbolFile = library + ".dSYM";
        if (isFramework) {
            let libraryName = path.parse(library).name;
            library = path.join(library, libraryName);
            let cmd = "file " + Utils.escapeSpace(library);
            let output = Utils.execSafe(cmd, process.cwd());
            if (output.indexOf("dynamically linked shared library") === -1) {
                return false;
            }
        }
        Utils.createDirectory(path.dirname(symbolFile));
        Utils.exec("dsymutil " + library + " -o " + symbolFile, process.cwd(), this.platform.verbose);
        let cmd = "strip -x " + Utils.escapeSpace(library);
        Utils.exec(cmd, process.cwd(), this.platform.verbose);
        return true;
    }


    createFatLibrary(libraries, output, removeOrigins) {
        if (libraries.length === 0) {
            return false;
        }
        let firstLibrary = libraries[0];
        Utils.copyPath(firstLibrary, output);
        if (libraries.length > 1) {
            let isFramework = (firstLibrary.toLowerCase().endsWith(".framework"));
            let libraryPaths = [];
            for (let library of libraries) {
                if (isFramework) {
                    let libraryName = path.parse(library).name;
                    library = path.join(library, libraryName);
                }
                libraryPaths.push(Utils.escapeSpace(library));
            }
            let outputFile = output;
            if (isFramework) {
                let libraryName = path.parse(output).name;
                outputFile = path.join(output, libraryName);
            }
            let outPath = path.dirname(output);
            let cmd = "lipo -create " + libraryPaths.join(" ") + " -o " + Utils.escapeSpace(outputFile);
            Utils.exec(cmd, outPath, this.platform.verbose);
        }
        if (removeOrigins) {
            for (let library of libraries) {
                Utils.deletePath(library);
                Utils.deleteEmptyDir(path.dirname(library));
            }
        }
        return true;
    }

    createXCFramework(libraryPath, headerPath, outPath, removeOrigins, filter) {
        if (!outPath) {
            outPath = libraryPath;
        }
        removeOrigins = !!removeOrigins;
        let archMap = this.getXCFrameworkArchs();
        let archKeys = Object.keys(archMap);
        let firstArch = archMap[archKeys[0]][0];
        if (!firstArch) {
            return false;
        }
        let firstArchPath = path.join(libraryPath, firstArch);
        let libraries = LibraryTool.FindLibraries(firstArchPath);
        let frameworks = LibraryTool.FindFrameworks(firstArchPath);
        libraries = libraries.concat(frameworks);
        for (let library of libraries) {
            if (filter && !filter(library)) {
                continue;
            }
            let libraryName = path.parse(library).name;
            let libraryFileName = path.basename(library);
            let isFramework = (library.toLowerCase().endsWith(".framework"));
            let fatLibraries = [];
            for (let key of archKeys) {
                let libraryFiles = [];
                for (let arch of archMap[key]) {
                    libraryFiles.push(path.join(libraryPath, arch, libraryFileName));
                }
                if (libraryFiles.length === 0) {
                    continue;
                }
                let fatLibrary = path.join(libraryPath, libraryName + "-" + key, libraryFileName);
                this.createFatLibrary(libraryFiles, fatLibrary, removeOrigins);
                fatLibraries.push(fatLibrary);
            }
            let commandKey = isFramework ? " -framework " : " -library ";
            let libraryInput = "";
            for (let fatLibrary of fatLibraries) {
                libraryInput += commandKey + Utils.escapeSpace(fatLibrary);
                if (!isFramework && !!headerPath) {
                    libraryInput += " -headers " + Utils.escapeSpace(headerPath);
                }
            }
            let outputFile = path.join(outPath, libraryName + ".xcframework");
            let symbolPath = path.join(outPath, libraryName + ".dSYMs");
            Utils.deletePath(outputFile);
            Utils.createDirectory(outputFile);
            Utils.deletePath(symbolPath);
            let cmd = "xcodebuild -create-xcframework" + libraryInput +
                " -output " + Utils.escapeSpace(outputFile);
            Utils.exec(cmd, outPath, this.platform.verbose);
            for (let fatLibrary of fatLibraries) {
                Utils.deletePath(path.dirname(fatLibrary));
            }
        }
    }

    getXCFrameworkArchs() {
        let map = {};
        map[this.platform.name] = this.platform.archs;
        return map;
    }

}

class IOSLibraryTool extends AppleLibraryTool {
    getXCFrameworkArchs() {
        let map = {};
        let iosArchs = [];
        let simulatorArchs = [];
        let simulatorArchNames = [];
        for (let arch of this.platform.archs) {
            if (arch === "arm" || arch === "arm64") {
                iosArchs.push(arch);
            } else {
                if (arch === "arm64-simulator") {
                    simulatorArchNames.push("arm64");
                } else {
                    simulatorArchNames.push(arch);
                }
                simulatorArchs.push(arch);
            }
        }
        if (iosArchs.length > 0) {
            let isoKey = "ios-" + iosArchs.join("_");
            map[isoKey] = iosArchs;
        }
        if (simulatorArchs.length > 0) {
            let simulatorKey = "ios-" + simulatorArchNames.join("_") + "-simulator";
            map[simulatorKey] = simulatorArchs;
        }
        return map;
    }
}

class MacLibraryTool extends AppleLibraryTool {
    getXCFrameworkArchs() {
        let map = {};
        let key = "macos-" + this.platform.archs.join("_");
        map[key] = this.platform.archs;
        return map;
    }
}

class AndroidLibraryTool extends ARMergeLibraryTool {
    stripDebugSymbols(library, arch) {
        let strip = this.platform.getCommandPath("strip", arch);
        let cmd = strip + " -S " + Utils.escapeSpace(library);
        Utils.exec(cmd, process.cwd(), this.platform.verbose);
    }

    stripAndGenerateSymbolFile(library, arch) {
        if (!fs.existsSync(library) || LibraryTool.IsStaticLibrary(library)) {
            return false;
        }
        Utils.copyPath(library, library + ".sym");
        let strip = this.platform.getCommandPath("strip", arch);
        let cmd = strip + " " + Utils.escapeSpace(library);
        Utils.exec(cmd, process.cwd(), this.platform.verbose);
        return true;
    }
}

class WinLibraryTool extends LibraryTool {
    mergeLibraries(libraries, output, arch) {
        let libTool = this.platform.getCommandPath("lib", arch);
        let list = [];
        for (let library of libraries) {
            list.push(Utils.escapeSpace(library));
        }
        let cmd = libTool + " /out:" + Utils.escapeSpace(output) + " " + list.join(" ");
        Utils.exec(cmd, process.cwd(), this.platform.verbose);
    }
}

class WebLibraryTool extends ARMergeLibraryTool {
}

class OhosLibraryTool extends AndroidLibraryTool {
}

module.exports = LibraryTool;
