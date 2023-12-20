const path = require("path");
const CMake = require("./CMake");
const Utils = require("./Utils");
const Platform = require("./Platform");
const LibraryTool = require("./LibraryTool");
const fs = require("fs");

function updateHash(vendor, platform) {
    if (vendor.hash) {
        return;
    }
    let sourcePath = vendor.source;
    let commitFile = path.join(sourcePath, ".git", "shallow");
    let repoCommit = Utils.readFile(commitFile).trim();
    let configText = platform.toolVersion() + repoCommit;
    if (vendor.deps) {
        let keys = Object.keys(vendor.deps);
        for (let key of keys) {
            let depVendor = vendor.deps[key];
            updateHash(depVendor, platform);
            configText += depVendor.hash;
        }
    }
    let script = vendor.script;
    if (script) {
        configText += Utils.readFile(script.file);
    } else {
        let cmake = vendor.cmake;
        configText += "targets:" + cmake.targets.join(",")
        if (cmake.arguments) {
            configText += "arguments:" + cmake.arguments.join(",");
        }
        if (cmake.includes) {
            configText += "includes:" + cmake.includes.join(",");
        }
    }
    vendor.hash = Utils.getHash(configText);
}

function parseVendors(data, projectPath, platform) {
    let vendorMap = {};
    if (!data.vendors || data.vendors.length === 0) {
        return vendorMap;
    }
    let sourceRoot = path.resolve(projectPath, data.source);
    let outRoot = path.resolve(projectPath, data.out);
    for (let vendor of data.vendors) {
        let item = {};
        item.name = vendor.name;
        item.dir = vendor.dir === undefined ? vendor.name : vendor.dir;
        item.source = path.resolve(sourceRoot, item.dir);
        item.out = path.resolve(outRoot, vendor.name);
        if (platform.debug) {
            item.out = path.join(item.out, "debug");
        }
        item.deps = vendor.deps;
        if (vendor.cmake) {
            let cmake = {
                targets: vendor.cmake.targets,
                arguments: vendor.cmake.arguments,
                includes: vendor.cmake.includes
            };
            let platforms = vendor.cmake.platforms;
            cmake.hasSetPlatform = Array.isArray(platforms);
            if (!cmake.hasSetPlatform || platforms.indexOf(platform.name) !== -1) {
                item.cmake = cmake;
            }
        }
        let scripts = vendor.scripts;
        if (scripts && scripts[platform.name]) {
            item.script = scripts[platform.name];
            item.script.file = path.resolve(projectPath, item.script.file);
        }
        if (item.script && item.cmake) {
            delete item.cmake;
        }
        if (item.cmake || item.script) {
            if (!vendorMap.hasOwnProperty(item.name) || item.script || item.cmake.hasSetPlatform) {
                vendorMap[item.name] = item;
            }
        }
    }
    let vendorNames = Object.keys(vendorMap);
    for (let vendorName of vendorNames) {
        let vendor = vendorMap[vendorName];
        let deps = vendor.deps;
        if (deps) {
            let keys = Object.keys(deps);
            for (let key of keys) {
                let depName = deps[key];
                let depVendor = vendorMap[depName];
                if (depVendor) {
                    deps[key] = depVendor;
                } else {
                    delete deps[key];
                }
            }
        }
    }

    for (let vendorName of vendorNames) {
        let vendor = vendorMap[vendorName];
        updateHash(vendor, platform);
    }
    return vendorMap;
}

function buildWithScript(platform, sourcePath, outPath, script, deps) {
    let buildType = platform.debug ? "Debug" : "Release";
    let cmd = "";
    if (script.executor) {
        cmd += script.executor + " ";
    }
    cmd += Utils.escapeSpace(script.file);
    if (script.arguments) {
        cmd += " " + script.arguments.join(" ");
    }
    Utils.log("env: VENDOR_BUILD_TYPE=" + buildType)
    Utils.log("env: VENDOR_OUT_DIR=" + outPath)
    let keys = Object.keys(deps);
    for (let key of keys) {
        Utils.log("env: VENDOR_DEPS_" + key + "=" + deps[key]);
        process.env["VENDOR_DEPS_" + key] = deps[key];
    }
    process.env["VENDOR_BUILD_TYPE"] = buildType;
    process.env["VENDOR_OUT_DIR"] = outPath;
    Utils.log("cwd: " + sourcePath)
    Utils.exec(cmd, sourcePath, platform.verbose);
}

function hasVendorHashFile(filePath) {
    if (fs.lstatSync(filePath).isDirectory()) {
        let files = fs.readdirSync(filePath);
        for (let file of files) {
            let curPath = path.join(filePath, file);
            if (hasVendorHashFile(curPath)) {
                return true;
            }
        }
    } else {
        let basename = path.basename(filePath);
        if (basename.startsWith(".") && filePath.endsWith(".md5")) {
            return true;
        }
    }
    return false;
}

class Vendor {
    constructor(configFile, platform) {
        this.platform = platform;
        configFile = path.resolve(configFile);
        let data;
        try {
            let jsonText = Utils.readFile(configFile);
            data = JSON.parse(jsonText);
        } catch (e) {
            Utils.error("The vendor config file is not a valid JSON file: " + configFile);
            process.exit(1);
        }
        let projectPath = path.dirname(configFile);
        this.outRoot = path.resolve(projectPath, data.out);
        let vendorNames = [];
        if (data.vendors && data.vendors.length > 0) {
            for (let vendor of data.vendors) {
                if (vendorNames.indexOf(vendor.name) === -1) {
                    vendorNames.push(vendor.name);
                }
            }
        }
        this.allVendorNames = vendorNames;
        this.vendors = parseVendors(data, projectPath, this.platform);
    }

    buildAll(vendorNames, outPath) {
        if (!Array.isArray(vendorNames) || vendorNames.length === 0) {
            vendorNames = Object.keys(this.vendors);
        }
        let libraryPaths = [];
        for (let vendorName of vendorNames) {
            let list = this.buildVendor(vendorName);
            for (let libraryPath of list) {
                if (libraryPaths.indexOf(libraryPath) === -1) {
                    libraryPaths.push(libraryPath);
                }
            }
        }
        if (outPath && libraryPaths.length > 0) {
            libraryPaths.sort();
            let archs = [];
            let hashTable = {};
            for (let arch of this.platform.archs) {
                let vendorsHash = this.platform.name;
                for (let libraryPath of libraryPaths) {
                    let hashFile = path.join(libraryPath, "." + arch + ".md5");
                    vendorsHash += Utils.readFile(hashFile);
                    vendorsHash += Utils.getModifyTime(hashFile);
                }
                let currentHash = Utils.getHash(vendorsHash);
                hashTable[arch] = currentHash;
                let hashFile = path.join(outPath, "." + arch + ".md5");
                let cachedHash = Utils.readFile(hashFile);
                if (currentHash !== cachedHash) {
                    Utils.deletePath(path.join(outPath, arch));
                    Utils.deletePath(hashFile);
                    archs.push(arch);
                }
            }
            if (archs.length === 0) {
                return;
            }
            Utils.log("Publishing vendor libraries: [" + vendorNames.join(",") + "] into " + outPath);
            this.publishLibraries(libraryPaths, outPath, archs);
            for (let arch of archs) {
                let hashFile = path.join(outPath, "." + arch + ".md5");
                Utils.writeFile(hashFile, hashTable[arch]);
            }
        }
        this.clearVendorOut();
    }

    buildVendor(vendorName) {
        let vendor = this.vendors[vendorName];
        if (!vendor) {
            Utils.error("Could not find any vendor name that matches '" + vendorName + "'");
            process.exit(1);
        }
        let libraryPaths = [];
        let outPath = path.join(vendor.out, this.platform.name);
        libraryPaths.push(outPath);
        let deps = {};
        if (vendor.deps) {
            let keys = Object.keys(vendor.deps);
            for (let key of keys) {
                let depVendor = vendor.deps[key];
                deps[key] = depVendor;
                let list = this.buildVendor(depVendor.name);
                libraryPaths = libraryPaths.concat(list);
            }
        }
        let archs = [];
        for (let arch of this.platform.archs) {
            let hashFile = path.join(outPath, "." + arch + ".md5");
            let cachedHash = Utils.readFile(hashFile);
            if (cachedHash !== vendor.hash) {
                Utils.deletePath(path.join(outPath, arch));
                Utils.deletePath(hashFile);
                archs.push(arch);
            }
        }
        if (archs.length === 0) {
            return libraryPaths;
        }
        Utils.deletePath(path.join(outPath, ".vendor.sha1"));
        let buildType = this.platform.debug ? "debug" : "release";
        let sourcePath = vendor.source;
        Utils.log("====================== build " + vendorName + "-" + this.platform.name + "-" +
            buildType + " start ======================");
        let script = vendor.script;
        if (script) {
            archs = this.platform.archs;
            buildWithScript(this.platform, sourcePath, vendor.out, script, deps);
        } else {
            let cmake = CMake.Create(this.platform);
            let options = vendor.cmake;
            options.deps = deps;
            cmake.build(sourcePath, outPath, options, archs);
        }
        for (let arch of archs) {
            let hashFile = path.join(outPath, "." + arch + ".md5");
            Utils.writeFile(hashFile, vendor.hash);
        }
        Utils.log("======================= build " + vendorName + "-" + this.platform.name + "-" +
            buildType + " end =======================");
        return libraryPaths;
    }

    clearVendorOut() {
        let vendorNames = this.allVendorNames;
        let files = fs.readdirSync(this.outRoot);
        for (let fileName of files) {
            let filePath = path.join(this.outRoot, fileName);
            if (vendorNames.indexOf(fileName) === -1 && hasVendorHashFile(filePath)) {
                Utils.log("Removing unused vendor output: " + filePath);
                Utils.deletePath(filePath);
            }
        }
    }

    publishLibraries(libraryPaths, outPath, archs) {
        let libraryTool = LibraryTool.Create(this.platform);
        let hasStaticLibries = false;
        for (let arch of archs) {
            let libraries = [];
            for (let libraryPath of libraryPaths) {
                libraryPath = path.join(libraryPath, arch);
                let staticFiles = LibraryTool.FindStaticLibraries(libraryPath);
                libraries = libraries.concat(staticFiles);
            }
            if (libraries.length > 0) {
                let libraryPath = path.join(outPath, arch);
                let ext = path.extname(libraries[0]);
                let libraryName = "lib" + path.parse(outPath).name + ext;
                let libraryFile = path.join(libraryPath, libraryName);
                Utils.deletePath(libraryPath);
                Utils.createDirectory(libraryPath);
                if (libraries.length > 1) {
                    libraryTool.mergeLibraries(libraries, libraryFile, arch);
                } else {
                    Utils.copyPath(libraries[0], libraryFile);
                }
                hasStaticLibries = true;
            }
        }
    }
}

module.exports = Vendor;
