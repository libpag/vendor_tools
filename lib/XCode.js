const path = require("path");
const Utils = require('./Utils');
const fs = require("fs");

function ParsePlatformAndArch(options) {
    let platform = options.platform;
    if (!platform) {
        platform = "mac";
    }
    let arch = options.arch;
    if (!arch) {
        if (platform === "ios") {
            arch = "arm64"
        } else {
            let cpuName = Utils.execSafe("sysctl -n machdep.cpu.brand_string");
            if (cpuName.indexOf("Apple") !== -1) {
                arch = "arm64"
            } else {
                arch = "x64"
            }
        }
    }
    options.platform = platform;
    options.arch = arch;
    return options;
}

function GetCMakePlatform(options) {
    let platform = options.platform;
    let arch = options.arch;
    if (platform === "ios") {
        return "OS64";
    }
    if (platform === "simulator") {
        switch (arch) {
            case "x64":
                return "SIMULATOR64";
            case "arm64":
                return "SIMULATORARM64";
        }
    }
    switch (arch) {
        case "x64":
            return "MAC";
        case "arm64":
            return "MAC_ARM64";
    }
    return "OS64"
}

function FindXcodeProjectName(outPath) {
    let files = fs.readdirSync(outPath);
    for (let fileName of files) {
        let ext = path.extname(fileName);
        if (ext === ".xcodeproj") {
            return path.parse(fileName).name;
        }
    }
    return "";
}

function FindCMakeProjectName(sourcePath) {
    let cmakeConfig = Utils.readFile(path.join(sourcePath, "CMakeLists.txt"));
    if (!cmakeConfig) {
        return "";
    }
    return cmakeConfig.match(/project\((.*)\)/)[1];
}

function FindProductsDir(workspacePath, options) {
    let sdk = "";
    if (options.platform === "simulator") {
        sdk = " -sdk iphonesimulator";
    }
    let schemeInfo = Utils.execSafe("xcodebuild -workspace " + workspacePath + " -list");
    if (!schemeInfo || schemeInfo.indexOf("Schemes:") === -1) {
        return null;
    }
    let schemes = schemeInfo.match(/Schemes:\n((.|\n)*)\n\n/)[1].split("\n");
    if (schemes.length === 0) {
        return null;
    }
    let scheme = schemes[0];
    let xcodeCMD = "xcodebuild -workspace " + workspacePath + " -scheme " + scheme + sdk + " -showBuildSettings";
    let parseCMD = " | grep -m 1 \"BUILT_PRODUCTS_DIR\" | awk '{print $3}'";
    let debugDir = Utils.execSafe(xcodeCMD + " -configuration Debug" + parseCMD);
    let releaseDir = Utils.execSafe(xcodeCMD + " -configuration Release" + parseCMD);
    return {debug: debugDir.trim(), release: releaseDir.trim()};
}

function GetCMakeOutputArgs(workspacePath, options) {
    let productsDirs = FindProductsDir(workspacePath, options);
    if (!productsDirs) {
        Utils.error("Can't BUILT_PRODUCTS_DIR in: " + workspacePath);
        process.exit(1);
        return [];
    }
    let debugDir = productsDirs.debug;
    let releaseDir = productsDirs.release;
    let args = [];
    args.push("-DCMAKE_ARCHIVE_OUTPUT_DIRECTORY_DEBUG=\"" + debugDir + "\"");
    args.push("-DCMAKE_LIBRARY_OUTPUT_DIRECTORY_DEBUG=\"" + debugDir + "\"");
    args.push("-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG=\"" + debugDir + "\"");
    args.push("-DCMAKE_ARCHIVE_OUTPUT_DIRECTORY_RELEASE=\"" + releaseDir + "\"");
    args.push("-DCMAKE_LIBRARY_OUTPUT_DIRECTORY_RELEASE=\"" + releaseDir + "\"");
    args.push("-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE=\"" + releaseDir + "\"");
    return args;
}

function Generate(options) {
    options = ParsePlatformAndArch(options);
    let sourcePath = path.resolve(options.targets[0]);
    let outPath = path.resolve(options.output);
    let cmakeArgs = options.cmakeArgs;
    let cmakeProjectName = FindCMakeProjectName(sourcePath);
    if (!cmakeProjectName) {
        Utils.error("Can't find cmake project name in: " + sourcePath);
        process.exit(1);
    }
    if (options.workspace) {
        let mainProjectName = FindXcodeProjectName(outPath);
        if (!mainProjectName) {
            Utils.error("Can't find any xcode project in: " + outPath);
            process.exit(1);
        }
        let workspacePath = path.resolve(outPath, mainProjectName + ".xcworkspace");
        let workspace = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<Workspace version = \"1.0\">\n" +
            "  <FileRef location = \"group:" + mainProjectName + ".xcodeproj\"></FileRef>\n" +
            "  <FileRef location = \"group:" + cmakeProjectName + "/" + cmakeProjectName + ".xcodeproj\"></FileRef>\n" +
            "</Workspace>\n"
        let workspaceFile = path.resolve(workspacePath, "contents.xcworkspacedata");
        let oldWorkspace = Utils.readFile(workspaceFile);
        if (oldWorkspace !== workspace) {
            Utils.writeFile(workspaceFile, workspace);
        }
        Utils.log("Generate workspace: " + workspacePath);
        let cmakeOutputArgs = GetCMakeOutputArgs(workspacePath, options);
        cmakeArgs = cmakeOutputArgs.concat(cmakeArgs);
    }
    Utils.deletePath(path.resolve(outPath, cmakeProjectName));
    let toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    let cmakePlatform = GetCMakePlatform(options);
    let buildSystemOption = options.buildsystem ? " -T buildsystem=1" : "";
    let cmd = "cmake " + Utils.escapeSpace(sourcePath) + " -G Xcode -B " + cmakeProjectName +
        " -DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(toolchain) + " -DPLATFORM=" + cmakePlatform +
        buildSystemOption + " -DCMAKE_CONFIGURATION_TYPES=\"Debug;Release\" " + cmakeArgs.join(" ");
    Utils.exec(cmd, outPath);
}

exports.Generate = Generate;
