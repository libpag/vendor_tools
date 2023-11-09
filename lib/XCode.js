const path = require("path");
const Utils = require('./Utils');
const CommandLine = require('./CommandLine');
const childProcess = require("child_process");
const fs = require("fs");

const optionDeclarations = [
    {
        name: "arch",
        shortName: "a",
        type: "string",
        description: "Specify the arch of the generated project. Supported archs: [\"x64\", \"arm64\", \"arm64-simulator\"]."
    },
    {
        name: "help",
        shortName: "h",
        type: "boolean",
        description: "Print help message."
    }
];

function printHelp(cmd) {
    let output = "";
    output += "Syntax:   " + cmd + " [-Dcmake_variable=value]... [-Dcmake_variable=value] [options]\n";
    output += "Examples: " + cmd + " -DTGFX_USE_WEBP_ENCODE=ON -a arm64\n";
    output += CommandLine.printOptions(optionDeclarations);
    Utils.log(output);
}

function ParseOptions() {
    let args = process.argv;
    let cmd = path.basename(args[1]);
    args = args.slice(2);
    let cmakeArgs = [];
    let cmdArgs = [];
    for (let arg of args) {
        if (arg.indexOf("-D") === 0) {
            cmakeArgs.push(arg);
        } else {
            cmdArgs.push(arg);
        }
    }
    let options = CommandLine.parse(cmdArgs, optionDeclarations);
    options.cmakeArgs = cmakeArgs;
    if (options.targets && options.targets.length > 0) {
        options.help = true;
    }
    if (options.help) {
        printHelp(cmd);
        if (options.errors.length > 0) {
            process.exit(1);
        }
        return {};
    }
    return options;
}

function GetCMakePlatform(options) {
    let platform = options.platform;
    if (!platform) {
        platform = "mac";
    }
    let arch = options.arch;
    if (!arch) {
        if (platform === "ios") {
            arch = "arm64"
        } else {
            let cpuName = childProcess.execSync("sysctl -n machdep.cpu.brand_string").toString();
            if (cpuName.indexOf("Apple") !== -1) {
                arch = "arm64"
            } else {
                arch = "x64"
            }
        }
    }
    if (platform === "ios") {
        switch (arch) {
            case "arm64":
                return "OS64";
            case "x64":
                return "SIMULATOR64";
            case "arm64-simulator":
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

function FindXcodeProject(outPath) {
    let files = fs.readdirSync(outPath);
    for (let fileName of files) {
        let ext = path.extname(fileName);
        if (ext === ".xcodeproj") {
            return path.parse(fileName).name;
        }
    }
    return "";
}

function Generate(sourcePath, outPath, platform) {
    let options = ParseOptions();
    options.platform = platform;
    let cmakeArgs = options.cmakeArgs;
    let libraryName = path.basename(sourcePath);
    let toolchain = path.resolve(__dirname, "../ios.toolchain.cmake");
    let cmakePlatform = GetCMakePlatform(options);
    let cmd = "cmake " + Utils.escapeSpace(sourcePath) + " -G Xcode -B " + libraryName +
        " -DCMAKE_TOOLCHAIN_FILE=" + Utils.escapeSpace(toolchain) + " -DENABLE_ARC=OFF -DPLATFORM="
        + cmakePlatform + " " + cmakeArgs.join(" ");
    Utils.log(cmd);
    Utils.exec(cmd, outPath, false);

    let mainProjectName = FindXcodeProject(outPath);
    let libraryProjectName = FindXcodeProject(path.join(outPath, libraryName));

    if (!mainProjectName) {
        Utils.error("Can't find any xcode project in: " + outPath);
        process.exit(1);
    }
    let workspaceFile = path.resolve(outPath, mainProjectName + ".xcworkspace", "contents.xcworkspacedata");
    if (!fs.existsSync(workspaceFile)) {
        let workspace = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<Workspace version = \"1.0\">\n" +
            "  <FileRef location = \"group:" + mainProjectName + ".xcodeproj\"></FileRef>\n" +
            "  <FileRef location = \"group:" + libraryName + "/" + libraryProjectName + ".xcodeproj\"></FileRef>\n" +
            "</Workspace>\n"
        Utils.writeFile(workspaceFile, workspace);
    }
}

exports.Generate = Generate;
