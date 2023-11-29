include_guard(GLOBAL)

if (EMSCRIPTEN)
    set(ARCH wasm)
elseif (ANDROID OR IOS)
    if (CMAKE_SYSTEM_PROCESSOR STREQUAL "aarch64")
        if (SDK_NAME STREQUAL iphonesimulator)
            set(ARCH arm64-simulator)
        else ()
            set(ARCH arm64)
        endif ()
    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL "x86_64")
        set(ARCH x64)
    else ()
        set(ARCH arm)
    endif ()
else ()
    if (MSVC)
        string(TOLOWER ${MSVC_C_ARCHITECTURE_ID} ARCH)
    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL "x86_64" OR $CMAKE_SYSTEM_PROCESSOR STREQUAL "amd64")
        set(ARCH x64)
    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL "arm64" OR CMAKE_SYSTEM_PROCESSOR STREQUAL "aarch64")
        set(ARCH arm64)
    else ()
        set(ARCH x86)
    endif ()
endif ()

if (EMSCRIPTEN)
    set(WEB TRUE)
    set(PLATFORM web)
elseif (ANDROID)
    set(PLATFORM android)
elseif (IOS)
    set(PLATFORM ios)
elseif (APPLE)
    set(MACOS TRUE)
    set(PLATFORM mac)
elseif (WIN32)
    set(PLATFORM win)
elseif (CMAKE_HOST_SYSTEM_NAME MATCHES "Linux")
    set(LINUX TRUE)
    set(PLATFORM linux)
endif ()

# Sets the default build type to release.
if (NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release")
endif ()

if (WIN32 AND CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(VENDOR_DEBUG ON)
endif ()

if (VENDOR_DEBUG)
    set(LIBRARY_ENTRY debug/${PLATFORM}/${ARCH})
    set(INCLUDE_ENTRY debug/${PLATFORM}/include)
    set(VENDOR_DEBUG_FLAG -d)
else ()
    set(LIBRARY_ENTRY ${PLATFORM}/${ARCH})
    set(INCLUDE_ENTRY ${PLATFORM}/include)
endif ()

set(VENDOR_TOOLS_DIR ${CMAKE_CURRENT_LIST_DIR})

# merge_libraries_into(target [staticLibraries...])
function(merge_libraries_into target)
    if (ARGC GREATER 2)
        list(JOIN ARGN "\" \"" STATIC_LIBRARIES)
    else ()
        list(APPEND STATIC_LIBRARIES ${ARGN})
    endif ()
    separate_arguments(STATIC_LIBRARIES_LIST NATIVE_COMMAND "\"${STATIC_LIBRARIES}\"")
    add_custom_command(TARGET ${target} POST_BUILD
            COMMAND node ${VENDOR_TOOLS_DIR}/lib-merge -p ${PLATFORM} -a ${ARCH} -v
            $<TARGET_FILE:${target}> ${STATIC_LIBRARIES_LIST} -o $<TARGET_FILE:${target}>
            VERBATIM USES_TERMINAL)
endfunction()

# add_vendor_target(targetName [STATIC_VENDORS] [vendorNames...] [SHARED_VENDORS] [vendorNames...] [CONFIG_DIR] [configDir])
function(add_vendor_target targetName)
    set(IS_SHARED FALSE)
    set(IS_CONFIG_DIR FALSE)
    set(CONFIG_DIR ${CMAKE_CURRENT_LIST_DIR})
    foreach (arg ${ARGN})
        if (arg STREQUAL "STATIC_VENDORS")
            set(IS_SHARED FALSE)
            continue()
        endif ()
        if (arg STREQUAL "SHARED_VENDORS")
            set(IS_SHARED TRUE)
            continue()
        endif ()
        if (arg STREQUAL "CONFIG_DIR")
            set(IS_CONFIG_DIR TRUE)
            continue()
        endif ()
        if (IS_CONFIG_DIR)
            set(CONFIG_DIR ${arg})
            set(IS_CONFIG_DIR FALSE)
        elseif (IS_SHARED)
            list(APPEND sharedVendors ${arg})
        else ()
            list(APPEND staticVendors ${arg})
        endif ()
    endforeach ()

    if (NOT sharedVendors AND NOT staticVendors)
        return()
    endif ()

    foreach (sharedVendor ${sharedVendors})
        file(GLOB SHARED_LIBS third_party/out/${sharedVendor}/${LIBRARY_ENTRY}/*${CMAKE_SHARED_LIBRARY_SUFFIX})
        if (NOT SHARED_LIBS)
            # build shared libraries immediately if not exist, otherwise the rpath will not be set properly at the first time.
            execute_process(COMMAND node ${VENDOR_TOOLS_DIR}/vendor-build ${sharedVendor} -p ${PLATFORM} -a ${ARCH} -v ${VENDOR_DEBUG_FLAG}
                    WORKING_DIRECTORY ${CONFIG_DIR})
        endif ()
        file(GLOB SHARED_LIBS third_party/out/${sharedVendor}/${LIBRARY_ENTRY}/*${CMAKE_SHARED_LIBRARY_SUFFIX})
        list(APPEND VENDOR_SHARED_LIBRARIES ${SHARED_LIBS})
    endforeach ()

    string(TOLOWER ${targetName} name)
    set(VENDOR_OUTPUT_NAME ${name}-vendor)
    set(VENDOR_OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/${VENDOR_OUTPUT_NAME}.dir)
    if (staticVendors)
        set(VENDOR_OUTPUT_LIB ${VENDOR_OUTPUT_DIR}/${ARCH}/lib${VENDOR_OUTPUT_NAME}${CMAKE_STATIC_LIBRARY_SUFFIX})
    endif ()
    # Build the vendor libraries of current platform and merge them into a single static library.
    add_custom_command(OUTPUT ${VENDOR_OUTPUT_NAME}
            COMMAND node ${VENDOR_TOOLS_DIR}/vendor-build ${staticVendors} ${sharedVendors} -p ${PLATFORM} -a ${ARCH} -v ${VENDOR_DEBUG_FLAG} -o ${VENDOR_OUTPUT_DIR}
            WORKING_DIRECTORY ${CONFIG_DIR}
            BYPRODUCTS ${VENDOR_OUTPUT_LIB} ${VENDOR_SHARED_LIBRARIES} ${VENDOR_OUTPUT_DIR}/.${ARCH}.md5
            VERBATIM USES_TERMINAL)
    # set the output variables:
    set(${targetName}_VENDOR_TARGET ${VENDOR_OUTPUT_NAME} PARENT_SCOPE)
    set(${targetName}_VENDOR_STATIC_LIBRARIES ${VENDOR_OUTPUT_LIB} PARENT_SCOPE)
    set(${targetName}_VENDOR_SHARED_LIBRARIES ${VENDOR_SHARED_LIBRARIES} PARENT_SCOPE)
endfunction()

# Synchronizes the third-party dependencies of current platform.
execute_process(COMMAND depsync ${PLATFORM} WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR})
