const fs = require("fs");
const path = require("path");
const Utils = require("./Utils");

const STATIC_EXTENSIONS = [".a", ".lib"];
const SHARED_EXTENSIONS = [".so", ".dylib", ".dll"];
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
        return new LibraryTool(platform);
    }

    constructor(platform) {
        this.platform = platform;
    }

    static findLibraries(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return findFiles(dir, LIBRARY_EXTENSIONS);
    }

    static findFrameworks(dir) {
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
                list.push(filePath);
            } else {
                list = list.concat(LibraryTool.findFrameworks(filePath));
            }
        }
        return list;
    }

    static isStaticLibrary(libraryFile) {
        let ext = path.extname(libraryFile);
        return STATIC_EXTENSIONS.indexOf(ext) !== -1;
    }

    static findStaticLibraries(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return findFiles(dir, STATIC_EXTENSIONS);
    }

    static findSharedLibraries(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return findFiles(dir, SHARED_EXTENSIONS);
    }

    copyLibraries(libraries, outPath) {
        for (let arch of this.platform.archs) {
            let libraryFiles = libraries[arch];
            for (let libraryFile of libraryFiles) {
                let libraryName = path.basename(libraryFile);
                Utils.copyPath(libraryFile, path.join(outPath, arch, libraryName));
            }
        }
    }

    mergeLibraries(libraries, output, arch) {
    }

    createXCFramework(libraryPath) {
        return false;
    }
}

class ARMergeLibraryTool extends LibraryTool {
    extractStaticLibrary(ar, dir, library, verbose) {
        let libraryName = library.substring(library.lastIndexOf("/"), library.lastIndexOf("."));
        let libraryDir = path.join(dir, libraryName);
        Utils.createDirectory(libraryDir);
        if (verbose) {
            Utils.log("cd " + libraryDir);
        }
        // Extracts all object files
        let cmd = ar + " x " + Utils.escapeSpace(library);
        if (verbose) {
            Utils.log(cmd);
        }
        Utils.exec(cmd, libraryDir, !verbose);
        // Does have duplicate object file
        let listFileName = "_objectFileList";
        cmd = ar + " t " + Utils.escapeSpace(library) + " > " + listFileName;
        if (verbose) {
            Utils.log(cmd);
        }
        Utils.exec(cmd, libraryDir, !verbose);
        let objectFileList = Utils.readFile(path.join(libraryDir, listFileName)).split("\n");
        objectFileList = objectFileList.filter(file => file !== "");
        let objectFileSet = [...new Set(objectFileList)];
        if (objectFileSet.length === objectFileList.length) {
            return;
        }
        let counter = {};
        for (let objectFile of objectFileList) {
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
                cmd = cmd + " && mv " + objectFile + " " + i + "." + objectFile;
                if (verbose) {
                    Utils.log(cmd);
                }
                Utils.exec(cmd, libraryDir, !verbose);
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
        ar = Utils.escapeSpace(ar);
        for (let library of libraries) {
            this.extractStaticLibrary(ar, tempDir, library, verbose);
        }
        Utils.deletePath(output);
        let cmd = ar + " rc " + Utils.escapeSpace(output) + " */*.o";
        if (verbose) {
            Utils.log(cmd);
        }
        Utils.exec(cmd, tempDir, !verbose);
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
        if (this.platform.verbose) {
            Utils.log(cmd);
        }
        Utils.exec(cmd, process.cwd(), true);
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
            Utils.exec("lipo -create " + libraryPaths.join(" ") + " -o " + Utils.escapeSpace(outputFile), outPath, !this.platform.verbose);
        }
        if (removeOrigins) {
            for (let library of libraries) {
                Utils.deletePath(library);
                Utils.deleteEmptyDir(path.dirname(library));
            }
        }
        return true;
    }

    createXCFramework(libraryPath, outPath, removeOrigins, filter) {
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
        let libraries = LibraryTool.findLibraries(firstArchPath);
        let frameworks = LibraryTool.findFrameworks(firstArchPath);
        libraries = libraries.concat(frameworks);
        for (let library of libraries) {
            if (filter && !filter(library)) {
                continue;
            }
            let libraryName = path.basename(library);
            let fatLibraries = [];
            for (let key of archKeys) {
                let libraryFiles = [];
                for (let arch of archMap[key]) {
                    libraryFiles.push(path.join(libraryPath, arch, libraryName));
                }
                if (libraryFiles.length == 0) {
                    continue;
                }
                let fatLibrary = path.join(libraryPath, key + "-fat", libraryName);
                this.createFatLibrary(libraryFiles, fatLibrary, removeOrigins);
                fatLibraries.push(fatLibrary);
            }
            let commandKey = " -library ";
            if (libraryName.toLowerCase().endsWith(".framework")) {
                commandKey = " -framework ";
            }
            let libraryInput = "";
            for (let fatLibrary of fatLibraries) {
                libraryInput += commandKey + Utils.escapeSpace(fatLibrary);
            }
            let outputFile = path.join(outPath, path.parse(library).name + ".xcframework");
            Utils.deletePath(outputFile);
            Utils.createDirectory(outputFile);
            Utils.exec("xcodebuild -create-xcframework" + libraryInput +
                " -output " + Utils.escapeSpace(outputFile), outPath, !this.platform.verbose);
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
        for (let arch of this.platform.archs) {
            if (arch === "arm" || arch === "arm64") {
                iosArchs.push(arch);
            } else {
                simulatorArchs.push(arch);
            }
        }
        map["ios"] = iosArchs;
        map["simulator"] = simulatorArchs;
        return map;
    }
}

class MacLibraryTool extends AppleLibraryTool {
    getXCFrameworkArchs() {
        let map = {};
        map["mac"] = this.platform.archs;
        return map;
    }
}

class AndroidLibraryTool extends ARMergeLibraryTool {
    copyLibraries(libraries, outPath) {
        for (let arch of this.platform.archs) {
            let libraryFiles = libraries[arch];
            for (let libraryFile of libraryFiles) {
                if (!this.platform.debug) {
                    this.stripDebugSymbols(libraryFile, arch);
                }
                let libraryName = path.basename(libraryFile);
                Utils.copyPath(libraryFile, path.join(outPath, arch, libraryName));
            }
        }
    }

    stripDebugSymbols(library, arch) {
        let strip = this.platform.getCommandPath("strip", arch);
        let cmd = Utils.escapeSpace(strip) + " -g -S -d --strip-debug " + Utils.escapeSpace(library);
        Utils.exec(cmd, process.cwd(), !this.platform.verbose);
    }
}

class WinLibraryTool extends LibraryTool {
    mergeLibraries(libraries, output, arch) {
        let libTool = this.platform.getCommandPath("lib", arch);
        let outputDir = path.dirname(output);
        let libDir = path.join(outputDir, "lib");
        Utils.createDirectory(libDir);
        let index = 0;
        let list = [];
        let realList = [];
        for (let library of libraries) {
            list.push(Utils.escapeSpace(library));
            let tempLibrary = path.join(libDir, index + ".lib");
            Utils.copyPath(library, tempLibrary);
            realList.push(path.join("lib", index + ".lib"));
            index++;
        }
        let cmd = Utils.escapeSpace(libTool) + " /out:" + Utils.escapeSpace(output) + " " + list.join(" ");
        let realCmd = Utils.escapeSpace(libTool) + " /out:" + path.basename(output) + " " + realList.join(" ");
        if (this.platform.verbose) {
            Utils.log(cmd);
        }
        Utils.exec(realCmd, outputDir, true);
        Utils.deletePath(libDir);
    }
}

class WebLibraryTool extends ARMergeLibraryTool {
}

module.exports = LibraryTool;
