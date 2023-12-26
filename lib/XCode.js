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

function GetCMakePlatformArgs(options) {
    let platform = options.platform;
    let arch = options.arch;
    let args = [];
    if (platform === "ios") {
        args.push("-DCMAKE_XCODE_ATTRIBUTE_SUPPORTED_PLATFORMS=\"iphoneos\"")
        args.push("-DPLATFORM=OS64");
    } else if (platform === "simulator") {
        args.push("-DCMAKE_XCODE_ATTRIBUTE_SUPPORTED_PLATFORMS=\"iphonesimulator\"")
        switch (arch) {
            case "x64":
                args.push("-DPLATFORM=SIMULATOR64");
                break;
            case "arm64":
                args.push("-DPLATFORM=SIMULATORARM64");
                break;
        }

    } else {
        switch (arch) {
            case "x64":
                args.push("-DPLATFORM=MAC");
                break;
            case "arm64":
                args.push("-DPLATFORM=MAC_ARM64");
                break;
        }
    }
    return args;
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

function RemoveCustomProductDir(config, productDir) {
    let lines = config.split("\n");
    let results = [];
    let debugDir = path.join(productDir, "Debug");
    let releaseDir = path.join(productDir, "Release");
    for (let line of lines) {
        if (line.indexOf("CONFIGURATION_BUILD_DIR") !== -1 || line.indexOf("SYMROOT") !== -1) {
            continue;
        }
        line = line.split(debugDir).join("$BUILT_PRODUCTS_DIR");
        line = line.split(releaseDir).join("$BUILT_PRODUCTS_DIR");
        results.push(line);
    }
    return results.join("\n");
}

function Generate(options) {
    options = ParsePlatformAndArch(options);
    let sourcePath = path.resolve(options.source);
    let outPath = path.resolve(options.output);
    let cmakeArgs = options.cmakeArgs;
    let cmakeProjectName = FindCMakeProjectName(sourcePath);
    if (!cmakeProjectName) {
        Utils.error("Can't find cmake project name in: " + sourcePath);
        process.exit(1);
    }
    let workspacePath = "";
    if (options.workspace) {
        let mainProjectName = FindXcodeProjectName(outPath);
        if (!mainProjectName) {
            Utils.error("Can't find any xcode project in: " + outPath);
            process.exit(1);
        }
        workspacePath = path.resolve(outPath, mainProjectName + ".xcworkspace");
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
    }
    let productDir = path.resolve(outPath, cmakeProjectName, "Products");
    if (options.workspace) {
        cmakeArgs.push("-DCMAKE_ARCHIVE_OUTPUT_DIRECTORY=\"" + productDir + "\"");
        cmakeArgs.push("-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=\"" + productDir + "\"");
        cmakeArgs.push("-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=\"" + productDir + "\"");
    }
    let platformArgs = GetCMakePlatformArgs(options);
    cmakeArgs = platformArgs.concat(cmakeArgs);
    Utils.deletePath(path.resolve(outPath, cmakeProjectName));
    let toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    let buildSystemOption = options.buildsystem ? " -T buildsystem=1" : "";
    let cmd = "cmake " + Utils.escapeSpace(sourcePath) + " -G Xcode -B " + cmakeProjectName +
        " -DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(toolchain) + buildSystemOption +
        " -DCMAKE_CONFIGURATION_TYPES=\"Debug;Release\" " + cmakeArgs.join(" ");
    Utils.exec(cmd, outPath);
    if (options.workspace) {
        let configFiles = Utils.findFiles(path.resolve(outPath, cmakeProjectName), function (filePath) {
            return path.basename(filePath) === "project.pbxproj" && filePath.indexOf("CMakeFiles") === -1;
        });
        for (let configFile of configFiles) {
            let config = Utils.readFile(configFile);
            config = RemoveCustomProductDir(config, productDir);
            Utils.writeFile(configFile, config);
        }
    }
}

exports.Generate = Generate;
