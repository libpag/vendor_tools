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

function GetConfigurationArgs(cmakeArgs, debug) {
    let configurationArgs = [];
    let configurationTypes = [];
    for (let i = 0; i < cmakeArgs.length; i++) {
        let cmakeArg = cmakeArgs[i];
        if (cmakeArg.indexOf("-DCMAKE_CONFIGURATION_TYPES=") !== -1) {
            configurationTypes = cmakeArgs[i].split("=")[1].split(";");
            break;
        }
    }
    if (configurationTypes.length === 0) {
        configurationArgs.push("-DCMAKE_CONFIGURATION_TYPES=\"Debug;Release\"");
    } else if (configurationArgs.length === 1) {
        let hasBuildType = cmakeArgs.some(function (arg) {
            return arg.indexOf("-DCMAKE_BUILD_TYPE=") !== -1;
        });
        if (!hasBuildType) {
            configurationArgs.push("-DCMAKE_BUILD_TYPE=" + configurationTypes[0]);
        }
    }
    return configurationArgs;
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

function GetShellScriptStartIndex(line) {
    let index = line.indexOf("shellScript");
    if (index === -1) {
        return -1;
    }
    index = line.indexOf("=", index);
    if (index === -1) {
        return -1;
    }
    index = line.indexOf("\"", index);
    if (index === -1) {
        return -1;
    }
    return index + 1;
}

function AddEnvPathToScript(config, envPaths) {
    let lines = config.split("\n");
    let results = [];
    let shellScript = "";
    for (let envPath of envPaths) {
        shellScript += "source \\\"" + envPath + "\\\"\n";
    }
    for (let line of lines) {
        let index = GetShellScriptStartIndex(line);
        if (index !== -1) {
            line = line.substring(0, index) + shellScript + line.substring(index);
        }
        results.push(line);
    }
    return results.join("\n");
}

function Generate(options) {
    options = ParsePlatformAndArch(options);
    let sourcePath = path.resolve(options.source);
    let outPath = path.resolve(options.output);
    Utils.createDirectory(outPath);
    let cmakeArgs = options.cmakeArgs;
    let cmakeProjectName = FindCMakeProjectName(sourcePath);
    if (!cmakeProjectName) {
        Utils.error("Can't find cmake project name in: " + sourcePath);
        process.exit(1);
    }
    let workspacePath = "";
    let projectPath = options.workspace ? path.resolve(outPath, cmakeProjectName) : outPath;
    let productDir = path.resolve(projectPath, "Products");
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
        cmakeArgs.push("-DCMAKE_ARCHIVE_OUTPUT_DIRECTORY=\"" + productDir + "\"");
        cmakeArgs.push("-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=\"" + productDir + "\"");
        cmakeArgs.push("-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=\"" + productDir + "\"");
    }
    let configurationArgs = GetConfigurationArgs(cmakeArgs, options.debug);
    cmakeArgs = configurationArgs.concat(cmakeArgs);
    let platformArgs = GetCMakePlatformArgs(options);
    cmakeArgs = platformArgs.concat(cmakeArgs);
    Utils.deletePath(path.resolve(projectPath, "CMakeFiles"));
    Utils.deletePath(path.resolve(projectPath, "CMakeScripts"));
    Utils.deletePath(path.resolve(projectPath, "CmakeCache.txt"));
    let toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    let cmd = "cmake " + Utils.escapeSpace(sourcePath) +
        " -G Xcode -B " + projectPath +
        " -DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(toolchain) +
        " " + cmakeArgs.join(" ");
    Utils.exec(cmd, outPath);
    let configFiles = Utils.findFiles(projectPath, function (filePath) {
        return path.basename(filePath) === "project.pbxproj" && filePath.indexOf("CMakeFiles") === -1;
    });
    if (options.workspace) {
        for (let configFile of configFiles) {
            let config = Utils.readFile(configFile);
            config = RemoveCustomProductDir(config, productDir);
            Utils.writeFile(configFile, config);
        }
    }
    let envFiles = [];
    let shell = Utils.execSafe("echo $SHELL");
    if (shell.indexOf("zsh") !== -1) {
        envFiles = [".zshenv", ".zshrc", ".zprofile"];
    } else {
        envFiles = [".bash_profile", ".bashrc", ".profile"];
    }
    let envPaths = [];
    for (let envFile of envFiles) {
        let envFilePath = path.join(process.env.HOME, envFile);
        if (fs.existsSync(envFilePath)) {
            envPaths.push(envFilePath);
        }
    }
    // Xcode doesn't inherit the PATH from the user's environment, so we need to add it to the script manually
    if (envPaths.length > 0) {
        for (let configFile of configFiles) {
            let config = Utils.readFile(configFile);
            config = AddEnvPathToScript(config, envPaths);
            Utils.writeFile(configFile, config);
        }
    }
}

exports.Generate = Generate;
