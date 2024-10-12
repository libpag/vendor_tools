const os = require("os");

const KnownPlatforms = ["win", "mac", "ios", "linux", "android", "web", "ohos"];
const KnownArchs = ["x86", "x64", "arm", "arm64", "arm64-simulator", "wasm", "wasm-mt"];

function getOptionNameMap(optionDeclarations) {
    let optionNameMap = {};
    let shortOptionNames = {};
    optionDeclarations.forEach(function (option) {
        optionNameMap[option.name.toLowerCase()] = option;
        if (option.shortName) {
            shortOptionNames[option.shortName] = option.name;
        }
    });
    return {optionNameMap: optionNameMap, shortOptionNames: shortOptionNames};
}

function parse(args, optionDeclarations, platforms, archs) {
    if (!platforms) {
        platforms = KnownPlatforms;
    }
    if (!archs) {
        archs = KnownArchs;
    }
    let options = {};
    options.errors = [];
    options.targets = [];
    let _a = getOptionNameMap(optionDeclarations), optionNameMap = _a.optionNameMap,
        shortOptionNames = _a.shortOptionNames;
    let i = 0;
    while (i < args.length) {
        let s = args[i];
        i++;
        if (s.charAt(0) === "-") {
            s = s.slice(s.charAt(1) === "-" ? 2 : 1).toLowerCase();
            if (s in shortOptionNames) {
                s = shortOptionNames[s];
            }
            if (s in optionNameMap) {
                let opt = optionNameMap[s];
                if (!args[i] && opt.type !== "boolean") {
                    options.errors.push("Option '" + opt.name + "' expects an argument.");
                }
                switch (opt.type) {
                    case "number":
                        options[opt.name] = parseInt(args[i]);
                        i++;
                        break;
                    case "boolean":
                        options[opt.name] = true;
                        break;
                    case "string":
                        options[opt.name] = args[i] || "";
                        i++;
                        break;
                }
            } else {
                options.errors.push("Unknown option '" + s + "'.");
            }
        } else {
            options.targets.push(s);
        }
    }
    if (!options.platform) {
        let p = os.platform();
        if (p === "darwin") {
            options.platform = "mac";
        } else if (p === "win32") {
            options.platform = "win";
        } else if (p === "linux") {
            options.platform = "linux";
        } else if (p === "ohos") {
            options.platform = "ohos";
        } else {
            options.help = true;
        }
        if (platforms.indexOf(options.platform) === -1) {
            delete options.platform;
        }
    } else if (platforms.indexOf(options.platform) === -1) {
        options.errors.push("Unknown platform '" + options.platform + "'.");
    }
    if (options.arch && archs.indexOf(options.arch) === -1) {
        options.errors.push("Unknown arch '" + options.arch + "'.");
    }
    if (options.errors.length > 0) {
        for (let error of options.errors) {
            process.stderr.write(error + "\n");
        }
        options.help = true;
    }
    return options;
}


function makePadding(paddingLength) {
    return Array(paddingLength + 1).join(" ");
}

function printOptions(optionDeclarations) {
    let output = "Options:\n";
    optionDeclarations.forEach(function (option) {
        let name = "";
        if (option.shortName) {
            name += "-" + option.shortName + ", ";
        }
        name += "--" + option.name;
        name += makePadding(25 - name.length);
        output += name + option.description + "\n";
    });
    return output;
}

exports.parse = parse;
exports.printOptions = printOptions;
