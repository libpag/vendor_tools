# vendor_tools
A toolset for building vendor libraries based on Node.js, providing a unified way to build libraries across all platforms.

Originally developed as built-in tools for the [libpag](https://github.com/Tencent/libpag) and [tgfx](https://github.com/Tencent/tgfx) 
projects, it has now been extracted as a standalone project to offer a more flexible and reusable solution for building 
vendor libraries.


# Command Line Tools

## vendor-build

### Description
Used to build vendor libraries defined in `vendor.json`. For example:

```json
 {
  "source": "third_party",
  "out": "third_party/out",
  "vendors": [
    {
      "name": "zlib",
      "cmake": {
        "targets": [
          "zlibstatic"
        ],
        "includes": [
          "${SOURCE_DIR}/zlib.h",
          "${BUILD_DIR}/zconf.h"
        ]
      }
    },
    {
      "name": "libpng",
      "deps": {
        "ZLIB": "zlib"
      },
      "cmake": {
        "targets": [
          "png_static"
        ],
        "arguments": [
          "-DPNG_BUILD_ZLIB=ON"
        ],
        "includes": [
          "${SOURCE_DIR}/png.h",
          "${SOURCE_DIR}/pngconf.h",
          "${BUILD_DIR}/pnglibconf.h"
        ],
        "platforms": [
          "android",
          "win",
          "linux"
        ]
      }
    },
    {
      "name": "libpng",
      "deps": {
        "ZLIB": "zlib"
      },
      "cmake": {
        "targets": [
          "png_static"
        ],
        "arguments": [
          "-DPNG_BUILD_ZLIB=ON",
          "-DPNG_ARM_NEON=on"
        ],
        "includes": [
          "${SOURCE_DIR}/png.h",
          "${SOURCE_DIR}/pngconf.h",
          "${BUILD_DIR}/pnglibconf.h"
        ],
        "platforms": [
          "ios",
          "mac"
        ]
      }
    },
    {
      "name": "sonic",
      "scripts": {
        "mac": {
          "executor": "bash",
          "file": "scripts/sonic/build_mac.sh"
        },
        "win": {
          "executor": "bash",
          "file": "scripts/sonic/build_win.sh"
        }
      }
    }
  ]
}
```

Check out the [vendor.json](https://github.com/Tencent/tgfx/blob/main/vendor.json) file in the tgfx project for more examples.

### Syntax:   
```sh
node vendor-build [vendorName] [vendorName]... [Options]
```

### Options
- `--source`, `-s`: Specify the source path of `vendor.json`. Default is the current working directory.
- `--platform`, `-p`: Specify the current platform. Supported platforms: `["win", "mac", "ios", "linux", "android", "web", "ohos"]`.
- `--arch`, `-a`: Build only for the specified architecture. Supported architectures: `["x86", "x64", "arm", "arm64", "arm64-simulator", "wasm", "wasm-mt"]`.
- `--output`, `-o`: Publish all vendor libraries to the specified output directory. All shared libraries will be copied, and all static libraries will be merged.
- `--xcframework`, `-x`: If the current platform supports it, merge all architectures of the library into one `xcframework`. Ignored if `--output` is not specified.
- `--debug`, `-d`: Enable debug mode build.
- `--verbose`, `-v`: Print messages in verbose mode.
- `--help`, `-h`: Print help information.

### Examples
```sh
node vendor-build libpng libwebp
node vendor-build --debug
node vendor-build -p mac -a arm64 --verbose
```

## cmake-build

### Description
Used to build CMake projects consistently across all platforms, including Windows, macOS, iOS, Android, Linux, Web, and 
HarmonyOS.

### Syntax:   
```sh
node cmake-build  [cmakeTarget] [cmakeTarget]... [Options] [-Dcmake_variable=value]... [-Dcmake_variable=value]
```

### Options
- `--source`, `-s`: Specify the source path of `CMakeLists.txt`. Default is the current working directory.
- `--output`, `-o`: Specifies the output path. Default is [source]/out.
- `--platform`, `-p`: Specify the current platform. Supported platforms: `["win", "mac", "ios", "linux", "android", "web", "ohos"]`.
- `--arch`, `-a`: Build only for the specified architecture. Supported architectures: `["x86", "x64", "arm", "arm64", "arm64-simulator", "wasm", "wasm-mt"]`.
- `--incremental`, `-i`: Uses incremental build. The build directory will not be removed after the building finished.
- `--native`, `-n`: Use the native generator with cmake to build the library if the current platform supports it.
- `--debug`, `-d`: Builds with debug mode enabled.
- `--symbols`, `-S`: Generate the debug symbols. Default is true if --debug is specified.
- `--verbose`, `-v`: Print messages in verbose mode.
- `--help`, `-h`: Print help information.
  
You can also pass any other cmake variables with a `-D` prefix to `cmake-build`, and they will be forwarded to the `cmake` command.

### Examples
```sh
node cmake-build pag -p ios -o ./out/ios
node cmake-build pag pag-staic --debug
node cmake-build pag -DTGFX_USE_WEBP_ENCODE=ON -p mac --verbose
```

## lib-build

### Description

It wraps `cmake-build` to build CMake projects with a caching mechanism. It automatically detects changes in the source 
files and rebuilds the project if necessary.

### Syntax:   
```sh
node lib-build [cmakeTarget] [Options] [-Dcmake_variable=value]... [-Dcmake_variable=value]
```

### Options
- `--source`, `-s`: Specify the source path of `CMakeLists.txt`. Default is the current working directory.
- `--output`, `-o`: Specifies the output path. Default is [source]/out.
- `--platform`, `-p`: Specify the current platform. Supported platforms: `["win", "mac", "ios", "linux", "android", "web", "ohos"]`.
- `--arch`, `-a`: Build only for the specified architecture. Supported architectures: `["x86", "x64", "arm", "arm64", "arm64-simulator", "wasm", "wasm-mt"]`.
- `--incremental`, `-i`: Uses incremental build. The build directory will not be removed after the building finished.
- `--native`, `-n`: Use the native generator with cmake to build the library if the current platform supports it.
- `--xcframework`, `-x`: Merges all arches of the output libraries into one `xcframework` if the current platform supports it.
- `--debug`, `-d`: Builds with debug mode enabled.
- `--help`, `-h`: Print help information.

You can also pass any other cmake variables with a `-D` prefix to `lib-build`, and they will be forwarded to the `cmake` command.
By default, debug symbols will be stripped unless the `--debug` flag is specified.

### Examples
```sh
node lib-build pag -p ios -o ./out/ios
node lib-build pag --debug
node lib-build pag -DTGFX_USE_WEBP_ENCODE=ON -p mac
```

## lib-merge

### Description
Used to merge static libraries into a single library.

### Syntax:   
```sh
node lib-merge [libraryName] [libraryName]... [Options]
```


### Options
- `--platform`, `-p`: Specifies the current platform. Supported platforms: `["win", "mac", "ios", "linux", "android", "web", "ohos"]`.
- `--xcframework`, `-x`: Merges all archs in the specified library path into one `xcframework` if the current platform supports it.
- `--arch`, `-a`: Specifies the arch of the current platform. Supported archs: `["x86", "x64", "arm", "arm64", "arm64-simulator", "wasm", "wasm-mt"]`. Ignored if `--xcframework` is specified.
- `--output`, `-o`: Merges all static libraries into the specified output library file.
- `--verbose`, `-v`: Prints messages in verbose mode.
- `--help`, `-h`: Prints help information.

### Examples
```sh
node lib-merge libpng.a libwebp.a -o libvendor.a -p mac -a x64
node lib-merge -x vendor/ffavc -p mac -o out/ffavc
```

## xcode-gen

### Description
Used to generate Xcode projects for CMake projects.

### Syntax:   
```sh
node xcode-gen sourcePath [options] [-Dcmake_variable=value]... [-Dcmake_variable=value]
```

### Options
- `--source`, `-s`: Specify the root of the cmake project. Default is the current working directory.
- `--output`, `-o`: Specify the output path of the generated project. Default is the current working directory.
- `--platform`, `-p`: Specify the platform to generate. Supported platforms: `["mac", "ios", "simulator"]`.
- `--arch`, `-a`: Specify the arch of the generated project. Supported arches: `["x64", "arm64"]`.
- `--workspace`, `-w`: Generate an additional *.xcworkspace for the existing xcode project in the output directory.
- `--help`, `-h`: Print help message.

You can also pass any other cmake variables with a `-D` prefix to `xcode-gen`, and they will be forwarded to the `cmake` command.

### Examples
```sh
node xcode-gen  ./source -p mac -DTGFX_USE_WEBP_ENCODE=ON
node xcode-gen  ./source -p simulator -a arm64
node xcode-gen  ./source -p ios -a arm64 -w
```

## ms-build

### Description
Used to build Visual Studio projects, this tool automatically detects the location of the Visual Studio installation.

### Syntax:   
```sh
node ms-build [-a x86|x64] [msbuild options]
```

### Options
- `--arch`, `-a`: Specify the arch of the Command Prompt for VS. Supported archs: `["x86", "x64"]`. Default is x64.
- `--help`, `-h`: Print help message.
 
Any other options will be passed to `msbuild`.

### Examples
```sh
node ms-build -a x64 win/Win32Demo.sln /p:Configuration=Release /p:Platform=x64
```

# vendor.cmake

The `vendor.cmake` file in the root directory includes a set of CMake functions to help build vendor libraries. It also
automatically runs the `depsync` tool to download dependencies during the build process.

You can include it in your CMake project like this:

```cmake
include(vendor_tools/vendor.cmake)
```

Then, use the functions `add_vendor_target`, `merge_libraries_into`, and `find_vendor_libraries` from `vendor.cmake` to 
build your vendor libraries. For more examples, check out the [CMakeLists.txt](https://github.com/Tencent/tgfx/blob/main/CMakeLists.txt) 
file in the tgfx project.