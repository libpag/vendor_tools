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
        return findFiles(dir, LIBRARY_EXTENSIONS);
    }

    static findStaticLibraries(dir) {
        return findFiles(dir, STATIC_EXTENSIONS);
    }

    static findSharedLibraries(dir) {
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

    createXCFramework(libraries, output) {
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

    createFatLibrary(libraries, output) {
        if (libraries.length === 0) {
            return false;
        }
        if (libraries.length === 1) {
            Utils.copyPath(libraries[0], output);
        } else {
            let outPath = path.dirname(output);
            Utils.createDirectory(outPath);
            let libraryPaths = [];
            for (let library of libraries) {
                libraryPaths.push(Utils.escapeSpace(library));
            }
            Utils.exec("lipo -create " + libraryPaths.join(" ") + " -o " + Utils.escapeSpace(output), outPath, !this.platform.verbose);
        }
        for (let library of libraries) {
            Utils.deletePath(library);
            Utils.deleteEmptyDir(path.dirname(library));
        }
        return true;
    }

}

class IOSLibraryTool extends AppleLibraryTool {
    createXCFramework(libraries, output) {
        let iosLibraries = [];
        let simulatorLibraries = [];
        let library = "";
        for (let arch of this.platform.archs) {
            library = libraries[arch];
            if (arch === "arm" || arch === "arm64") {
                iosLibraries.push(library);
            } else {
                simulatorLibraries.push(library);
            }
        }
        if (iosLibraries.length === 0 && simulatorLibraries.length === 0) {
            return false;
        }

        let libraryName = path.basename(library);
        let libraryDir = path.dirname(library);
        let iosFatLibrary = path.join(path.dirname(libraryDir), "ios", libraryName);
        this.createFatLibrary(iosLibraries, iosFatLibrary);
        let simulatorFatLibrary = path.join(path.dirname(libraryDir), "simulator", libraryName);
        this.createFatLibrary(simulatorLibraries, simulatorFatLibrary);
        let outPath = path.dirname(output);
        Utils.createDirectory(outPath);
        let libraryInput = "";
        if (iosLibraries.length > 0) {
            libraryInput += " -library " + Utils.escapeSpace(iosFatLibrary);
        }
        if (simulatorLibraries.length > 0) {
            libraryInput += " -library " + Utils.escapeSpace(simulatorFatLibrary);
        }
        Utils.exec("xcodebuild -create-xcframework" + libraryInput +
            " -output " + Utils.escapeSpace(output), outPath, !this.platform.verbose);
        Utils.deletePath(path.dirname(iosFatLibrary));
        Utils.deletePath(path.dirname(simulatorFatLibrary));
        return true;
    }
}

class MacLibraryTool extends AppleLibraryTool {
    createXCFramework(libraries, output) {
        let libraryList = [];
        let library = "";
        for (let arch of this.platform.archs) {
            library = libraries[arch];
            libraryList.push(library);
        }
        if (libraryList.length === 0) {
            return false;
        }
        let libraryName = path.basename(library);
        let libraryDir = path.dirname(library);
        let fatLibrary = path.join(path.dirname(libraryDir), "mac", libraryName);
        this.createFatLibrary(libraryList, fatLibrary);

        let outPath = path.dirname(output);
        Utils.createDirectory(outPath);
        Utils.exec("xcodebuild -create-xcframework -library " + Utils.escapeSpace(fatLibrary) +
            " -output " + Utils.escapeSpace(output), outPath, !this.platform.verbose);
        Utils.deletePath(path.dirname(fatLibrary));
        return true;
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
        let list = [];
        for (let library of libraries) {
            list.push(Utils.escapeSpace(library));
        }
        let cmd = Utils.escapeSpace(libTool) + " /out:" + Utils.escapeSpace(output) + " " + list.join(" ");
        if (this.platform.verbose) {
            Utils.log(cmd);
        }
        Utils.exec(cmd, process.cwd(), true);
    }
}

class WebLibraryTool extends ARMergeLibraryTool {
}

module.exports = LibraryTool;
